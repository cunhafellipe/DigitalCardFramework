import {FrameworkError} from './catalog.js';
import {createRemotePolicyTransport} from './remote-policy-transport.js';
import {stockAllocationStrategyProtocol,stockAllocationStrategySchema,validateStockAllocationStrategyRequest,validateStockAllocationStrategyResponse} from './stock-allocation-strategy-contracts.js';
export {stockAllocationStrategyProtocol,stockAllocationStrategySchema,validateStockAllocationStrategyRequest,validateStockAllocationStrategyResponse};
export function createRemoteStockAllocationStrategy(options){
  if(!options||options.algorithm!=='weighted-deck@1')throw new FrameworkError('ALLOCATION_CONFIG','Unsupported remote stock allocation algorithm',400);
  const {algorithm,...transport}=options;transport.maxResponseBytes??=262144;return createRemotePolicyTransport(transport,{scope:'commerce-stock',requestBytes:1048576,responseBytes:262144,validateRequest:validateStockAllocationStrategyRequest,validateResponse:validateStockAllocationStrategyResponse});
}
