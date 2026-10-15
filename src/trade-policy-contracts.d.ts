import type {Schemas} from './wire-types.js';
import type {PolicyDecision, PurchasePolicyIdentity} from './purchase-policy-contracts.js';

export interface TradePolicyIdentity extends Omit<PurchasePolicyIdentity, 'protocol' | 'operation' | 'scope' | 'phase'> {
  protocol: 'digital-card-trade-policy@1';
  operation: 'canTrade';
  scope: 'exchange';
  phase: 'review' | 'propose' | 'counter' | 'accept' | 'quote' | 'purchase';
}
export interface TradePolicyOffer {copyIds: string[]; currencies: Schemas['Money'][];}
export interface TradePolicyRequest extends TradePolicyIdentity {
  context: {
    channel: 'trade' | 'sale';
    fromUserId: string;
    toUserId: string;
    give: TradePolicyOffer;
    receive: TradePolicyOffer;
    expiresInSeconds?: number;
  };
}
export type TradePolicyResponse = TradePolicyIdentity & PolicyDecision;
export declare const tradePolicyProtocol: 'digital-card-trade-policy@1';
export declare const tradePolicySchema: Record<string, unknown>;
/** Validates identifiers, bounds, exact request shape and the total offered copy limit. */
export declare function validateTradePolicyRequest(value: unknown): TradePolicyRequest;
/** Validates the exact response shape; returns the original value or throws. */
export declare function validateTradePolicyResponse(value: unknown): TradePolicyResponse;
