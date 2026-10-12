import {createRemotePolicyTransport} from './remote-policy-transport.js';
import {validateTransferPolicyRequest,validateTransferPolicyResponse} from './transfer-policy-contracts.js';
export {transferPolicyProtocol,transferPolicySchema,validateTransferPolicyRequest,validateTransferPolicyResponse} from './transfer-policy-contracts.js';
export const createRemoteTransferPolicy=options=>createRemotePolicyTransport(options,{validateRequest:validateTransferPolicyRequest,validateResponse:validateTransferPolicyResponse,scope:'transfer',requestBytes:262144});
