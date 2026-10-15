import {purchasePolicyProtocol, purchasePolicySchema, validatePurchasePolicyRequest, validatePurchasePolicyResponse, type PurchasePolicyRequest, type PurchasePolicyResponse} from '@digital-card/framework/purchase-policy-contracts';
import {listingPolicyProtocol, listingPolicySchema, validateListingPolicyRequest, validateListingPolicyResponse, type ListingPolicyRequest, type ListingPolicyStock} from '@digital-card/framework/listing-policy-contracts';
import {transferPolicyProtocol, transferPolicySchema, validateTransferPolicyRequest, validateTransferPolicyResponse, type TransferPolicyRequest} from '@digital-card/framework/transfer-policy-contracts';
import {tradePolicyProtocol, tradePolicySchema, validateTradePolicyRequest, validateTradePolicyResponse, type TradePolicyRequest} from '@digital-card/framework/trade-policy-contracts';
import type {Schemas} from '@digital-card/framework/wire-types';

const identity = {
  requestId: '00000000-0000-4000-8000-000000000001', providerId: 'example.policy',
  grantId: '00000000-0000-4000-8000-000000000002', generation: 1,
  commandId: 'a'.repeat(64), inputDigest: 'b'.repeat(64), snapshotDigest: 'c'.repeat(64), deadline: 1,
};
const shop = {id: identity.requestId, ownerId: 'operator', kind: 'admin'} as const;
const price: Schemas['Money'] = {currencyId: 'credits', amount: 10};
const purchase: PurchasePolicyRequest = {
  ...identity, protocol: purchasePolicyProtocol, operation: 'canPurchase', scope: 'listing', phase: 'quote',
  context: {user: {id: 'collector'}, shop, listing: {id: identity.requestId, kind: 'copies', price}, quantity: 1, unitIds: [identity.requestId]},
};
const listing: ListingPolicyRequest = {
  ...identity, protocol: listingPolicyProtocol, operation: 'canList', scope: 'listing', phase: 'create',
  context: {actor: {id: 'operator'}, shop, price, stock: {kind: 'mint-card', variantId: 'card.standard', quantity: 1}},
};
const stock: ListingPolicyStock[] = [
  {kind: 'copies', ids: [identity.requestId]}, {kind: 'packs', ids: [identity.requestId]},
  {kind: 'mint-card', variantId: 'card.standard', quantity: 1},
  {kind: 'mint-pack', productId: 'pack.basic', quantity: 1}, {kind: 'action', handler: 'example.reward', quantity: 1},
];
for (const row of stock) {
  if (row.kind === 'mint-card') row.variantId.toUpperCase();
  if (row.kind === 'action') row.handler.toUpperCase();
}
const transfer: TransferPolicyRequest = {
  ...identity, protocol: transferPolicyProtocol, operation: 'canTransfer', scope: 'transfer', phase: 'list',
  context: {channel: 'sale', legs: [{fromUserId: 'seller', toUserId: null, copyIds: [identity.requestId], versions: [1]}]},
};
const trade: TradePolicyRequest = {
  ...identity, protocol: tradePolicyProtocol, operation: 'canTrade', scope: 'exchange', phase: 'review',
  context: {channel: 'trade', fromUserId: 'collector', toUserId: 'partner', give: {copyIds: [identity.requestId], currencies: []}, receive: {copyIds: [], currencies: [price]}},
};
validatePurchasePolicyRequest(purchase).context.quantity.toFixed();
validateListingPolicyRequest(listing).context.price.amount.toFixed();
validateTransferPolicyRequest(transfer).context.legs[0]?.toUserId?.toUpperCase();
validateTradePolicyRequest(trade).context.expiresInSeconds?.toFixed();
const input: unknown = JSON.parse('{}');
const responses = [validatePurchasePolicyResponse(input), validateListingPolicyResponse(input), validateTransferPolicyResponse(input), validateTradePolicyResponse(input)];
for (const response of responses) {
  switch (response.status) {
    case 'allowed': break;
    case 'denied': response.reasonCode.toUpperCase(); break;
    case 'error': response.errorCode.toUpperCase(); break;
    default: { const exhaustive: never = response; void exhaustive; }
  }
}
const approved: PurchasePolicyResponse = {...identity, protocol: purchasePolicyProtocol, operation: 'canPurchase', scope: 'listing', phase: 'purchase', status: 'allowed'};
const denied: PurchasePolicyResponse = {...approved, status: 'denied', reasonCode: 'restricted'};
const unavailable: PurchasePolicyResponse = {...approved, status: 'error', errorCode: 'unavailable'};
void [denied, unavailable, purchasePolicySchema, listingPolicySchema, transferPolicySchema, tradePolicySchema];
// @ts-expect-error Purchase policy phases do not include listing creation.
purchase.phase = 'create';
// @ts-expect-error Listing policy has a fixed creation phase.
listing.phase = 'quote';
// @ts-expect-error Transfer context uses explicit legs, not trade offers.
transfer.context.give = trade.context.give;
// @ts-expect-error Trade policy does not admit the transfer-only list phase.
trade.phase = 'list';
// @ts-expect-error A trade requires its recipient, unlike a listing transfer leg.
trade.context.toUserId = null;
// @ts-expect-error Minted pack stock requires a product identifier.
const invalidStock: ListingPolicyStock = {kind: 'mint-pack', variantId: 'card.standard', quantity: 1};
// @ts-expect-error Policy stock never includes action parameters.
const privateStock: ListingPolicyStock = {kind: 'action', handler: 'example.reward', quantity: 1, params: {private: true}};
// @ts-expect-error A denied response requires a declared reason code.
const invalidResponse: PurchasePolicyResponse = {...approved, status: 'denied'};
// @ts-expect-error Validator results have typed numeric amounts.
const invalidAmount: string = validatePurchasePolicyRequest(input).context.listing.price.amount;
// @ts-expect-error Responses contain the identity and decision, not request context.
validateTradePolicyResponse(input).context;
void [invalidStock, privateStock, invalidResponse, invalidAmount];

