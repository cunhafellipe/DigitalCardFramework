import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';
import {safeData} from './data.js';
import {contentDigest} from './importer.js';

export const bindingFactoryProtocol='digital-card-binding-factory@1';
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\\s\\S])'};
const digest={type:'string',pattern:'^[a-f0-9]{64}(?![\\s\\S])'};
const id={type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9][a-zA-Z0-9._:-]*(?![\\s\\S])'};
const positive={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},position={type:'integer',minimum:0,maximum:99};
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const userId={type:'string',minLength:1,maxLength:128},json={type:'object'};
const copy=object({id:uuid,ownerId:userId,cardId:id,variantId:id,lineId:id,rarityId:id,state:{const:'sealed'},serialNumber:{type:['integer','null'],minimum:1,maximum:Number.MAX_SAFE_INTEGER},editionTotal:{type:['integer','null'],minimum:1,maximum:Number.MAX_SAFE_INTEGER},createdAt:{type:'string',maxLength:32},openedAt:{type:'null'},openedBy:{type:'null'},acquiredAt:{type:'string',maxLength:32},source:json,version:{const:1},definition:json,variant:json,bindings:json,metadata:json});
const entry={invocationId:uuid,inputDigest:digest,attemptId:uuid,copyId:uuid,userId,namespace:{...id,pattern:'^[a-zA-Z0-9-]+\\.[a-zA-Z0-9._-]+(?![\\s\\S])'},factoryName:id,factoryRevision:positive,kind:{enum:['pure','provision','activation']},packIndex:position,slotId:id,slotOrdinal:position};
const identity={protocol:{const:bindingFactoryProtocol},operation:{enum:['produce','provision','activate','lookup','cancel']},requestId:uuid,providerId:id,grantId:uuid,generation:positive,batchId:uuid,inputDigest:digest,deadline:positive};
export const bindingFactorySchema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://digital-card.invalid/binding-factory/v1',$ref:'#/$defs/request',$defs:{
 request:object({...identity,context:object({entries:{type:'array',minItems:1,maxItems:128,items:object({...entry,input:object({copy,user:json,spec:json})})}})}),
 response:{oneOf:[object({...identity,status:{const:'processed'},results:{type:'array',minItems:1,maxItems:128,items:{oneOf:[object({...entry,state:{const:'ready'},data:json}),object({...entry,state:{enum:['pending','not-created','cancelled','not-activated']}}),object({...entry,state:{const:'error'},errorCode:{enum:['unavailable','conflict','invalid-request']}})]}}}),object({...identity,status:{const:'error'},errorCode:{enum:['invalid-request','unauthenticated','rate-limited','unavailable']}})]},
}};
const ajv=new Ajv2020({strict:true});ajv.addSchema(bindingFactorySchema);
const request=ajv.compile({$ref:bindingFactorySchema.$id+'#/$defs/request'}),response=ajv.compile({$ref:bindingFactorySchema.$id+'#/$defs/response'});
export const bindingFactoryInputDigest=value=>contentDigest(Object.fromEntries(Object.entries(value).filter(([name])=>name!=='inputDigest')));
export const bindingFactoryIdentity=value=>Object.fromEntries(Object.keys(entry).map(name=>[name,value[name]]));
function validate(value,validator,code){try{
 if(!validator(value))throw Error();safeData(value,{maxBytes:1048576,maxDepth:40,maxNodes:1000000});
 const seen=new Set();for(const row of value.context?.entries??value.results??[]){
  if(seen.has(row.invocationId))throw Error();seen.add(row.invocationId);
  if(/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(row.userId)||!row.userId.trim())throw Error();
  if(row.input){
   safeData(row.input,{maxBytes:262144,maxDepth:32,maxNodes:100000});
   const {copy,user,spec}=row.input;
   if(copy.id!==row.copyId||copy.ownerId!==row.userId||user.id!==row.userId||spec.factory!==row.factoryName||!['public','owner'].includes(spec.visibility)||!['follow','retain','block'].includes(spec.transfer)||Object.hasOwn(copy.variant,'bindings')||!Number.isFinite(Date.parse(copy.createdAt))||!Number.isFinite(Date.parse(copy.acquiredAt))||bindingFactoryInputDigest(row)!==row.inputDigest)throw Error();
   if(value.operation==='produce'&&row.kind!=='pure'||value.operation==='provision'&&row.kind!=='provision'||value.operation==='activate'&&row.kind!=='activation'||value.operation==='cancel'&&row.kind==='activation')throw Error();
  }
  if(row.data)safeData(row.data,{maxBytes:32768,maxDepth:16,maxNodes:10000});
  if(row.state==='not-activated'&&row.kind!=='activation'||row.state==='cancelled'&&row.kind==='activation')throw Error();
 }return value;
 }catch{throw new FrameworkError(code,'Invalid binding factory data',502);}}
export const validateBindingFactoryRequest=value=>validate(value,request,'INVALID_BINDING_FACTORY_REQUEST');
export const validateBindingFactoryResponse=value=>validate(value,response,'INVALID_BINDING_FACTORY_RESPONSE');
export function matchBindingFactoryResults(request,response){validateBindingFactoryRequest(request);validateBindingFactoryResponse(response);const entries=request.context.entries;if(Object.keys(identity).some(key=>request[key]!==response[key])||response.status!=='processed'||response.results.length!==entries.length)throw new FrameworkError('INVALID_BINDING_FACTORY_RESPONSE','Binding factory identity differs',502);const rows=new Map(response.results.map(row=>[row.invocationId,row]));for(const expected of entries){const row=rows.get(expected.invocationId);if(!row||Object.entries(bindingFactoryIdentity(expected)).some(([key,value])=>row[key]!==value))throw new FrameworkError('INVALID_BINDING_FACTORY_RESPONSE','Binding factory identity differs',502);}return entries.map(entry=>rows.get(entry.invocationId));}
