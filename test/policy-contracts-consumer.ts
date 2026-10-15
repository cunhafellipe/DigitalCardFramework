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
