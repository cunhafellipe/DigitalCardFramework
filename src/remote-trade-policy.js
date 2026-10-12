import {createRemotePolicyTransport} from './remote-policy-transport.js';
import {validateTradePolicyRequest,validateTradePolicyResponse} from './trade-policy-contracts.js';
export {tradePolicyProtocol,tradePolicySchema,validateTradePolicyRequest,validateTradePolicyResponse} from './trade-policy-contracts.js';
export const createRemoteTradePolicy=options=>createRemotePolicyTransport(options,{validateRequest:validateTradePolicyRequest,validateResponse:validateTradePolicyResponse,scope:'exchange',requestBytes:262144});
