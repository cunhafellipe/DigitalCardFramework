import type {AnyAllocationStrategyRequest, AnyAllocationStrategyResponse, AllocationStrategyVersion, AllocationStrategyIdentity} from './allocation-strategy-contracts.js';
import type {RemoteCodeProviderOptions} from './remote-code-provider.js';
export {
  allocationStrategyProtocol, allocationStrategySchema, validateAllocationStrategyRequest, validateAllocationStrategyResponse,
  allocationStrategyV2Protocol, allocationStrategyV2Schema, validateAllocationStrategyV2Request, validateAllocationStrategyV2Response,
  allocationStrategyV3Protocol, allocationStrategyV3Schema, validateAllocationStrategyV3Request, validateAllocationStrategyV3Response,
  allocationStrategyV4Protocol, allocationStrategyV4Schema, validateAllocationStrategyV4Request, validateAllocationStrategyV4Response,
} from './allocation-strategy-contracts.js';

export interface RemoteAllocationStrategyOptions extends RemoteCodeProviderOptions {
  scope: 'catalog-purchase';
  algorithm: `weighted-deck@${AllocationStrategyVersion}`;
}
export interface RemoteAllocationStrategy {
  readonly providerId: string;
  readonly timeoutMs: number;
  supportsAlgorithm(value: unknown): boolean;
  grant(): Readonly<Pick<AllocationStrategyIdentity<1>, 'providerId' | 'grantId' | 'generation'>>;
  assertGrant(grant: Readonly<Pick<AllocationStrategyIdentity<1>, 'providerId' | 'grantId' | 'generation'>>): void;
  /** Changing enabled state revokes the current grant and aborts active evaluations. */
  setEnabled(enabled: boolean): {providerId: string; scope: 'catalog-purchase'; enabled: boolean; generation: number};
  /** Permanently closes the adapter and aborts active evaluations. */
  close(): void;
  /** Remote error responses reject; successful replies match the request protocol. */
  evaluate<T extends AnyAllocationStrategyRequest>(request: T, options?: {signal?: AbortSignal}): Promise<Extract<AnyAllocationStrategyResponse, {protocol: T['protocol']; status: 'planned'}>>;
}
export declare function createRemoteAllocationStrategy(options: RemoteAllocationStrategyOptions): RemoteAllocationStrategy;
