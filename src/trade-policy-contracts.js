import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';

export const tradePolicyProtocol='digital-card-trade-policy@1';
const id={type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9][a-zA-Z0-9._:-]*(?![\\s\\S])'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\\s\\S])'};
const digest={type:'string',pattern:'^[a-f0-9]{64}(?![\\s\\S])'};
const integer={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const identity={protocol:{const:tradePolicyProtocol},operation:{const:'canTrade'},scope:{const:'exchange'},phase:{enum:['review','propose','counter','accept','quote','purchase']},requestId:uuid,providerId:id,grantId:uuid,generation:integer,commandId:digest,inputDigest:digest,snapshotDigest:digest,deadline:integer};
const offer=object({copyIds:{type:'array',maxItems:2000,uniqueItems:true,items:uuid},currencies:{type:'array',maxItems:100,items:object({currencyId:id,amount:{...integer,minimum:0}})}});
const context=object({channel:{enum:['trade','sale']},fromUserId:id,toUserId:id,give:offer,receive:offer,expiresInSeconds:{type:'integer',minimum:1,maximum:604800}},['channel','fromUserId','toUserId','give','receive']);
export const tradePolicySchema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://digital-card.invalid/trade-policy/v1',$ref:'#/$defs/request',$defs:{request:object({...identity,context}),response:{oneOf:[object({...identity,status:{const:'allowed'}}),object({...identity,status:{const:'denied'},reasonCode:{enum:['ineligible','restricted','unavailable']}}),object({...identity,status:{const:'error'},errorCode:{enum:['invalid-request','unauthenticated','rate-limited','unavailable']}})]}}};
const compiler=new Ajv2020({strict:true});compiler.addSchema(tradePolicySchema);
const request=compiler.compile({$ref:tradePolicySchema.$id+'#/$defs/request'}),response=compiler.compile({$ref:tradePolicySchema.$id+'#/$defs/response'});
const reserved=new Set(['constructor','prototype','__proto__']);
export function validateTradePolicyRequest(value){
  if(!request(value)||[value.providerId,value.context.fromUserId,value.context.toUserId,...value.context.give.currencies.map(m=>m.currencyId),...value.context.receive.currencies.map(m=>m.currencyId)].some(id=>reserved.has(id))||value.context.give.copyIds.length+value.context.receive.copyIds.length>2000)throw new FrameworkError('INVALID_POLICY_REQUEST','Invalid trade policy request',400);
  return value;
}
export function validateTradePolicyResponse(value){if(!response(value)||reserved.has(value.providerId))throw new FrameworkError('INVALID_POLICY_RESPONSE','Invalid trade policy response',502);return value;}
