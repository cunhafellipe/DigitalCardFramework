import type {ListingPolicyIdentity, ListingPolicyRequest, ListingPolicyResponse} from './listing-policy-contracts.js';
export {listingPolicyProtocol, listingPolicySchema, validateListingPolicyRequest, validateListingPolicyResponse} from './listing-policy-contracts.js';
export type {ListingPolicyIdentity, ListingPolicyRequest, ListingPolicyResponse} from './listing-policy-contracts.js';

export interface RemoteListingPolicyOptions {
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
export interface RemoteListingPolicy {
  readonly providerId: string;
  readonly timeoutMs: number;
  grant(): Readonly<Pick<ListingPolicyIdentity, 'providerId' | 'grantId' | 'generation'>>;
  assertGrant(grant: Readonly<Pick<ListingPolicyIdentity, 'providerId' | 'grantId' | 'generation'>>): void;
  /** Changing enabled state revokes the current grant and aborts active evaluations. */
  setEnabled(enabled: boolean): {providerId: string; scope: 'listing'; enabled: boolean; generation: number};
  /** Permanently closes the adapter and aborts active evaluations. */
  close(): void;
  /** Remote error responses reject; only allowed and denied decisions resolve. */
  evaluate(request: ListingPolicyRequest, options?: {signal?: AbortSignal}): Promise<Exclude<ListingPolicyResponse, {status: 'error'}>>;
}
export declare function createRemoteListingPolicy(options: RemoteListingPolicyOptions): RemoteListingPolicy;
