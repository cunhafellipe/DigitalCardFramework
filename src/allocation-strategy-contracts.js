import {allocationCodeDemand} from './allocation-planner.js';
import {validateAllocationSolverAdmission} from './allocation-feasibility.js';
import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';

export const allocationStrategyProtocol='digital-card-pack-allocation@1';
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}(?![\\s\\S])'},digest={type:'string',pattern:'^[a-f0-9]{64}(?![\\s\\S])'},uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\\s\\S])'};
const number=(min,max=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:min,maximum:max}),object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),array=(items,max)=>({type:'array',items,maxItems:max});
const identity={protocol:{const:allocationStrategyProtocol},operation:{const:'allocatePacks'},scope:{const:'catalog-purchase'},phase:{const:'allocate'},requestId:uuid,attemptId:uuid,providerId:id,grantId:uuid,generation:number(1),commandId:digest,inputDigest:digest,snapshotDigest:digest,deadline:number(1)};
const slot=object({id,role:{enum:['card','insert']},count:number(1,100),probability:object({numerator:number(0,2147483647),denominator:number(1,2147483647)}),pool:{...array(object({variantId:id,weight:number(1,2147483647)}),2000)}});
const context=object({userId:id,product:object({id,revision:number(1),strategy:object({algorithm:{const:'weighted-deck@1'},version:{const:1},deckScope:{const:'purchase-slot'}}),slots:{...array(slot,100),minItems:1}}),quantity:number(1,100),variants:array(object({id,remaining:{anyOf:[number(0),{type:'null'}]}}),2000),entropy:object({seed:digest,cursor:number(0)})});
export const allocationStrategySchema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://digital-card.invalid/pack-allocation/v1',$ref:'#/$defs/request',$defs:{request:object({...identity,context}),response:{oneOf:[object({...identity,status:{const:'planned'},allocations:array(object({packIndex:number(0,99),slotId:id,variantIds:array(id,100)}),2000)}),object({...identity,status:{const:'error'},errorCode:{enum:['invalid-request','unauthenticated','rate-limited','unavailable']}})]}}};
const compiler=new Ajv2020({strict:true});compiler.addSchema(allocationStrategySchema);const request=compiler.compile({$ref:allocationStrategySchema.$id+'#/$defs/request'}),response=compiler.compile({$ref:allocationStrategySchema.$id+'#/$defs/response'});
export function validateAllocationStrategyRequest(value){if(!request(value)||value.context.product.slots.reduce((n,s)=>n+s.count,0)*value.context.quantity>2000||new Set(value.context.variants.map(v=>v.id)).size!==value.context.variants.length||new Set(value.context.product.slots.map(s=>s.id)).size!==value.context.product.slots.length||value.context.product.slots.some(s=>s.probability.numerator>s.probability.denominator||s.probability.numerator>0&&s.pool.length===0||new Set(s.pool.map(e=>e.variantId)).size!==s.pool.length||s.pool.some(e=>!value.context.variants.some(v=>v.id===e.variantId))||s.pool.reduce((n,e)=>n+e.weight,0)>2147483647))throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid allocation strategy request',400);return value;}
export function validateAllocationStrategyResponse(value){if(!response(value))throw new FrameworkError('INVALID_ALLOCATION_RESPONSE','Invalid allocation strategy response',502);return value;}

export const allocationStrategyV2Protocol='digital-card-pack-allocation@2';
export const allocationStrategyV2Schema=structuredClone(allocationStrategySchema);
allocationStrategyV2Schema.$id='https://digital-card.invalid/pack-allocation/v2';
for(const schema of [allocationStrategyV2Schema.$defs.request,...allocationStrategyV2Schema.$defs.response.oneOf])schema.properties.protocol.const=allocationStrategyV2Protocol;
const contextV2=allocationStrategyV2Schema.$defs.request.properties.context;
contextV2.properties.product.properties.strategy.properties.algorithm.const='weighted-deck@2';contextV2.properties.product.properties.strategy.properties.version.const=2;
Object.assign(contextV2.properties.product.properties,{duplicatePolicy:object({scope:{enum:['none','pack','inventory']},fallback:{enum:['allow','reject']}}),pity:{anyOf:[{type:'null'},object({after:number(1,1000),rarityId:id,minimumRank:number(0)})]}});contextV2.properties.product.required.push('duplicatePolicy','pity');
Object.assign(contextV2.properties,{mode:{const:'personalized'},ownedCards:array(object({cardId:id,owned:{type:'boolean'}}),2000),pityCount:number(0)});contextV2.required.push('mode','ownedCards','pityCount');
Object.assign(contextV2.properties.variants.items.properties,{cardId:id,rarityRank:number(0)});contextV2.properties.variants.items.required.push('cardId','rarityRank');
compiler.addSchema(allocationStrategyV2Schema);const requestV2=compiler.compile({$ref:allocationStrategyV2Schema.$id+'#/$defs/request'}),responseV2=compiler.compile({$ref:allocationStrategyV2Schema.$id+'#/$defs/response'});
export function validateAllocationStrategyV2Request(value){
  if(!requestV2(value))throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid allocation strategy request',400);
  return validateAllocationEligibility(value);
}
export function validateAllocationEligibility(value){
  const {mode,ownedCards,pityCount,...base}=value.context,{duplicatePolicy,pity,...product}=base.product;
  validateAllocationStrategyRequest({...value,protocol:allocationStrategyProtocol,context:{...base,product:{...product,strategy:{algorithm:'weighted-deck@1',version:1,deckScope:'purchase-slot'}},variants:base.variants.map(({id,remaining})=>({id,remaining}))}});
  const cards=new Set(base.variants.map(v=>v.cardId)),owned=new Set(ownedCards.map(v=>v.cardId)),requiresOwned=mode==='personalized'&&duplicatePolicy.scope==='inventory';
  if(owned.size!==ownedCards.length||ownedCards.some(v=>!cards.has(v.cardId))||requiresOwned&&(owned.size!==cards.size)||!requiresOwned&&ownedCards.length||mode==='stock'&&pityCount!==0||!pity&&pityCount!==0)throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid allocation eligibility snapshot',400);return value;
}
export function validateAllocationStrategyV2Response(value){if(!responseV2(value))throw new FrameworkError('INVALID_ALLOCATION_RESPONSE','Invalid allocation strategy response',502);return value;}

export const allocationStrategyV3Protocol='digital-card-pack-allocation@3';
export const allocationStrategyV3Schema=structuredClone(allocationStrategyV2Schema);
allocationStrategyV3Schema.$id='https://digital-card.invalid/pack-allocation/v3';
for(const schema of [allocationStrategyV3Schema.$defs.request,...allocationStrategyV3Schema.$defs.response.oneOf])schema.properties.protocol.const=allocationStrategyV3Protocol;
const contextV3=allocationStrategyV3Schema.$defs.request.properties.context;
contextV3.properties.product.properties.strategy.properties.algorithm.const='weighted-deck@3';contextV3.properties.product.properties.strategy.properties.version.const=3;
contextV3.properties.codePools=array(object({id,available:number(0,1000)}),64);contextV3.required.push('codePools');
contextV3.properties.variants.items.properties.codeDemand=array(object({poolId:id,count:number(1,8)}),8);contextV3.properties.variants.items.required.push('codeDemand');
compiler.addSchema(allocationStrategyV3Schema);const requestV3=compiler.compile({$ref:allocationStrategyV3Schema.$id+'#/$defs/request'}),responseV3=compiler.compile({$ref:allocationStrategyV3Schema.$id+'#/$defs/response'});
export function validateAllocationStrategyV3Request(value){if(!requestV3(value))throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid allocation strategy request',400);return validateAllocationCodeEligibility(value);}
export function validateAllocationCodeEligibility(value){
  const {codePools,...context}=value.context;validateAllocationEligibility({...value,protocol:allocationStrategyV2Protocol,context:{...context,product:{...context.product,strategy:{algorithm:'weighted-deck@2',version:2,deckScope:'purchase-slot'}},variants:context.variants.map(({codeDemand,...v})=>v)}});
  let demand;try{demand=allocationCodeDemand(context.product,context.variants,context.quantity);}catch{throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid allocation resource scope',400);}
  if(new Set(codePools.map(p=>p.id)).size!==codePools.length||codePools.length!==demand.size||codePools.some(p=>!demand.has(p.id)||p.available>demand.get(p.id))||context.variants.some(v=>new Set(v.codeDemand.map(d=>d.poolId)).size!==v.codeDemand.length||v.codeDemand.reduce((n,d)=>n+d.count,0)>8))throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid allocation resource snapshot',400);return value;
}
export function validateAllocationStrategyV3Response(value){if(!responseV3(value))throw new FrameworkError('INVALID_ALLOCATION_RESPONSE','Invalid allocation strategy response',502);return value;}

export const allocationStrategyV4Protocol='digital-card-pack-allocation@4';
export const allocationStrategyV4Schema=structuredClone(allocationStrategyV3Schema);
allocationStrategyV4Schema.$id='https://digital-card.invalid/pack-allocation/v4';
for(const schema of [allocationStrategyV4Schema.$defs.request,...allocationStrategyV4Schema.$defs.response.oneOf])schema.properties.protocol.const=allocationStrategyV4Protocol;
const contextV4=allocationStrategyV4Schema.$defs.request.properties.context;
contextV4.properties.product.properties.strategy.properties.algorithm.const='weighted-deck@4';contextV4.properties.product.properties.strategy.properties.version.const=4;
compiler.addSchema(allocationStrategyV4Schema);const requestV4=compiler.compile({$ref:allocationStrategyV4Schema.$id+'#/$defs/request'}),responseV4=compiler.compile({$ref:allocationStrategyV4Schema.$id+'#/$defs/response'});
export function validateAllocationFeasibilityEligibility(value){validateAllocationCodeEligibility(value);validateAllocationSolverAdmission(value.context);return value;}
export function validateAllocationStrategyV4Request(value){if(!requestV4(value))throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid allocation strategy request',400);return validateAllocationFeasibilityEligibility(value);}
export function validateAllocationStrategyV4Response(value){if(!responseV4(value))throw new FrameworkError('INVALID_ALLOCATION_RESPONSE','Invalid allocation strategy response',502);return value;}
