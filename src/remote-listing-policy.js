import {createRemotePolicyTransport} from './remote-policy-transport.js';
import {validateListingPolicyRequest,validateListingPolicyResponse} from './listing-policy-contracts.js';

export {listingPolicyProtocol,listingPolicySchema,validateListingPolicyRequest,validateListingPolicyResponse} from './listing-policy-contracts.js';

/** Evaluate only proposed listing terms; all issuance remains inside the framework. */
export function createRemoteListingPolicy(options){
  return createRemotePolicyTransport(options,{validateRequest:validateListingPolicyRequest,validateResponse:validateListingPolicyResponse});
}
