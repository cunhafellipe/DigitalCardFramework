import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';

export const transferPolicyProtocol='digital-card-transfer-policy@1';
const id={type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9][a-zA-Z0-9._:-]*(?![\\s\\S])'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\\s\\S])'};
const digest={type:'string',pattern:'^[a-f0-9]{64}(?![\\s\\S])'};
const integer={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const identity={protocol:{const:transferPolicyProtocol},operation:{const:'canTransfer'},scope:{const:'transfer'},phase:{enum:['review','propose','counter','accept','list','quote','purchase']},requestId:uuid,providerId:id,grantId:uuid,generation:integer,commandId:digest,inputDigest:digest,snapshotDigest:digest,deadline:integer};
const leg=object({fromUserId:id,toUserId:{anyOf:[id,{type:'null'}]},copyIds:{type:'array',minItems:1,maxItems:2000,uniqueItems:true,items:uuid},versions:{type:'array',minItems:1,maxItems:2000,items:integer}});
export const transferPolicySchema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://digital-card.invalid/transfer-policy/v1',$ref:'#/$defs/request',$defs:{
  request:object({...identity,context:object({channel:{enum:['trade','sale']},legs:{type:'array',minItems:1,maxItems:2,items:leg}})}),
  response:{oneOf:[object({...identity,status:{const:'allowed'}}),object({...identity,status:{const:'denied'},reasonCode:{enum:['ineligible','restricted','unavailable']}}),object({...identity,status:{const:'error'},errorCode:{enum:['invalid-request','unauthenticated','rate-limited','unavailable']}})]},
}};
const compiler=new Ajv2020({strict:true});compiler.addSchema(transferPolicySchema);
const request=compiler.compile({$ref:transferPolicySchema.$id+'#/$defs/request'}),response=compiler.compile({$ref:transferPolicySchema.$id+'#/$defs/response'});
const reserved=new Set(['constructor','prototype','__proto__']);
export function validateTransferPolicyRequest(value){
  if(!request(value)||reserved.has(value.providerId)||value.context.legs.some(leg=>reserved.has(leg.fromUserId)||reserved.has(leg.toUserId)||leg.copyIds.length!==leg.versions.length)||value.context.legs.reduce((n,leg)=>n+leg.copyIds.length,0)>2000||new Set(value.context.legs.flatMap(leg=>leg.copyIds)).size!==value.context.legs.reduce((n,leg)=>n+leg.copyIds.length,0))throw new FrameworkError('INVALID_POLICY_REQUEST','Invalid transfer policy request',400);
  return value;
}
export function validateTransferPolicyResponse(value){if(!response(value)||reserved.has(value.providerId))throw new FrameworkError('INVALID_POLICY_RESPONSE','Invalid transfer policy response',502);return value;}
