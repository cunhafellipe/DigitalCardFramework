import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';
import {safeData} from './data.js';

export const actionProtocol='digital-card-action@1';
const identifier={type:'string',pattern:'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$'};
const unicodeString={type:'string',not:{pattern:'[\\uD800-\\uDFFF]'}};
const jobId={...unicodeString,minLength:1,maxLength:128};
const propertyNames={allOf:[{not:{enum:['__proto__','constructor','prototype']}},unicodeString]};
const eventString={...unicodeString,minLength:1};
const eventInteger={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const eventObject={type:'object',propertyNames,additionalProperties:{$ref:'#/$defs/json'}};
const eventData=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const nullableEventString={anyOf:[eventString,{type:'null'}]};
const codeIdentity={codeId:eventString,copyId:eventString,actorId:eventString};
const codeConfirmation={codeId:eventString,copyId:nullableEventString,actorId:nullableEventString,providerId:eventString,eventId:eventString,occurredAt:eventString};
const coreEventData={
  'code.pool-configured':eventData({poolId:eventString,actorId:nullableEventString}),
  'code.batch-imported':eventData({batchId:eventString,poolId:eventString,count:eventInteger,actorId:nullableEventString,metadata:eventObject}),
  'code.keys-rotated':eventData({count:eventInteger,actorId:nullableEventString}),
  'code.allocated':eventData(codeIdentity),
  'code.revealed':eventData(codeIdentity),
  'code.usage-reported':eventData({...codeIdentity,used:{type:'boolean'}}),
  'code.transferred':eventData({codeId:eventString,copyId:eventString,from:eventString,to:eventString,tradeId:eventString}),
  'code.redeemed':eventData(codeConfirmation),
  'code.revoked':eventData(codeConfirmation),
  'catalog.published':eventData({version:{...eventInteger,minimum:1}}),
  'catalog.imported':eventData({version:{...eventInteger,minimum:1},userId:{anyOf:[eventString,{type:'null'}]},digest:{type:'string',pattern:'^[a-f0-9]{64}(?![\\s\\S])'}}),
  'user.registered':eventData({userId:eventString}),
  'provenance.backfilled':eventData({count:eventInteger}),
  'currency.external-settled':eventData({providerId:eventString,transactionId:eventString,userId:eventString,currencyId:eventString,amount:{...eventInteger,minimum:1}}),
  'card.issued':eventData({copyId:eventString,ownerId:eventString,variantId:eventString,provenance:eventObject}),
  'card.opened':eventData({copyId:eventString,userId:eventString,packId:{anyOf:[eventString,{type:'null'}]},openedAt:eventString}),
  'card.transferred':eventData({copyId:eventString,from:eventString,to:eventString,tradeId:eventString}),
};
/** Portable post-commit delivery; configured identities are checked separately. */
export const actionDeliverySchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',
  $id:'https://digital-card.invalid/action-delivery/v1',
  $ref:'#/$defs/request',
  $defs:{json:{anyOf:[{type:'null'},{type:'boolean'},unicodeString,{type:'number'},
    {type:'array',items:{$ref:'#/$defs/json'}},{type:'object',propertyNames,additionalProperties:{$ref:'#/$defs/json'}}]},
    event:{type:'object',additionalProperties:false,required:['id','sequence','type','data','at'],properties:{id:eventString,sequence:{...eventInteger,minimum:1},type:eventString,data:eventObject,at:eventString,completionId:eventString},allOf:Object.entries(coreEventData).map(([type,data])=>({if:{properties:{type:{const:type}}},then:{properties:{data}}}))},
    request:{type:'object',additionalProperties:false,required:['protocol','pluginId','handlerId','jobId','beneficiaryId','source','params'],properties:{
      protocol:{const:actionProtocol},pluginId:identifier,handlerId:identifier,jobId,
      beneficiaryId:{anyOf:[unicodeString,{type:'null'}]},source:{type:'object',propertyNames,additionalProperties:{$ref:'#/$defs/json'}},params:{type:'object',propertyNames,additionalProperties:{$ref:'#/$defs/json'}},
    }},
    acknowledgment:{type:'object',additionalProperties:false,required:['protocol','pluginId','jobId','status'],properties:{
      protocol:{const:actionProtocol},pluginId:identifier,jobId,status:{const:'completed'},
    }},
  },
};
const compiler=new Ajv2020({strict:true,strictNumbers:true,allowUnionTypes:true});
compiler.addSchema(actionDeliverySchema);
const request=compiler.compile({$ref:actionDeliverySchema.$id+'#/$defs/request'});
const event=compiler.compile({$ref:actionDeliverySchema.$id+'#/$defs/event'});
const acknowledgment=compiler.compile({$ref:actionDeliverySchema.$id+'#/$defs/acknowledgment'});
export function validateActionDelivery(value){
  try{safeData(value,{maxDepth:18,maxNodes:20020,maxBytes:1048576});}catch{throw new FrameworkError('PLUGIN_JOB','Invalid committed action delivery',400);}
  if(!request(value)||value.jobId.length>128)throw new FrameworkError('PLUGIN_JOB','Invalid committed action delivery',400);
  try{for(const key of ['source','params'])safeData(value[key],{maxDepth:16,maxNodes:10000,maxBytes:32768});}catch{throw new FrameworkError('PLUGIN_JOB','Invalid committed action delivery',400);}
  return value;
}
export function validateActionAcknowledgment(value){
  if(!acknowledgment(value)||value.jobId.length>128)throw new FrameworkError('PLUGIN_RESPONSE','Invalid plugin acknowledgment',503);
  return value;
}

/** Opt-in event validation; custom action source and params remain unchanged. */
export function validateFrameworkEvent(value,expectedType){
  try{safeData(value,{maxDepth:18,maxNodes:10000,maxBytes:32768});}catch{throw new FrameworkError('PLUGIN_JOB','Invalid framework event',400);}
  if(!event(value)||(expectedType!==undefined&&value.type!==expectedType))throw new FrameworkError('PLUGIN_JOB','Invalid framework event',400);
  return value;
}
