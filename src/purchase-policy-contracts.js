import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';

export const purchasePolicyProtocol='digital-card-purchase-policy@1';
const identifier={type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9][a-zA-Z0-9._:-]*(?![\\s\\S])'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\\s\\S])'};
const digest={type:'string',pattern:'^[a-f0-9]{64}(?![\\s\\S])'};
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const identity={protocol:{const:purchasePolicyProtocol},operation:{const:'canPurchase'},scope:{const:'listing'},phase:{enum:['quote','purchase']},requestId:uuid,providerId:identifier,grantId:uuid,generation:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},commandId:digest,inputDigest:digest,snapshotDigest:digest,deadline:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}};
const context=object({
  user:object({id:identifier}),
  shop:object({id:uuid,ownerId:identifier,kind:{enum:['admin','player']}}),
  listing:object({id:uuid,kind:{enum:['mint-card','mint-pack','copies','packs','action']},price:object({currencyId:identifier,amount:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER}})}),
  quantity:{type:'integer',minimum:1,maximum:1000},
  unitIds:{type:'array',minItems:1,maxItems:1000,uniqueItems:true,items:uuid},
});
/** Scoped advisory decisions never replace framework ownership or payment checks. */
export const purchasePolicySchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://digital-card.invalid/purchase-policy/v1',$ref:'#/$defs/request',
  $defs:{request:object({...identity,context}),response:{oneOf:[
    object({...identity,status:{const:'allowed'}}),
    object({...identity,status:{const:'denied'},reasonCode:{enum:['ineligible','restricted','unavailable']}}),
    object({...identity,status:{const:'error'},errorCode:{enum:['invalid-request','unauthenticated','rate-limited','unavailable']}}),
  ]}},
};
const compiler=new Ajv2020({strict:true});compiler.addSchema(purchasePolicySchema);
const request=compiler.compile({$ref:purchasePolicySchema.$id+'#/$defs/request'}),response=compiler.compile({$ref:purchasePolicySchema.$id+'#/$defs/response'});
const reserved=new Set(['constructor','prototype','__proto__']);
export function validatePurchasePolicyRequest(value){
  if(!request(value)||reserved.has(value.providerId)||reserved.has(value.context?.user.id)||reserved.has(value.context?.listing.price.currencyId))throw new FrameworkError('INVALID_POLICY_REQUEST','Invalid purchase policy request',400);
  return value;
}
export function validatePurchasePolicyResponse(value){
  if(!response(value)||reserved.has(value.providerId))throw new FrameworkError('INVALID_POLICY_RESPONSE','Invalid purchase policy response',502);
  return value;
}
