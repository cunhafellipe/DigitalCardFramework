import type {TransferPolicyIdentity, TransferPolicyRequest, TransferPolicyResponse} from './transfer-policy-contracts.js';
export {transferPolicyProtocol, transferPolicySchema, validateTransferPolicyRequest, validateTransferPolicyResponse} from './transfer-policy-contracts.js';
export type {TransferPolicyIdentity, TransferPolicyRequest, TransferPolicyResponse} from './transfer-policy-contracts.js';

export interface RemoteTransferPolicyOptions {
  scope: 'transfer';
  providerId: string;
  url: string;
  token: string;
  allowLoopbackHttp?: boolean;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxConcurrent?: number;
}
export interface RemoteTransferPolicy {
  readonly providerId: string;
  readonly timeoutMs: number;
  grant(): Readonly<Pick<TransferPolicyIdentity, 'providerId' | 'grantId' | 'generation'>>;
  assertGrant(grant: Readonly<Pick<TransferPolicyIdentity, 'providerId' | 'grantId' | 'generation'>>): void;
  /** Changing enabled state revokes the current grant and aborts active evaluations. */
  setEnabled(enabled: boolean): {providerId: string; scope: 'transfer'; enabled: boolean; generation: number};
  /** Permanently closes the adapter and aborts active evaluations. */
  close(): void;
  /** Remote error responses reject; only allowed and denied decisions resolve. */
  evaluate(request: TransferPolicyRequest, options?: {signal?: AbortSignal}): Promise<Exclude<TransferPolicyResponse, {status: 'error'}>>;
}
export declare function createRemoteTransferPolicy(options: RemoteTransferPolicyOptions): RemoteTransferPolicy;
