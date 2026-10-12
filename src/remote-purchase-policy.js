import {createRemotePolicyTransport} from './remote-policy-transport.js';
import {validatePurchasePolicyRequest,validatePurchasePolicyResponse} from './purchase-policy-contracts.js';

export {purchasePolicyProtocol,purchasePolicySchema,validatePurchasePolicyRequest,validatePurchasePolicyResponse} from './purchase-policy-contracts.js';

/** The owning framework controls the live grant and may revoke it during evaluation. */
export function createRemotePurchasePolicy(options){
  return createRemotePolicyTransport(options,{validateRequest:validatePurchasePolicyRequest,validateResponse:validatePurchasePolicyResponse});
}
