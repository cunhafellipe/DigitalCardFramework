import type {RemoteAllocationStrategy, RemoteAllocationStrategyOptions} from './remote-allocation-strategy.js';
import type {AnyStockAllocationStrategyRequest, AnyStockAllocationStrategyResponse} from './stock-allocation-strategy-contracts.js';
export {
  stockAllocationStrategyProtocol, stockAllocationStrategySchema, validateStockAllocationStrategyRequest, validateStockAllocationStrategyResponse,
  stockAllocationStrategyV2Protocol, stockAllocationStrategyV2Schema, validateStockAllocationStrategyV2Request, validateStockAllocationStrategyV2Response,
  stockAllocationStrategyV3Protocol, stockAllocationStrategyV3Schema, validateStockAllocationStrategyV3Request, validateStockAllocationStrategyV3Response,
  stockAllocationStrategyV4Protocol, stockAllocationStrategyV4Schema, validateStockAllocationStrategyV4Request, validateStockAllocationStrategyV4Response,
} from './stock-allocation-strategy-contracts.js';

export interface RemoteStockAllocationStrategyOptions extends Omit<RemoteAllocationStrategyOptions, 'scope'> {
  scope: 'commerce-stock';
}
export interface RemoteStockAllocationStrategy extends Omit<RemoteAllocationStrategy, 'setEnabled' | 'evaluate'> {
  setEnabled(enabled: boolean): {providerId: string; scope: 'commerce-stock'; enabled: boolean; generation: number};
  /** Remote error responses reject; successful replies match the request protocol. */
  evaluate<T extends AnyStockAllocationStrategyRequest>(request: T, options?: {signal?: AbortSignal}): Promise<Extract<AnyStockAllocationStrategyResponse, {protocol: T['protocol']; status: 'planned'}>>;
}
export declare function createRemoteStockAllocationStrategy(options: RemoteStockAllocationStrategyOptions): RemoteStockAllocationStrategy;
