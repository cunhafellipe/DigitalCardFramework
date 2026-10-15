import type {TradePolicyIdentity, TradePolicyRequest, TradePolicyResponse} from './trade-policy-contracts.js';
export {tradePolicyProtocol, tradePolicySchema, validateTradePolicyRequest, validateTradePolicyResponse} from './trade-policy-contracts.js';
export type {TradePolicyIdentity, TradePolicyRequest, TradePolicyResponse} from './trade-policy-contracts.js';

export interface RemoteTradePolicyOptions {
  scope: 'exchange';
  providerId: string;
  url: string;
  token: string;
  allowLoopbackHttp?: boolean;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxConcurrent?: number;
}
export interface RemoteTradePolicy {
  readonly providerId: string;
  readonly timeoutMs: number;
  grant(): Readonly<Pick<TradePolicyIdentity, 'providerId' | 'grantId' | 'generation'>>;
  assertGrant(grant: Readonly<Pick<TradePolicyIdentity, 'providerId' | 'grantId' | 'generation'>>): void;
  /** Changing enabled state revokes the current grant and aborts active evaluations. */
  setEnabled(enabled: boolean): {providerId: string; scope: 'exchange'; enabled: boolean; generation: number};
  /** Permanently closes the adapter and aborts active evaluations. */
  close(): void;
  /** Remote error responses reject; only allowed and denied decisions resolve. */
  evaluate(request: TradePolicyRequest, options?: {signal?: AbortSignal}): Promise<Exclude<TradePolicyResponse, {status: 'error'}>>;
}
export declare function createRemoteTradePolicy(options: RemoteTradePolicyOptions): RemoteTradePolicy;
