import type {PurchasePolicyIdentity, PurchasePolicyRequest, PurchasePolicyResponse} from './purchase-policy-contracts.js';
export {purchasePolicyProtocol, purchasePolicySchema, validatePurchasePolicyRequest, validatePurchasePolicyResponse} from './purchase-policy-contracts.js';
export type {PurchasePolicyIdentity, PurchasePolicyRequest, PurchasePolicyResponse} from './purchase-policy-contracts.js';

export interface RemotePurchasePolicyOptions {
  scope: 'listing';
  providerId: string;
  url: string;
  token: string;
  allowLoopbackHttp?: boolean;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxConcurrent?: number;
}
export interface RemotePurchasePolicy {
  readonly providerId: string;
  readonly timeoutMs: number;
  grant(): Readonly<Pick<PurchasePolicyIdentity, 'providerId' | 'grantId' | 'generation'>>;
  assertGrant(grant: Readonly<Pick<PurchasePolicyIdentity, 'providerId' | 'grantId' | 'generation'>>): void;
  /** Changing enabled state revokes the current grant and aborts active evaluations. */
  setEnabled(enabled: boolean): {providerId: string; scope: 'listing'; enabled: boolean; generation: number};
  /** Permanently closes the adapter and aborts active evaluations. */
  close(): void;
  /** Remote error responses reject; only allowed and denied decisions resolve. */
  evaluate(request: PurchasePolicyRequest, options?: {signal?: AbortSignal}): Promise<Exclude<PurchasePolicyResponse, {status: 'error'}>>;
}
export declare function createRemotePurchasePolicy(options: RemotePurchasePolicyOptions): RemotePurchasePolicy;
