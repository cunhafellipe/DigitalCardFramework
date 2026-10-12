import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';
import {allocationStrategySchema,allocationStrategyProtocol,validateAllocationStrategyRequest} from './allocation-strategy-contracts.js';

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
