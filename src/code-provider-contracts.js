import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';

export const codeProviderProtocol = 'digital-card-code-status@1';
const identifier = {type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'};
const requestId = {type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const identity = {protocol:{const:codeProviderProtocol},requestId,providerId:identifier,codeId:identifier};
const required = ['protocol','requestId','providerId','codeId'];
const object = (properties,fields) => ({type:'object',additionalProperties:false,properties,required:fields});

/** An exact read-only lookup. Error replies carry bounded identifiers, never arbitrary messages. */
export const codeProviderSchema = {
  $schema:'https://json-schema.org/draft/2020-12/schema',
  $id:'https://digital-card.invalid/code-status/v1',
  $ref:'#/$defs/request',
  $defs:{
    request:object({...identity,operation:{const:'lookup'},externalId:{anyOf:[{type:'null'},{type:'string',minLength:1,maxLength:300,pattern:'\\S'}]},code:{type:'string',minLength:1,maxLength:512,pattern:'^[^\\u0000-\\u001f\\u007f]+$'}},[...required,'operation','externalId','code']),
    response:{oneOf:[
      object({...identity,status:{const:'unknown'}},[...required,'status']),
      object({...identity,status:{enum:['redeemed','revoked']},eventId:{type:'string',minLength:1,maxLength:300,pattern:'^[^\\u0000-\\u001f\\u007f]+$'},occurredAt:{type:'string',maxLength:40,pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$'}},[...required,'status','eventId','occurredAt']),
      object({...identity,status:{const:'error'},errorCode:{enum:['invalid-request','unauthenticated','not-found','rate-limited','unavailable']}},[...required,'status','errorCode']),
    ]},
  },
};
const compiler = new Ajv2020({strict:true});
compiler.addSchema(codeProviderSchema);
const request = compiler.compile({$ref:codeProviderSchema.$id+'#/$defs/request'});
const response = compiler.compile({$ref:codeProviderSchema.$id+'#/$defs/response'});
const reserved = new Set(['__proto__','constructor','prototype']);
function valid(value,validator) {
  if(!validator(value))return false;
  if(reserved.has(value.providerId)||reserved.has(value.codeId))return false;
  for(const field of ['code','externalId','eventId'])if(typeof value[field]==='string'&&(value[field].length>({code:512,externalId:300,eventId:300}[field])||!value[field].trim()||/[\uD800-\uDFFF]/u.test(value[field])))return false;
  if(value.occurredAt) {
    const date=new Date(value.occurredAt);
    if(!Number.isFinite(date.valueOf())||date.toISOString().replace(/\.000Z$/,'Z')!==value.occurredAt.replace(/\.(\d{1,2})Z$/,(_,digits)=>'.'+digits.padEnd(3,'0')+'Z').replace(/\.000Z$/,'Z'))return false;
  }
  return true;
}
export function validateCodeProviderRequest(value) {
  if(!valid(value,request))throw new FrameworkError('INVALID_PROVIDER_REQUEST','Invalid code status lookup request',400);
  return value;
}
export function validateCodeProviderResponse(value) {
  if(!valid(value,response))throw new FrameworkError('INVALID_PROVIDER','Invalid code status provider response',502);
  return value;
}
