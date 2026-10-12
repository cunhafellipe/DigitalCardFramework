import {FrameworkError} from './catalog.js';
import {createRemotePolicyTransport} from './remote-policy-transport.js';
import {externalAllocationStrategyProtocol,externalAllocationStrategySchema,validateExternalAllocationStrategyRequest,validateExternalAllocationStrategyResponse} from './external-allocation-strategy-contracts.js';
export {externalAllocationStrategyProtocol,externalAllocationStrategySchema,validateExternalAllocationStrategyRequest,validateExternalAllocationStrategyResponse};
export function createRemoteExternalAllocationStrategy(options){
  if(!options||options.algorithm!=='weighted-deck@1')throw new FrameworkError('ALLOCATION_CONFIG','Unsupported remote external allocation algorithm',400);
  const {algorithm,...transport}=options;transport.maxResponseBytes??=262144;return createRemotePolicyTransport(transport,{scope:'external-fulfillment',requestBytes:1048576,responseBytes:262144,validateRequest:validateExternalAllocationStrategyRequest,validateResponse:validateExternalAllocationStrategyResponse});
}
