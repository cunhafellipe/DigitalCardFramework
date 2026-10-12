import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';

export const currencyProviderProtocol = 'digital-card-currency-settlement@1';
const identifier = {type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9][a-zA-Z0-9._:-]*(?![\\s\\S])'};
const boundedText = maxLength => ({type:'string',minLength:1,maxLength,pattern:'^[^\\u0000-\\u001f\\u007f]+$'});
const requestId = {type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\\s\\S])'};
const identity = {protocol:{const:currencyProviderProtocol},requestId,providerId:identifier};
const required = ['protocol','requestId','providerId','operation'];
const accountIdentity = {...identity,operation:{const:'resolve-account'},userId:boundedText(100)};
const lookupIdentity = {...identity,operation:{const:'lookup'},transactionId:boundedText(300),account:boundedText(300)};
const accountRequired = [...required,'userId'];
const lookupRequired = [...required,'transactionId','account'];
const object = (properties,fields) => ({type:'object',additionalProperties:false,properties,required:fields});
const errors = {status:{const:'error'},errorCode:{enum:['invalid-request','unauthenticated','not-found','rate-limited','unavailable']}};

/** Authenticated account resolution and read-only evidence for irrevocable settlement. */
export const currencyProviderSchema = {
  $schema:'https://json-schema.org/draft/2020-12/schema',
  $id:'https://digital-card.invalid/currency-settlement/v1',
  $ref:'#/$defs/request',
  $defs:{
    request:{oneOf:[object(accountIdentity,accountRequired),object(lookupIdentity,lookupRequired)]},
    response:{oneOf:[
      object({...accountIdentity,status:{const:'resolved'},account:boundedText(300)},[...accountRequired,'status','account']),
      object({...accountIdentity,...errors},[...accountRequired,'status','errorCode']),
      object({...lookupIdentity,status:{const:'settled'},currency:identifier,amountUnits:{type:'string',pattern:'^[1-9][0-9]{0,39}(?![\\s\\S])'}},[...lookupRequired,'status','currency','amountUnits']),
      object({...lookupIdentity,status:{enum:['unknown','pending','refunded']}},[...lookupRequired,'status']),
      object({...lookupIdentity,...errors},[...lookupRequired,'status','errorCode']),
    ]},
  },
};
const compiler = new Ajv2020({strict:true});
compiler.addSchema(currencyProviderSchema);
const request = compiler.compile({$ref:currencyProviderSchema.$id+'#/$defs/request'});
const response = compiler.compile({$ref:currencyProviderSchema.$id+'#/$defs/response'});
const reserved = new Set(['__proto__','constructor','prototype']);
function valid(value,validator) {
  if(!validator(value)||reserved.has(value.providerId)||reserved.has(value.currency))return false;
  for(const field of ['userId','account','transactionId'])if(typeof value[field]==='string'&&(value[field].length>(field==='userId'?100:300)||!value[field].trim()||/[\uD800-\uDFFF]/u.test(value[field])))return false;
  return true;
}
export function validateCurrencyProviderRequest(value) {
  if(!valid(value,request))throw new FrameworkError('INVALID_PROVIDER_REQUEST','Invalid currency provider request',400);
  return value;
}
export function validateCurrencyProviderResponse(value) {
  if(!valid(value,response))throw new FrameworkError('INVALID_PROVIDER','Invalid currency provider response',502);
  return value;
}
