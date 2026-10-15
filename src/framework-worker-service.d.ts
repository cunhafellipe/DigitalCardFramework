import type {CoreOperations, CoreActor, CorePolicyHook, CorePolicyEnablement} from './core-operations.js';
import type {FrameworkOptions} from './core.js';
import type {SQLiteStore, SQLiteStoreOptions, SQLiteStorageDiagnostics} from './sqlite.js';
import type {AuthSessionStorage, SessionStoreOptions} from './auth.js';
import type {CodeVaultOptions} from './code-vault.js';
import type {RemoteCodeIssuerOptions} from './remote-code-issuer.js';
import type {RemoteBindingFactoryOptions} from './remote-binding-factory.js';

/** Plain transport data; cycles, non-finite numbers and shared buffers are rejected at runtime. */
export type FrameworkWorkerData = null | undefined | boolean | number | string | Uint8Array |
  readonly FrameworkWorkerData[] | {readonly [key: string]: FrameworkWorkerData};
type TransportOptions<T> = unknown extends T ? FrameworkWorkerData :
  T extends (...args: never[]) => unknown ? never :
  T extends null | undefined | boolean | number | string | Uint8Array ? T :
  T extends readonly (infer Item)[] ? readonly TransportOptions<Item>[] :
  T extends object ? {[K in keyof T]: TransportOptions<T[K]>} : never;

type FrameworkWorkerCallbackOption = 'clock' | 'random' | 'raffleRandom' | 'bindings' | 'policies' |
  'codeVault' | 'codeGenerators' | 'actionHandlers' | 'externalPurchaseProviders';
/** Configure callbacks through extensionModule; direct configuration crosses a data-only boundary. */
export type FrameworkWorkerFrameworkOptions = TransportOptions<Pick<FrameworkOptions,
  'limits' | 'codeLimits' | 'actionOptions' | 'eventSubscriptions' | 'externalPurchaseLimits' |
  'remotePolicies' | 'remoteAllocation' | 'remoteStockAllocation' | 'remoteExternalAllocation'>> & {
    [K in FrameworkWorkerCallbackOption]?: never;
  } & {
    allocationCodeIssuers?: Readonly<Record<string, TransportOptions<RemoteCodeIssuerOptions>>>;
    allocationBindingFactories?: Readonly<Record<string, TransportOptions<RemoteBindingFactoryOptions>>>;
  };
export type FrameworkWorkerStoreOptions = Pick<SQLiteStoreOptions,
  'encryptionKey' | 'maxStateBytes' | 'maxCompletionBytes' | 'readOnly'> & {onMigration?: never};
export type FrameworkWorkerSessionOptions = Pick<SessionStoreOptions, 'encryptionKey' | 'maxSessions'> & {clock?: never};
interface FrameworkWorkerBaseOptions {
  filename?: string;
  frameworkOptions?: FrameworkWorkerFrameworkOptions;
  /** Local filename or file: URL string exporting framework callbacks or createFrameworkOptions. */
  extensionModule?: string;
  extensionOptions?: FrameworkWorkerData;
  codeVaultOptions?: CodeVaultOptions;
  maxPendingRequests?: number;
  maxPendingBytes?: number;
  startupTimeoutMs?: number;
  closeTimeoutMs?: number;
}
export type FrameworkWorkerServiceOptions = FrameworkWorkerBaseOptions & (
  | {storeOptions?: FrameworkWorkerStoreOptions; sessionOptions?: undefined}
  | {storeOptions?: FrameworkWorkerStoreOptions & {readOnly?: false}; sessionOptions: FrameworkWorkerSessionOptions}
);

/** Explicit dispatch allowlist, reviewed against framework-worker-contract.js. */
export type FrameworkWorkerMethodName =
  'adminOverview' | 'configureAdmin' | 'adminUsers' | 'adminUser' | 'adminHistory' |
  'administerCards' | 'cardPolicies' | 'effectiveCardPolicy' | 'saveCardPolicy' | 'previewCardPolicy' |
  'activateCardPolicy' | 'retireCardPolicy' | 'restoreCardPolicy' | 'saveCardResource' | 'retireCardResource' |
  'restoreCardResource' | 'updateCopyStats' | 'registerCardPresentation' | 'commerceSettings' | 'configureCommerce' |
  'createShop' | 'setShopEnabled' | 'shops' | 'createListing' | 'createListingAsync' |
  'proposeTradeAsync' | 'counterTradeAsync' | 'acceptTradeAsync' | 'reviewTransferAsync' | 'listings' |
  'quoteListing' | 'buyListing' | 'quoteListingAsync' | 'buyListingAsync' | 'setRemotePolicyEnabled' |
  'orders' | 'cancelListing' | 'expireListings' | 'enterRaffle' | 'raffleStatus' |
  'drawRaffle' | 'drawDueRaffles' | 'openCard' | 'fulfillments' | 'actionJobs' |
  'retryAction' | 'claimAction' | 'settleAction' | 'dispatchActions' | 'tradingPolicy' |
  'configureTrading' | 'setCardTransferLock' | 'configureCodePool' | 'importCodes' | 'codePools' |
  'codeInventory' | 'codeRegistrationMaterial' | 'codeHistory' | 'revealCode' | 'reportCodeUsage' |
  'confirmCodeStatus' | 'codeLookupMaterial' | 'rotateCodeEncryption' | 'verifyCodeVault' | 'backfillProvenance' |
  'audit' | 'capabilities' | 'workerPlan' | 'backfillCompletionReservations' | 'commandIntent' |
  'commandIntents' | 'registerCommandIntent' | 'executeCommandIntent' | 'executeCommandIntentAsync' | 'acknowledgeCommandIntent' |
  'me' | 'setPreferences' | 'directory' | 'tradeInventory' | 'inventoryPage' |
  'collectionSummary' | 'notifications' | 'readNotifications' | 'publishCatalog' | 'operatorCatalog' |
  'previewImport' | 'commitImport' | 'catalog' | 'catalogVersion' | 'userByIdentity' |
  'providerIdentity' | 'registerUser' | 'grantCurrency' | 'settleExternalCredit' | 'prepareExternalPurchase' |
  'commitExternalPurchase' | 'commitExternalPurchaseAsync' | 'setRemoteExternalAllocationEnabled' | 'cancelExternalPurchase' | 'confirmExternalCompensation' |
  'externalPurchaseStatus' | 'lookupExternalPurchase' | 'pendingExternalPurchases' | 'reconcileLegacyExternalPurchase' | 'resolveLegacyExternalPurchase' |
  'wallet' | 'history' | 'quote' | 'availability' | 'bindingFactoryStatus' |
  'recoverBindingFactories' | 'codeIssuanceStatus' | 'recoverCodeIssuance' | 'pityProgress' | 'purchase' |
  'purchaseAsync' | 'allocationStatus' | 'quoteMintPackStock' | 'stockAllocationStatus' | 'setRemoteStockAllocationEnabled' |
  'acknowledgeAllocation' | 'setRemoteAllocationEnabled' | 'packs' | 'packsPage' | 'packPage' |
  'openPack' | 'inventory' | 'inspectCard' | 'consumeBinding' | 'convert' |
  'tradeUp' | 'proposeTrade' | 'counterTrade' | 'sweepExpiredTrades' | 'trades' |
  'acceptTrade' | 'cancelTrade' | 'saveAlbum' | 'albums' | 'viewAlbum' |
  'publicAlbums' | 'bindings' | 'events';

