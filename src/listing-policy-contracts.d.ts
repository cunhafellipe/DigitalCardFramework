import type {Schemas} from './wire-types.js';
import type {PolicyDecision, PurchasePolicyIdentity, PurchasePolicyShop} from './purchase-policy-contracts.js';

export interface ListingPolicyIdentity extends Omit<PurchasePolicyIdentity, 'protocol' | 'operation' | 'scope' | 'phase'> {
  protocol: 'digital-card-listing-policy@1';
  operation: 'canList';
  scope: 'listing';
  phase: 'create';
}
export type ListingPolicyStock =
  | Pick<Extract<Schemas['ListingStock'], {kind: 'copies' | 'packs'}>, 'kind' | 'ids'>
  | Pick<Extract<Schemas['ListingStock'], {kind: 'mint-card'}>, 'kind' | 'variantId' | 'quantity'>
  | Pick<Extract<Schemas['ListingStock'], {kind: 'mint-pack'}>, 'kind' | 'productId' | 'quantity'>
  | Pick<Extract<Schemas['ListingStock'], {kind: 'action'}>, 'kind' | 'handler' | 'quantity'>;
export interface ListingPolicyRequest extends ListingPolicyIdentity {
  context: {actor: {id: string}; shop: PurchasePolicyShop; price: Schemas['Money']; stock: ListingPolicyStock};
}
export type ListingPolicyResponse = ListingPolicyIdentity & PolicyDecision;
export declare const listingPolicyProtocol: 'digital-card-listing-policy@1';
export declare const listingPolicySchema: Record<string, unknown>;
/** Validates identifiers, bounds and the exact request shape; returns the original value or throws. */
export declare function validateListingPolicyRequest(value: unknown): ListingPolicyRequest;
/** Validates the exact response shape; returns the original value or throws. */
export declare function validateListingPolicyResponse(value: unknown): ListingPolicyResponse;
