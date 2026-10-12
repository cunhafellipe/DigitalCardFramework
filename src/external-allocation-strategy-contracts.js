import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';
import {allocationStrategySchema,allocationStrategyProtocol,validateAllocationStrategyRequest} from './allocation-strategy-contracts.js';

export const externalAllocationStrategyProtocol='digital-card-external-allocation@1';
export const externalAllocationStrategySchema=structuredClone(allocationStrategySchema);
externalAllocationStrategySchema.$id='https://digital-card.invalid/external-allocation/v1';
for(const schema of [externalAllocationStrategySchema.$defs.request,...externalAllocationStrategySchema.$defs.response.oneOf]){
  schema.properties.protocol.const=externalAllocationStrategyProtocol;schema.properties.scope.const='external-fulfillment';
}
const context=externalAllocationStrategySchema.$defs.request.properties.context,id=context.properties.userId;
context.properties.preparationId={type:'string',pattern:'^ep_[a-f0-9]{64}(?![\\s\\S])'};context.required.push('preparationId');
const compiler=new Ajv2020({strict:true});compiler.addSchema(externalAllocationStrategySchema);
const request=compiler.compile({$ref:externalAllocationStrategySchema.$id+'#/$defs/request'}),response=compiler.compile({$ref:externalAllocationStrategySchema.$id+'#/$defs/response'});
export function validateExternalAllocationStrategyRequest(value){
  if(!request(value))throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid external allocation strategy request',400);
  const {preparationId,...context}=value.context;validateAllocationStrategyRequest({...value,protocol:allocationStrategyProtocol,scope:'catalog-purchase',context});return value;
}
export function validateExternalAllocationStrategyResponse(value){if(!response(value))throw new FrameworkError('INVALID_ALLOCATION_RESPONSE','Invalid external allocation strategy response',502);return value;}
