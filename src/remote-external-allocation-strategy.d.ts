import type {RemoteAllocationStrategy, RemoteAllocationStrategyOptions} from './remote-allocation-strategy.js';
import type {AnyExternalAllocationStrategyRequest, AnyExternalAllocationStrategyResponse} from './external-allocation-strategy-contracts.js';
export {
  externalAllocationStrategyProtocol, externalAllocationStrategySchema, validateExternalAllocationStrategyRequest, validateExternalAllocationStrategyResponse,
  externalAllocationStrategyV2Protocol, externalAllocationStrategyV2Schema, validateExternalAllocationStrategyV2Request, validateExternalAllocationStrategyV2Response,
  externalAllocationStrategyV3Protocol, externalAllocationStrategyV3Schema, validateExternalAllocationStrategyV3Request, validateExternalAllocationStrategyV3Response,
  externalAllocationStrategyV4Protocol, externalAllocationStrategyV4Schema, validateExternalAllocationStrategyV4Request, validateExternalAllocationStrategyV4Response,
} from './external-allocation-strategy-contracts.js';

export interface RemoteExternalAllocationStrategyOptions extends Omit<RemoteAllocationStrategyOptions, 'scope'> {
  scope: 'external-fulfillment';
}
export interface RemoteExternalAllocationStrategy extends Omit<RemoteAllocationStrategy, 'setEnabled' | 'evaluate'> {
  setEnabled(enabled: boolean): {providerId: string; scope: 'external-fulfillment'; enabled: boolean; generation: number};
  /** Remote error responses reject; successful replies match the request protocol. */
  evaluate<T extends AnyExternalAllocationStrategyRequest>(request: T, options?: {signal?: AbortSignal}): Promise<Extract<AnyExternalAllocationStrategyResponse, {protocol: T['protocol']; status: 'planned'}>>;
}
export declare function createRemoteExternalAllocationStrategy(options: RemoteExternalAllocationStrategyOptions): RemoteExternalAllocationStrategy;
