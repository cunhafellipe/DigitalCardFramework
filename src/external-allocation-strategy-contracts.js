import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';
import {allocationStrategySchema,allocationStrategyProtocol,validateAllocationStrategyRequest,allocationStrategyV2Schema,allocationStrategyV2Protocol,validateAllocationStrategyV2Request,validateAllocationEligibility,allocationStrategyV3Schema,allocationStrategyV3Protocol,validateAllocationCodeEligibility,allocationStrategyV4Schema,allocationStrategyV4Protocol,validateAllocationFeasibilityEligibility} from './allocation-strategy-contracts.js';

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

export const externalAllocationStrategyV2Protocol='digital-card-external-allocation@2';
export const externalAllocationStrategyV2Schema=structuredClone(allocationStrategyV2Schema);
externalAllocationStrategyV2Schema.$id='https://digital-card.invalid/external-allocation/v2';
for(const schema of [externalAllocationStrategyV2Schema.$defs.request,...externalAllocationStrategyV2Schema.$defs.response.oneOf]){schema.properties.protocol.const=externalAllocationStrategyV2Protocol;schema.properties.scope.const='external-fulfillment';}
const contextV2=externalAllocationStrategyV2Schema.$defs.request.properties.context;
contextV2.properties.preparationId={type:'string',pattern:'^ep_[a-f0-9]{64}(?![\\s\\S])'};contextV2.required.push('preparationId');
contextV2.properties.mode.const='personalized';
compiler.addSchema(externalAllocationStrategyV2Schema);const requestV2=compiler.compile({$ref:externalAllocationStrategyV2Schema.$id+'#/$defs/request'}),responseV2=compiler.compile({$ref:externalAllocationStrategyV2Schema.$id+'#/$defs/response'});
export function validateExternalAllocationStrategyV2Request(value){
  if(!requestV2(value))throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid external allocation strategy request',400);
  const {preparationId,...context}=value.context;validateAllocationEligibility({...value,protocol:allocationStrategyV2Protocol,scope:'catalog-purchase',context});return value;
}
export function validateExternalAllocationStrategyV2Response(value){if(!responseV2(value))throw new FrameworkError('INVALID_ALLOCATION_RESPONSE','Invalid external allocation strategy response',502);return value;}

export const externalAllocationStrategyV3Protocol='digital-card-external-allocation@3';
export const externalAllocationStrategyV3Schema=structuredClone(allocationStrategyV3Schema);
externalAllocationStrategyV3Schema.$id='https://digital-card.invalid/external-allocation/v3';
for(const schema of [externalAllocationStrategyV3Schema.$defs.request,...externalAllocationStrategyV3Schema.$defs.response.oneOf]){schema.properties.protocol.const=externalAllocationStrategyV3Protocol;schema.properties.scope.const='external-fulfillment';}
const contextV3=externalAllocationStrategyV3Schema.$defs.request.properties.context;
contextV3.properties.preparationId=structuredClone(contextV2.properties.preparationId);contextV3.required.push('preparationId');contextV3.properties.mode.const='personalized';
compiler.addSchema(externalAllocationStrategyV3Schema);const requestV3=compiler.compile({$ref:externalAllocationStrategyV3Schema.$id+'#/$defs/request'}),responseV3=compiler.compile({$ref:externalAllocationStrategyV3Schema.$id+'#/$defs/response'});
export function validateExternalAllocationStrategyV3Request(value){if(!requestV3(value))throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid external allocation strategy request',400);const {preparationId,...context}=value.context;validateAllocationCodeEligibility({...value,protocol:allocationStrategyV3Protocol,scope:'catalog-purchase',context});return value;}
export function validateExternalAllocationStrategyV3Response(value){if(!responseV3(value))throw new FrameworkError('INVALID_ALLOCATION_RESPONSE','Invalid external allocation strategy response',502);return value;}

export const externalAllocationStrategyV4Protocol='digital-card-external-allocation@4';
export const externalAllocationStrategyV4Schema=structuredClone(allocationStrategyV4Schema);
externalAllocationStrategyV4Schema.$id='https://digital-card.invalid/external-allocation/v4';
for(const schema of [externalAllocationStrategyV4Schema.$defs.request,...externalAllocationStrategyV4Schema.$defs.response.oneOf]){schema.properties.protocol.const=externalAllocationStrategyV4Protocol;schema.properties.scope.const='external-fulfillment';}
const contextV4=externalAllocationStrategyV4Schema.$defs.request.properties.context;
contextV4.properties.preparationId=structuredClone(contextV2.properties.preparationId);contextV4.required.push('preparationId');contextV4.properties.mode.const='personalized';
compiler.addSchema(externalAllocationStrategyV4Schema);const requestV4=compiler.compile({$ref:externalAllocationStrategyV4Schema.$id+'#/$defs/request'}),responseV4=compiler.compile({$ref:externalAllocationStrategyV4Schema.$id+'#/$defs/response'});
export function validateExternalAllocationStrategyV4Request(value){if(!requestV4(value))throw new FrameworkError('INVALID_ALLOCATION_REQUEST','Invalid external allocation strategy request',400);const {preparationId,...context}=value.context;validateAllocationFeasibilityEligibility({...value,protocol:allocationStrategyV4Protocol,scope:'catalog-purchase',context});return value;}
export function validateExternalAllocationStrategyV4Response(value){if(!responseV4(value))throw new FrameworkError('INVALID_ALLOCATION_RESPONSE','Invalid external allocation strategy response',502);return value;}
