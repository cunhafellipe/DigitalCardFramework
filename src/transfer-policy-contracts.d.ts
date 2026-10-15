import type {PolicyDecision, PurchasePolicyIdentity} from './purchase-policy-contracts.js';

export interface TransferPolicyIdentity extends Omit<PurchasePolicyIdentity, 'protocol' | 'operation' | 'scope' | 'phase'> {
  protocol: 'digital-card-transfer-policy@1';
  operation: 'canTransfer';
  scope: 'transfer';
  phase: 'review' | 'propose' | 'counter' | 'accept' | 'list' | 'quote' | 'purchase';
}
export interface TransferPolicyLeg {
  fromUserId: string;
  toUserId: string | null;
  copyIds: string[];
  versions: number[];
}
export interface TransferPolicyRequest extends TransferPolicyIdentity {
  context: {channel: 'trade' | 'sale'; legs: TransferPolicyLeg[]};
}
export type TransferPolicyResponse = TransferPolicyIdentity & PolicyDecision;
export declare const transferPolicyProtocol: 'digital-card-transfer-policy@1';
export declare const transferPolicySchema: Record<string, unknown>;
/** Also checks matching copy/version counts, distinct copies and the total copy limit. */
export declare function validateTransferPolicyRequest(value: unknown): TransferPolicyRequest;
/** Validates the exact response shape; returns the original value or throws. */
export declare function validateTransferPolicyResponse(value: unknown): TransferPolicyResponse;