import {createRemotePurchasePolicy, purchasePolicyProtocol as remotePurchaseProtocol, validatePurchasePolicyResponse as remotePurchaseResponse} from '@digital-card/framework/remote-purchase-policy';
import {createRemoteListingPolicy, listingPolicyProtocol as remoteListingProtocol, validateListingPolicyRequest as remoteListingRequest} from '@digital-card/framework/remote-listing-policy';
import {createRemoteTransferPolicy, transferPolicyProtocol as remoteTransferProtocol, validateTransferPolicyRequest as remoteTransferRequest} from '@digital-card/framework/remote-transfer-policy';
import {createRemoteTradePolicy, tradePolicyProtocol as remoteTradeProtocol, validateTradePolicyResponse as remoteTradeResponse} from '@digital-card/framework/remote-trade-policy';

const transportOptions = {providerId: 'example.policy', url: 'https://policy.example.test/eligibility', token: 'configured-service-credential', timeoutMs: 5000, maxRequestBytes: 8192, maxResponseBytes: 4096, maxConcurrent: 2, allowLoopbackHttp: false};
const purchaseAdapter = createRemotePurchasePolicy({...transportOptions, scope: 'listing'});
const listingAdapter = createRemoteListingPolicy({...transportOptions, scope: 'listing'});
const transferAdapter = createRemoteTransferPolicy({...transportOptions, scope: 'transfer'});
const tradeAdapter = createRemoteTradePolicy({...transportOptions, scope: 'exchange'});
const signal = new AbortController().signal;
const purchaseResult = purchaseAdapter.evaluate({...purchase, ...purchaseAdapter.grant()}, {signal});
const listingResult = listingAdapter.evaluate({...listing, ...listingAdapter.grant()});
const transferResult = transferAdapter.evaluate({...transfer, ...transferAdapter.grant()}, {signal});
const tradeResult = tradeAdapter.evaluate({...trade, ...tradeAdapter.grant()});
void purchaseResult.then(result => {
  const status: 'allowed' | 'denied' = result.status;
  if (result.status === 'denied') result.reasonCode.toUpperCase();
  // @ts-expect-error Remote error frames reject, rather than resolving an error decision.
  result.errorCode;
  return status;
});
void listingResult.then(result => {const phase: 'create' = result.phase; return phase;});
void transferResult.then(result => {const scope: 'transfer' = result.scope; return scope;});
void tradeResult.then(result => {const scope: 'exchange' = result.scope; return scope;});
for (const adapter of [purchaseAdapter, listingAdapter, transferAdapter, tradeAdapter]) {
  const grant = adapter.grant();adapter.assertGrant(grant);
  adapter.providerId.toUpperCase();adapter.timeoutMs.toFixed();
  const state = adapter.setEnabled(false);state.generation.toFixed();
  const enabled: boolean = state.enabled;void enabled;
  const closed: void = adapter.close();void closed;
  // @ts-expect-error Grants are immutable snapshots.
  grant.generation = 2;
  // @ts-expect-error Adapters expose close, not a disposal method.
  adapter.dispose();
}
void [remotePurchaseProtocol, remoteListingProtocol, remoteTransferProtocol, remoteTradeProtocol, remotePurchaseResponse(input), remoteListingRequest(input), remoteTransferRequest(input), remoteTradeResponse(input)];
// @ts-expect-error A remote adapter requires an explicit matching scope.
createRemotePurchasePolicy(transportOptions);
// @ts-expect-error Listing policy never uses exchange scope.
createRemoteListingPolicy({...transportOptions, scope: 'exchange'});
// @ts-expect-error Transfer policy never uses listing scope.
createRemoteTransferPolicy({...transportOptions, scope: 'listing'});
// @ts-expect-error Trade policy requires exchange scope.
createRemoteTradePolicy({...transportOptions, scope: 'transfer'});
// @ts-expect-error Transport URL configuration must be a string.
createRemotePurchasePolicy({...transportOptions, scope: 'listing', url: new URL(transportOptions.url)});
// @ts-expect-error Transfer evaluation requires its own request protocol and context.
transferAdapter.evaluate(trade);
// @ts-expect-error Cancellation takes an AbortSignal, not a callback.
tradeAdapter.evaluate(trade, {signal: () => true});
// @ts-expect-error Grant validation requires generation and grantId.
purchaseAdapter.assertGrant({providerId: 'example.policy'});
