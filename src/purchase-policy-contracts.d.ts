import type {Schemas} from './wire-types.js';

export interface PurchasePolicyIdentity {
  protocol: 'digital-card-purchase-policy@1';
  operation: 'canPurchase';
  scope: 'listing';
  phase: 'quote' | 'purchase';
  requestId: string;
  providerId: string;
  grantId: string;
  generation: number;
  commandId: string;
  inputDigest: string;
  snapshotDigest: string;
  deadline: number;
}
export interface PurchasePolicyShop {
  id: string;
  ownerId: string;
  kind: 'admin' | 'player';
}
export interface PurchasePolicyRequest extends PurchasePolicyIdentity {
  context: {
    user: {id: string};
    shop: PurchasePolicyShop;
    listing: {id: string; kind: 'mint-card' | 'mint-pack' | 'copies' | 'packs' | 'action'; price: Schemas['Money']};
    quantity: number;
    unitIds: string[];
  };
}
export type PolicyDecision =
  | {status: 'allowed'}
  | {status: 'denied'; reasonCode: 'ineligible' | 'restricted' | 'unavailable'}
  | {status: 'error'; errorCode: 'invalid-request' | 'unauthenticated' | 'rate-limited' | 'unavailable'};
export type PurchasePolicyResponse = PurchasePolicyIdentity & PolicyDecision;
export declare const purchasePolicyProtocol: 'digital-card-purchase-policy@1';
export declare const purchasePolicySchema: Record<string, unknown>;
/** Validates identifiers, bounds and the exact request shape; returns the original value or throws. */
export declare function validatePurchasePolicyRequest(value: unknown): PurchasePolicyRequest;
/** Validates the exact response shape; returns the original value or throws. */
export declare function validatePurchasePolicyResponse(value: unknown): PurchasePolicyResponse;
