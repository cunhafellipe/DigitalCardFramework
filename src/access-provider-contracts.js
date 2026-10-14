import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';
import {PERMISSIONS} from './access.js';

export const accessProviderProtocol='digital-card-access-provider@1';
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const identifier={type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9][a-zA-Z0-9._:-]*(?![\\s\\S])'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\\s\\S])'};
const text=maximum=>({type:'string',minLength:1,maxLength:maximum,pattern:'^[^\\u0000-\\u001f\\u007f]+(?![\\s\\S])'});
const identity={protocol:{const:accessProviderProtocol},operation:{const:'resolveAccess'},scope:{const:'access'},requestId:uuid,providerId:identifier,grantId:uuid,generation:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},deadline:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},issuer:text(2000),subject:text(512),userId:identifier};
/** Authority is bounded by the host's explicit grant, independently of service claims. */
export const accessProviderSchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://digital-card.invalid/access-provider/v1',$ref:'#/$defs/request',
  $defs:{request:object(identity),response:{oneOf:[
    object({...identity,status:{const:'allowed'},role:{enum:['player','admin']},permissions:{type:'array',uniqueItems:true,maxItems:PERMISSIONS.length,items:{enum:PERMISSIONS}}}),
    object({...identity,status:{enum:['denied','disabled']}}),
    object({...identity,status:{const:'error'},errorCode:{enum:['invalid-request','unauthenticated','rate-limited','unavailable']}}),
  ]}},
};
const compiler=new Ajv2020({strict:true});compiler.addSchema(accessProviderSchema);
const request=compiler.compile({$ref:accessProviderSchema.$id+'#/$defs/request'}),response=compiler.compile({$ref:accessProviderSchema.$id+'#/$defs/response'});
const reserved=new Set(['constructor','prototype','__proto__']);
export function validateAccessProviderRequest(value){
  if(!request(value)||reserved.has(value.providerId)||reserved.has(value.userId))throw new FrameworkError('INVALID_ACCESS_REQUEST','Invalid access provider request',400);
  return value;
}
export function validateAccessProviderResponse(value){
  if(!response(value)||reserved.has(value.providerId)||reserved.has(value.userId))throw new FrameworkError('INVALID_ACCESS_RESPONSE','Invalid access provider response',502);
  return value;
}
