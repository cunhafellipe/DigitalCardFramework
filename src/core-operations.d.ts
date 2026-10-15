import type {Schemas, Operations} from './wire-types.js';
import type {PermissionActor} from './access.js';
import type {ExternalCreditInput} from './currency-gateway.js';
import type {fontDiagnostics} from './presentation/text.js';
import type {DurableCommand} from './client.js';
import type {RemotePurchasePolicy} from './remote-purchase-policy.js';
import type {RemoteListingPolicy} from './remote-listing-policy.js';
import type {RemoteTransferPolicy} from './remote-transfer-policy.js';
import type {RemoteTradePolicy} from './remote-trade-policy.js';
import type {RemoteAllocationStrategy} from './remote-allocation-strategy.js';
import type {RemoteStockAllocationStrategy} from './remote-stock-allocation-strategy.js';
import type {RemoteExternalAllocationStrategy} from './remote-external-allocation-strategy.js';

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
export interface CoreIndexedPageOptions {
  limit?: number; after?: string; search?: string; sort?: 'newest' | 'name' | 'ordinal' | 'id';
  cardId?: string; variantId?: string; lineId?: string; rarityId?: string;
}
export interface CorePackPage {items: Schemas['PackView'][]; total: number; next: string | null}
export interface CoreCollectionSummary {
  items: {variantId: string; count: number; card: Schemas['InventoryCopy'] | undefined}[];
  totalCards: number; uniqueCards: number; total: number; next: string | null;
}
export interface CoreCommandOptions {operators?: boolean; requireTradeReview?: boolean}
/** Input is retained before command-specific validation occurs during execution. */
export interface CoreCommandRegistration {command: DurableCommand; input: Record<string, unknown> & {key?: string}}
export type CoreCommandHead = Pick<Schemas['CommandIntent'], 'id' | 'userId' | 'command' | 'state'>;
export type CoreSettlementActor = CoreActor & {settlementProviderId: string};
export type CoreSettlementOperator = CoreSettlementActor & ({userId: string} | {id: string});
export type CorePolicyHook = 'canPurchase' | 'canList' | 'canTransfer' | 'canTrade';
export type CorePolicyEnablement<H extends CorePolicyHook> = ReturnType<(
  H extends 'canPurchase' ? RemotePurchasePolicy : H extends 'canList' ? RemoteListingPolicy :
  H extends 'canTransfer' ? RemoteTransferPolicy : RemoteTradePolicy)['setEnabled']>;
