import type {Schemas, Operations} from './wire-types.js';
import type {PermissionActor} from './access.js';
import type {ExternalCreditInput} from './currency-gateway.js';
import type {fontDiagnostics} from './presentation/text.js';

export type CoreActor = PermissionActor;
export type CoreUserActor = PermissionActor & {userId: string};
export type CorePreferences = Required<Pick<Schemas['Preferences'], 'inventoryVisibility' | 'favoriteCopyIds' | 'wishlistCardIds' | 'blockedUserIds'>>;
export interface CoreUser {
  id: string;
  provider: string;
  subject: string;
  displayName: string;
  createdAt: string;
  preferences?: CorePreferences;
}
export type CoreSiteStatus = Required<Schemas['AdminSiteChanges']>;
export type CoreUserRestrictions = Required<Schemas['AdminUserChanges']>;
export type CoreCatalog = Schemas['CatalogManifest'] & {
  features: Required<NonNullable<Schemas['CatalogManifest']['features']>>;
  capabilities: Schemas['CapabilityProfile'];
  cardTypes: NonNullable<Schemas['CatalogManifest']['cardTypes']>;
  recipes: NonNullable<Schemas['CatalogManifest']['recipes']>;
  combinations: NonNullable<Schemas['CatalogManifest']['combinations']>;
  displayFields: NonNullable<Schemas['CatalogManifest']['displayFields']>;
  metadataSchemas: NonNullable<Schemas['CatalogManifest']['metadataSchemas']>;
};
export type CorePublicCatalog = Schemas['PublicCatalog'] & {adminStatus: {revision: number; site: CoreSiteStatus}};
/** Authentication adapters add public role and permission fields to the HTTP response separately. */
export type CoreMe = Pick<Schemas['Me'], 'userId' | 'displayName'> & {
  preferences: CorePreferences;
  adminStatus: {site: CoreSiteStatus; restrictions: CoreUserRestrictions};
};
export interface CoreEvent {
  id: string;
  sequence: number;
  type: string;
  data: Record<string, unknown>;
  at: string;
  completionId?: string;
}
export interface CorePageOptions {limit?: number; after?: string; search?: string; sort?: 'newest' | 'name'}
export interface CoreAsyncOptions {signal?: AbortSignal}
export interface CorePresentationRegistration {
  digest: string;
  textIssues: (ReturnType<typeof fontDiagnostics>[number] | {code: 'TEXT_OVERFLOW' | 'TEXT_UNMEASURED'; nodeId: string; message: string})[];
}
export interface CoreTradeExpiration {
  ok: boolean;
  completed: string[];
  failed: {tradeId: string; code: string}[];
}
export interface CoreListingExpiration {count: number; failed?: {listingId: string; code: string}[]}
export interface CoreOperations {
  adminOverview(actor: CoreActor): Schemas['AdminOverview'];
  configureAdmin(actor: CoreActor, input: Operations['configureAdmin']['request']): Schemas['AdminMutation'];
  adminUsers(actor: CoreActor, options?: CorePageOptions): Schemas['AdminUsersPage'];
  adminUser(actor: CoreActor, input: CorePageOptions & {userId: string}): Schemas['AdminUserDetail'];
  adminHistory(actor: CoreActor, options?: CorePageOptions): Schemas['AdminHistoryPage'];
  administerCards(actor: CoreActor, input: Operations['administerCards']['request']): Schemas['AdminMutation'];
  cardPolicies(actor: CoreActor): Schemas['CardPolicyRegistry'];
  effectiveCardPolicy(actor: CoreActor, input: Operations['effectiveCardPolicy']['request']): Operations['effectiveCardPolicy']['response'];
  saveCardPolicy(actor: CoreActor, input: Operations['saveCardPolicy']['request']): Schemas['CardPolicySaveReceipt'];
  previewCardPolicy(actor: CoreActor, input: Operations['previewCardPolicy']['request']): Schemas['CardPolicyImpact'];
  activateCardPolicy(actor: CoreActor, input: Operations['activateCardPolicy']['request']): Schemas['CardPolicyActivationReceipt'];
  retireCardPolicy(actor: CoreActor, input: Operations['retireCardPolicy']['request']): Schemas['CardPolicyRetireReceipt'];
  restoreCardPolicy(actor: CoreActor, input: Operations['restoreCardPolicy']['request']): Schemas['CardPolicyRestoreReceipt'];
  saveCardResource(actor: CoreActor, input: Operations['saveCardResource']['request']): Schemas['CardResourceSaveReceipt'];
  retireCardResource(actor: CoreActor, input: Operations['retireCardResource']['request']): Schemas['CardResourceRetireReceipt'];
  restoreCardResource(actor: CoreActor, input: Operations['restoreCardResource']['request']): Schemas['CardResourceRestoreReceipt'];
  updateCopyStats(actor: CoreActor, input: Operations['updateCopyStats']['request']): {copyId: string; version: number};
  registerCardPresentation(actor: CoreActor, archive: Uint8Array): Promise<CorePresentationRegistration>;
  tradingPolicy(): Schemas['TradingPolicyRecord'];
  configureTrading(actor: CoreActor, input: Operations['configureTrading']['request']): Schemas['TradingPolicyRecord'];
  setCardTransferLock(actor: CoreActor, input: Operations['setCardTransferLock']['request']): Schemas['CardTransferLockReceipt'];
  proposeTrade(actor: CoreUserActor, input: Operations['proposeTrade']['request']): Schemas['Trade'];
  counterTrade(actor: CoreUserActor, input: Operations['counterTrade']['request']): Schemas['Trade'];
  acceptTrade(actor: CoreUserActor, input: Operations['acceptTrade']['request']): Schemas['Trade'];
  cancelTrade(actor: CoreUserActor, input: Operations['cancelTrade']['request']): Schemas['Trade'];
  proposeTradeAsync(actor: CoreUserActor, input: Operations['proposeTrade']['request'], options?: CoreAsyncOptions): Promise<Schemas['Trade']>;
  counterTradeAsync(actor: CoreUserActor, input: Operations['counterTrade']['request'], options?: CoreAsyncOptions): Promise<Schemas['Trade']>;
  acceptTradeAsync(actor: CoreUserActor, input: Operations['acceptTrade']['request'], options?: CoreAsyncOptions): Promise<Schemas['Trade']>;
  reviewTransferAsync(actor: CoreUserActor, input: Operations['reviewTransfer']['request'], options?: CoreAsyncOptions): Promise<Schemas['TradeTransferReview']>;
  sweepExpiredTrades(actor: CoreActor): CoreTradeExpiration;
  trades(actor: CoreUserActor): (Schemas['Trade'] & {fromName: string; toName: string})[];
  commerceSettings(): Schemas['CommerceSettingsView'];
  configureCommerce(actor: CoreActor, input: Operations['configureCommerce']['request']): Schemas['CommerceSettingsRecord'];
  createShop(actor: CoreUserActor, input: Operations['createShop']['request']): Schemas['ShopRecord'];
  setShopEnabled(actor: CoreActor, input: Operations['setShopEnabled']['request']): Schemas['ShopRecord'];
  shops(actor: CoreUserActor, options?: CorePageOptions): Schemas['ShopPage'];
  createListing(actor: CoreUserActor, input: Operations['createListing']['request']): Schemas['ListingRecord'];
  createListingAsync(actor: CoreUserActor, input: Operations['createListing']['request'], options?: CoreAsyncOptions): Promise<Schemas['ListingRecord']>;
  listings(actor: CoreUserActor, options?: CorePageOptions & {shopId?: string}): Schemas['ListingPage'];
  quoteListing(actor: CoreUserActor, input: Operations['quoteListing']['request']): Schemas['ListingQuote'];
  buyListing(actor: CoreUserActor, input: Operations['buyListing']['request']): Schemas['OrderRecord'];
  quoteListingAsync(actor: CoreUserActor, input: Operations['quoteListing']['request'], options?: CoreAsyncOptions): Promise<Schemas['ListingQuote']>;
  buyListingAsync(actor: CoreUserActor, input: Operations['buyListing']['request'], options?: CoreAsyncOptions): Promise<Schemas['OrderRecord']>;
  orders(actor: CoreUserActor, options?: CorePageOptions): Schemas['OrderPage'];
  cancelListing(actor: CoreUserActor, input: Operations['cancelListing']['request']): Schemas['ListingRecord'];
  expireListings(actor: CoreActor): CoreListingExpiration;
  enterRaffle(actor: CoreUserActor, input: Operations['enterRaffle']['request']): Schemas['RaffleStatus'];
  raffleStatus(actor: CoreUserActor, input: Operations['raffleStatus']['request']): Schemas['RaffleStatus'];
  drawRaffle(actor: CoreActor, input: Operations['drawRaffle']['request']): Schemas['RaffleDraw'];
  drawDueRaffles(actor: CoreActor, options?: {limit?: number}): Schemas['RaffleDraw'][];
  close(): void;
  catalog(): CorePublicCatalog;
  catalogVersion(): number;
  publishCatalog(actor: CoreActor, manifest: unknown): CorePublicCatalog;
  operatorCatalog(actor: CoreActor): CoreCatalog;
  previewImport(actor: CoreActor, input: Operations['previewImport']['request']): Operations['previewImport']['response'];
  commitImport(actor: CoreActor, input: Operations['commitImport']['request']): Operations['commitImport']['response'];
  userByIdentity(actor: CoreActor, input: {provider: string; subject: string}): CoreUser | null;
  providerIdentity(actor: CoreActor, userId: string): {provider: string; subject: string} | null;
  registerUser(actor: CoreActor, input: {provider: string; subject: string; displayName: string}): CoreUser;
  grantCurrency(actor: CoreActor, input: {userId: string; currencyId: string; amount: number; reason: string; key: string}): {
    userId: string; currencyId: string; amount: number; balance: number;
  };
  settleExternalCredit(actor: CoreActor, input: ExternalCreditInput): Schemas['ExternalCreditReceipt'];
  me(actor: CoreUserActor): CoreMe;
  setPreferences(actor: CoreUserActor, input: Operations['setPreferences']['request']): CorePreferences;
  capabilities(actor: CoreUserActor): Schemas['CapabilityAvailability'];
  wallet(actor: CoreUserActor): Record<string, number>;
  history(actor: CoreUserActor): Schemas['LedgerEntry'][];
  quote(actor: CoreUserActor, input: Operations['quote']['request']): Operations['quote']['response'];
  availability(): Operations['availability']['response'];
  pityProgress(actor: CoreUserActor): Record<string, number>;
  purchase(actor: CoreUserActor, input: Operations['purchase']['request']): Operations['purchase']['response'];
  purchaseAsync(actor: CoreUserActor, input: Operations['purchase']['request'], options?: {signal?: AbortSignal}): Promise<Operations['purchase']['response']>;
  packs(actor: CoreUserActor): Schemas['PackView'][];
  inventory(actor: CoreUserActor): Schemas['InventoryCopy'][];
  inspectCard(actor: CoreUserActor, copyId: string): Schemas['Copy'];
  openPack(actor: CoreUserActor, input: Operations['openPack']['request']): Schemas['Receipt'];
  openCard(actor: CoreUserActor, input: Operations['openCard']['request']): Schemas['Copy'];
  consumeBinding(actor: CoreUserActor, input: Operations['consumeBinding']['request']): Schemas['BindingUseReceipt'];
  bindings(actor: CoreUserActor): Schemas['HeldBinding'][];
  events(actor: CoreActor, options?: {after?: number; limit?: number}): CoreEvent[];
}