type AsyncOperation<T> = T extends (...args: infer Args) => infer Result ?
  (...args: Args) => Promise<Awaited<Result>> : never;
type FrameworkWorkerMappedOperations = {
  [K in FrameworkWorkerMethodName]: AsyncOperation<CoreOperations[K]>;
};
export type FrameworkWorkerCoreOperations = Omit<FrameworkWorkerMappedOperations, 'setRemotePolicyEnabled'> & {
  setRemotePolicyEnabled<H extends CorePolicyHook>(actor: CoreActor, input: {hook: H; enabled: boolean}): Promise<CorePolicyEnablement<H>>;
};
export interface FrameworkWorkerRuntimeCapabilities {bindingFactories: string[]; actionHandlers: boolean; codeVault: boolean}
export interface FrameworkWorkerStoreOperations {
  storeIntegrity(): Promise<ReturnType<SQLiteStore['integrity']>>;
  storeDiagnostics(): Promise<SQLiteStorageDiagnostics>;
  prepareRecordTransactions(...args: Parameters<SQLiteStore['prepareRecordTransactions']>): Promise<ReturnType<SQLiteStore['prepareRecordTransactions']>>;
  runtimeCapabilities(): Promise<FrameworkWorkerRuntimeCapabilities>;
}
export type FrameworkWorkerSessions = Readonly<{
  [K in keyof AuthSessionStorage]: AsyncOperation<AuthSessionStorage[K]>;
}>;
export interface FrameworkWorkerSessionOperations {
  sessionCreate(...args: Parameters<AuthSessionStorage['create']>): Promise<Awaited<ReturnType<AuthSessionStorage['create']>>>;
  sessionGet(secret: Parameters<AuthSessionStorage['get']>[0], kind: Parameters<AuthSessionStorage['get']>[1]): Promise<Awaited<ReturnType<AuthSessionStorage['get']>>>;
  sessionConsume(secret: Parameters<AuthSessionStorage['get']>[0], kind: Parameters<AuthSessionStorage['get']>[1]): Promise<Awaited<ReturnType<AuthSessionStorage['get']>>>;
  sessionRevoke(...args: Parameters<AuthSessionStorage['revoke']>): Promise<Awaited<ReturnType<AuthSessionStorage['revoke']>>>;
}
export type FrameworkWorkerOperations = FrameworkWorkerCoreOperations & FrameworkWorkerStoreOperations & FrameworkWorkerSessionOperations;
export interface FrameworkWorkerStatus {
  state: 'starting' | 'ready' | 'closing' | 'closed' | 'failed';
  ready: boolean;
  pendingRequests: number;
  pendingBytes: number;
  maxPendingRequests: number;
  maxPendingBytes: number;
  saturated: boolean;
}
export interface FrameworkWorkerService extends FrameworkWorkerOperations {}
export class FrameworkWorkerService {
  constructor(options?: FrameworkWorkerServiceOptions);
  /** Resolves to this service after worker startup; failed startup rejects. */
  readonly ready: Promise<this>;
  /** Installed only when sessionOptions was provided. */
  readonly sessions?: FrameworkWorkerSessions;
  status(): FrameworkWorkerStatus;
  invoke<H extends CorePolicyHook>(method: 'setRemotePolicyEnabled', actor: CoreActor, input: {hook: H; enabled: boolean}): Promise<CorePolicyEnablement<H>>;
  invoke<K extends keyof FrameworkWorkerOperations>(method: K, ...args: Parameters<FrameworkWorkerOperations[K]>): ReturnType<FrameworkWorkerOperations[K]>;
  /** Drains admitted requests before closing the owned framework and sessions. */
  close(): Promise<void>;
  /** Forces worker termination; outstanding mutation outcomes may remain uncertain. */
  terminate(): Promise<void>;
}
