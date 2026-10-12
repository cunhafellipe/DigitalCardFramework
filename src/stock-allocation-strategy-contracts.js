import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';
import {allocationStrategySchema,allocationStrategyProtocol,validateAllocationStrategyRequest,allocationStrategyV2Schema,allocationStrategyV2Protocol,validateAllocationStrategyV2Request,validateAllocationEligibility} from './allocation-strategy-contracts.js';

export const stockAllocationStrategyProtocol='digital-card-commerce-stock-allocation@1';
export const stockAllocationStrategySchema=structuredClone(allocationStrategySchema);
stockAllocationStrategySchema.$id='https://digital-card.invalid/commerce-stock-allocation/v1';
for(const schema of [stockAllocationStrategySchema.$defs.request,...stockAllocationStrategySchema.$defs.response.oneOf]){
  schema.properties.protocol.const=stockAllocationStrategyProtocol;schema.properties.scope.const='commerce-stock';
}
const context=stockAllocationStrategySchema.$defs.request.properties.context,id=context.properties.userId;
context.properties.shop={type:'object',additionalProperties:false,required:['id','ownerId'],properties:{id:{type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\\s\\S])'},ownerId:structuredClone(id)}};context.required.push('shop');
const compiler=new Ajv2020({strict:true});compiler.addSchema(stockAllocationStrategySchema);
const request=compiler.compile({$ref:stockAllocationStrategySchema.$id+'#/$defs/request'}),response=compiler.compile({$ref:stockAllocationStrategySchema.$id+'#/$defs/response'});
export function validateStockAllocationStrategyRequest(value){
  if(!request(value))throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid stock allocation strategy request',400);
  const {shop,...context}=value.context;validateAllocationStrategyRequest({...value,protocol:allocationStrategyProtocol,scope:'catalog-purchase',context});return value;
}
export function validateStockAllocationStrategyResponse(value){if(!response(value))throw new FrameworkError('INVALID_ALLOCATION_RESPONSE','Invalid stock allocation strategy response',502);return value;}

export const stockAllocationStrategyV2Protocol='digital-card-commerce-stock-allocation@2';
export const stockAllocationStrategyV2Schema=structuredClone(allocationStrategyV2Schema);
stockAllocationStrategyV2Schema.$id='https://digital-card.invalid/commerce-stock-allocation/v2';
for(const schema of [stockAllocationStrategyV2Schema.$defs.request,...stockAllocationStrategyV2Schema.$defs.response.oneOf]){schema.properties.protocol.const=stockAllocationStrategyV2Protocol;schema.properties.scope.const='commerce-stock';}
const contextV2=stockAllocationStrategyV2Schema.$defs.request.properties.context;
contextV2.properties.shop={type:'object',additionalProperties:false,required:['id','ownerId'],properties:{id:{type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\\s\\S])'},ownerId:structuredClone(contextV2.properties.userId)}};contextV2.required.push('shop');
contextV2.properties.mode.const='stock';
compiler.addSchema(stockAllocationStrategyV2Schema);const requestV2=compiler.compile({$ref:stockAllocationStrategyV2Schema.$id+'#/$defs/request'}),responseV2=compiler.compile({$ref:stockAllocationStrategyV2Schema.$id+'#/$defs/response'});
export function validateStockAllocationStrategyV2Request(value){
  if(!requestV2(value))throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid stock allocation strategy request',400);
  const {shop,...context}=value.context;validateAllocationEligibility({...value,protocol:allocationStrategyV2Protocol,scope:'catalog-purchase',context});return value;
}
export function validateStockAllocationStrategyV2Response(value){if(!responseV2(value))throw new FrameworkError('INVALID_ALLOCATION_RESPONSE','Invalid stock allocation strategy response',502);return value;}
