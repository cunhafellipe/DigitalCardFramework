import {FrameworkError} from './catalog.js';
import {createRemotePolicyTransport} from './remote-policy-transport.js';
import {allocationStrategyProtocol,allocationStrategySchema,validateAllocationStrategyRequest,validateAllocationStrategyResponse} from './allocation-strategy-contracts.js';
export {allocationStrategyProtocol,allocationStrategySchema,validateAllocationStrategyRequest,validateAllocationStrategyResponse};
export function createRemoteAllocationStrategy(options){
  if(!options||options.algorithm!=='weighted-deck@1')throw new FrameworkError('ALLOCATION_CONFIG','Unsupported remote allocation algorithm',400);
  const {algorithm,...transport}=options;transport.maxResponseBytes??=262144;return createRemotePolicyTransport(transport,{scope:'catalog-purchase',requestBytes:1048576,responseBytes:262144,validateRequest:validateAllocationStrategyRequest,validateResponse:validateAllocationStrategyResponse});
}
