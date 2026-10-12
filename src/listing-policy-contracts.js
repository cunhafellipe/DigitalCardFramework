import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';

export const listingPolicyProtocol='digital-card-listing-policy@1';
const identifier={type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9][a-zA-Z0-9._:-]*(?![\\s\\S])'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\\s\\S])'};
const digest={type:'string',pattern:'^[a-f0-9]{64}(?![\\s\\S])'};
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const identity={protocol:{const:listingPolicyProtocol},operation:{const:'canList'},scope:{const:'listing'},phase:{const:'create'},requestId:uuid,providerId:identifier,grantId:uuid,generation:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},commandId:digest,inputDigest:digest,snapshotDigest:digest,deadline:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}};
const quantity={type:'integer',minimum:1,maximum:1000};
const stock={oneOf:[
  object({kind:{enum:['copies','packs']},ids:{type:'array',minItems:1,maxItems:1000,uniqueItems:true,items:uuid}}),
  object({kind:{const:'mint-card'},variantId:identifier,quantity}),
  object({kind:{const:'mint-pack'},productId:identifier,quantity}),
  object({kind:{const:'action'},handler:identifier,quantity}),
]};
const context=object({actor:object({id:identifier}),shop:object({id:uuid,ownerId:identifier,kind:{enum:['admin','player']}}),price:object({currencyId:identifier,amount:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER}}),stock});
/** Listing permission evaluates proposed stock before allocation or reservation. */
export const listingPolicySchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://digital-card.invalid/listing-policy/v1',$ref:'#/$defs/request',
  $defs:{request:object({...identity,context}),response:{oneOf:[
    object({...identity,status:{const:'allowed'}}),
    object({...identity,status:{const:'denied'},reasonCode:{enum:['ineligible','restricted','unavailable']}}),
    object({...identity,status:{const:'error'},errorCode:{enum:['invalid-request','unauthenticated','rate-limited','unavailable']}}),
  ]}},
};
const compiler=new Ajv2020({strict:true});compiler.addSchema(listingPolicySchema);
const request=compiler.compile({$ref:listingPolicySchema.$id+'#/$defs/request'}),response=compiler.compile({$ref:listingPolicySchema.$id+'#/$defs/response'});
const reserved=new Set(['constructor','prototype','__proto__']);
export function validateListingPolicyRequest(value){
  if(!request(value)||[value.providerId,value.context?.actor.id,value.context?.price.currencyId,value.context?.stock.variantId,value.context?.stock.productId,value.context?.stock.handler].some(id=>reserved.has(id)))throw new FrameworkError('INVALID_POLICY_REQUEST','Invalid listing policy request',400);
  return value;
}
export function validateListingPolicyResponse(value){
  if(!response(value)||reserved.has(value.providerId))throw new FrameworkError('INVALID_POLICY_RESPONSE','Invalid listing policy response',502);
  return value;
}