export type CoreActionView = Schemas['ActionJob'] & {
  userId: string | null; totalAttempts: number; history: Record<string, unknown>[];
  error: string | null; createdAt: string; completedAt: string | null; nextAt: string;
};
export interface CoreActionPage {items: CoreActionView[]; total: number; next: string | null}
export type CoreClaimedAction = CoreActionView & {
  status: 'running'; params: Record<string, unknown>; leaseToken: string; leaseUntil: string;
  completionId?: string; deliveryCompletionId?: string;
};
export interface CoreCodeLookupMaterial {codeId: string; providerId: string; externalId: string | null; code: string}
export interface CoreCodeRegistrationMaterial extends CoreCodeLookupMaterial {
  holderId: string | null; copyId: string | null; metadata: Record<string, unknown>;
}
export type CoreCodeHistoryEntry = Schemas['CodeSummary'] & {copyId: string; name: string; createdAt: string};
export interface CoreCodeHistoryPage {items: CoreCodeHistoryEntry[]; total: number; next: string | null}
export interface CoreOperations {
  setRemotePolicyEnabled<H extends CorePolicyHook>(actor: CoreActor, input: {hook: H; enabled: boolean}): CorePolicyEnablement<H>;
  fulfillments(actor: CoreUserActor, options?: CorePageOptions): CoreActionPage;
  actionJobs(actor: CoreActor, options?: CorePageOptions): CoreActionPage;
  retryAction(actor: CoreActor, input: Operations['retryAction']['request']): CoreActionView;
  claimAction(actor: CoreActor): CoreClaimedAction | null;
  settleAction(actor: CoreActor, input: {jobId: string; leaseToken: string; succeeded: boolean}): CoreActionView;
  dispatchActions(actor: CoreActor, options?: CoreAsyncOptions & {limit?: number}): Promise<(CoreActionView | {id: string; status: 'lease-lost'})[]>;
  configureCodePool(actor: CoreActor, input: Operations['configureCodePool']['request']): Schemas['CodePoolRecord'];
  importCodes(actor: CoreActor, input: Operations['importCodes']['request']): Operations['importCodes']['response'] & {poolId: string; importedAt: string};
  codePools(actor: CoreActor): Schemas['CodePoolView'][];
  codeInventory(actor: CoreActor, options?: CorePageOptions): Schemas['CodeInventoryPage'];
  /** Host custody material includes plaintext; it is separate from public code summaries. */
  codeRegistrationMaterial(actor: CoreActor, codeId: string): CoreCodeRegistrationMaterial;
  codeHistory(actor: CoreUserActor, options?: CorePageOptions): CoreCodeHistoryPage;
  revealCode(actor: CoreUserActor, input: Operations['revealCode']['request']): Operations['revealCode']['response'];
  reportCodeUsage(actor: CoreUserActor, input: Operations['reportCodeUsage']['request']): Schemas['CodeSummary'];
  confirmCodeStatus(actor: CoreActor & {codeProviderIds?: string[]}, input: Schemas['CodeConfirmation']): {codeId: string; status: 'redeemed' | 'revoked'};
  /** The account must hold the code even though this host method exposes plaintext. */
  codeLookupMaterial(actor: CoreUserActor, codeId: string): CoreCodeLookupMaterial;
  rotateCodeEncryption(actor: CoreActor): {count: number};
  verifyCodeVault(actor: CoreActor): {count: number};
  backfillProvenance(actor: CoreActor): {count: number};
  codeIssuanceStatus(actor: CoreActor, input: Schemas['CodeIssuanceCommand']): Schemas['CodeIssuanceStatus'];
  recoverCodeIssuance(actor: CoreActor, input: Schemas['CodeIssuanceCommand'], options?: CoreAsyncOptions): Promise<Schemas['CodeIssuanceStatus']>;
  audit(actor: CoreActor): Schemas['AuditResult'];
  workerPlan(actor: CoreActor): {actions: boolean; maintenance: boolean};
  backfillCompletionReservations(actor: CoreActor): {count: number};
  setRemoteExternalAllocationEnabled(actor: CoreActor, input: {enabled: boolean}): ReturnType<RemoteExternalAllocationStrategy['setEnabled']>;
  allocationStatus(actor: CoreUserActor, input: {productId: string}): Schemas['AllocationStatus'];
  acknowledgeAllocation(actor: CoreUserActor, input: Schemas['AllocationAcknowledgementInput']): Schemas['AllocationAcknowledgement'];
  setRemoteAllocationEnabled(actor: CoreActor, input: {enabled: boolean}): ReturnType<RemoteAllocationStrategy['setEnabled']>;
  setRemoteStockAllocationEnabled(actor: CoreActor, input: {enabled: boolean}): ReturnType<RemoteStockAllocationStrategy['setEnabled']>;
  quoteMintPackStock(actor: CoreUserActor, input: Schemas['MintPackStockQuoteInput']): Schemas['MintPackStockQuote'];
  stockAllocationStatus(actor: CoreUserActor, input: {shopId: string; productId: string}): Schemas['StockAllocationStatus'];
  bindingFactoryStatus(actor: CoreActor, input: Schemas['BindingFactoryCommand']): Schemas['BindingFactoryStatus'];
  recoverBindingFactories(actor: CoreActor, input: Schemas['BindingFactoryCommand'], options?: CoreAsyncOptions): Promise<Schemas['BindingFactoryStatus']>;
  directory(actor: CoreUserActor, options?: CorePageOptions): Schemas['DirectoryPage'];
  tradeInventory(actor: CoreUserActor, userId: string, options?: CorePageOptions): Schemas['TradeInventoryPage'];
  inventoryPage(actor: CoreUserActor, options?: CoreIndexedPageOptions): Schemas['InventoryPage'];
  collectionSummary(actor: CoreUserActor, options?: {limit?: number; after?: string; excludeTypes?: string[]}): CoreCollectionSummary;
  packsPage(actor: CoreUserActor, options?: CoreIndexedPageOptions): CorePackPage;
  packPage(actor: CoreUserActor, options?: CoreIndexedPageOptions): CorePackPage;
  convert(actor: CoreUserActor, input: Operations['convert']['request']): Operations['convert']['response'];
  tradeUp(actor: CoreUserActor, input: Operations['tradeUp']['request']): Schemas['Copy'];
  notifications(actor: CoreUserActor, options?: CorePageOptions): Schemas['NotificationPage'];
  readNotifications(actor: CoreUserActor, input: Operations['readNotifications']['request']): Schemas['NotificationReadReceipt'];
  commandIntent(actor: CoreUserActor, input: {id: string; command: DurableCommand}, options?: CoreCommandOptions): CoreCommandHead;
  commandIntents(actor: CoreUserActor, options?: {command?: DurableCommand; operators?: boolean}): {items: Schemas['CommandIntent'][]};
  registerCommandIntent(actor: CoreUserActor, input: CoreCommandRegistration, options?: CoreCommandOptions): Schemas['CommandIntent'];
  executeCommandIntent(actor: CoreUserActor, input: Schemas['CommandIntentId'], options?: CoreCommandOptions): Schemas['CommandExecution'];
  executeCommandIntentAsync(actor: CoreUserActor, input: Schemas['CommandIntentId'], options?: CoreCommandOptions & CoreAsyncOptions): Promise<Schemas['CommandExecution']>;
  acknowledgeCommandIntent(actor: CoreUserActor, input: Schemas['CommandIntentId'], options?: CoreCommandOptions): {id: string; state: 'acknowledged'};
  saveAlbum(actor: CoreUserActor, input: Operations['saveAlbum']['request']): Schemas['AlbumRecord'];
  albums(actor: CoreUserActor): Schemas['AlbumRecord'][];
  viewAlbum(actor: CoreActor | null | undefined, albumId: string): Schemas['AlbumView'];
  publicAlbums(): Schemas['PublicAlbumSummary'][];
  prepareExternalPurchase(actor: CoreSettlementActor, input: Schemas['PrepareExternalPurchase']): Schemas['ExternalPurchaseProjection'];
  commitExternalPurchase(actor: CoreSettlementActor, input: Schemas['CommitExternalPurchase']): Schemas['ExternalPurchaseProjection'];
  commitExternalPurchaseAsync(actor: CoreSettlementActor, input: Schemas['CommitExternalPurchase'], options?: CoreAsyncOptions): Promise<Schemas['ExternalPurchaseProjection']>;
  cancelExternalPurchase(actor: CoreSettlementActor, input: Schemas['CancelExternalPurchase']): Schemas['ExternalPurchaseProjection'];
  confirmExternalCompensation(actor: CoreSettlementActor, input: Schemas['ConfirmExternalCompensation']): Schemas['ExternalPurchaseProjection'];
  externalPurchaseStatus(actor: CoreUserActor | CoreSettlementActor, input: Schemas['ExternalPurchaseStatus']): Schemas['ExternalPurchaseProjection'];
  lookupExternalPurchase(actor: CoreUserActor | CoreSettlementActor, input: Schemas['LookupExternalPurchase']): Schemas['ExternalPurchaseProjection'];
  pendingExternalPurchases(actor: CoreSettlementActor, input: Schemas['PendingExternalPurchases']): Schemas['ExternalPurchasePage'];
  reconcileLegacyExternalPurchase(actor: CoreSettlementActor, input: Schemas['ReconcileLegacyExternalPurchase']): Schemas['ExternalPurchaseProjection'];
  resolveLegacyExternalPurchase(actor: CoreSettlementOperator, input: Schemas['ResolveLegacyExternalPurchase']): Schemas['ExternalPurchaseProjection'];
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
