import type {Schemas} from './wire-types.js';
import type {ActionJson} from './action-contracts.js';
import type {CodeEnvelope} from './code-vault.js';
import type {FrameworkCopy, FrameworkUser, FrameworkEventSubscription} from './core.js';
import type {CoreCatalog, CoreEvent, CoreActionView} from './core-operations.js';
import type {DurableCommand} from './client.js';

type WithoutStorageFields<T, K> = {[P in keyof T as P extends K ? never : P]: T[P]};
export type StoredPack = WithoutStorageFields<Schemas['PackView'], 'cardCount'> & {
  copyIds: string[]; receipt: Schemas['Receipt'] | null; lockedBy?: string;
};
export interface StoredRequest {hash: string; result: unknown; completionId?: string; allocationAttemptId?: string}
export interface StoredCode {
  id: string; poolId: string; providerId: string; fingerprint: string;
  batchId: string | null; importedAt: string; externalId: string | null; expiresAt: string | null;
  metadata: Record<string, ActionJson>; secret: CodeEnvelope;
  status: 'available' | 'allocated' | 'redeemed' | 'revoked';
  copyId: string | null; holderId: string | null; holderHistory: string[]; allocatedAt: string | null;
  revealedAt: string | null; revealedBy: string | null; reportedUsed: boolean;
  redeemedAt: string | null; revokedAt: string | null; history: Record<string, unknown>[];
  attachmentId?: string; title?: string; redeemUrl?: string | null; instructions?: string;
  reveal?: Schemas['CodeSummary']['reveal']; transfer?: Schemas['CodeSummary']['transfer'];
}
export type StoredAction = CoreActionView & {
  params: Record<string, ActionJson>; leaseToken: string | null; leaseUntil: string | null;
  completionId?: string; deliveryCompletionId?: string; retryCount?: number;
};
export interface StoredCompletion {
  id: string; kind: string; entityId: string; status: 'reserved' | 'completed';
  events: number; jobs: number; bytes: number; usedBytes: number; subscriptions: FrameworkEventSubscription[];
  [field: string]: unknown;
}
export type StoredExternalPurchase = Schemas['ExternalPurchaseProjection'] & {
  completionBytes: number; proofHashes: Partial<Record<'debit' | 'no_debit' | 'refund', string>>;
  proofReferences?: Partial<Record<'debit' | 'no_debit' | 'refund', string>>;
  snapshot?: unknown;
  legacy?: {purchaseKey: string; resolutionPurchaseKey?: string};
  [field: string]: unknown;
};
export type StoredListingUnit = {id: string; primary: boolean; status: 'available' | 'sold' | 'released'; orderId?: string} & (
  {kind: 'copy'; copyId: string} | {kind: 'pack'; packId: string} |
  {kind: 'action'; handler: string; params: Record<string, ActionJson>}
);
export type StoredListing = Pick<Schemas['ListingRecord'],
  'id' | 'shopId' | 'sellerId' | 'title' | 'description' | 'price' | 'kind' | 'previewAt' |
  'startsAt' | 'endsAt' | 'perBuyerLimit' | 'metadata' | 'raffle' | 'createdAt' | 'preview' | 'status'> & {
    entries: Record<string, {userId: string; at: string}>;
    draw: Schemas['RaffleDraw'] | null; units: StoredListingUnit[]; closedAt?: string;
  };
export type StoredOrder = Pick<Schemas['OrderRecord'],
  'id' | 'listingId' | 'shopId' | 'buyerId' | 'sellerId' | 'quantity' | 'unitIds' | 'paid' | 'createdAt' | 'items' | 'actionJobIds'>;
/** Detached logical snapshot. Extension fields retain their host-defined, unvalidated shapes. */
export interface StorageState {
  schemaVersion: 1;
  revision: number;
  catalog: CoreCatalog | null;
  users: Record<string, FrameworkUser>;
  balances: Record<string, Record<string, number>>;
  packs: Record<string, StoredPack>;
  copies: Record<string, FrameworkCopy>;
  albums: Record<string, Schemas['AlbumRecord']>;
  trades: Record<string, Schemas['Trade']>;
  supply: Record<string, number>;
  requests: Record<string, StoredRequest>;
  ledger: Schemas['LedgerEntry'][];
  events: CoreEvent[];
  notifications?: (Schemas['Notification'] & {userId: string})[];
  codePools?: Record<string, Schemas['CodePoolRecord']>;
  codes?: Record<string, StoredCode>;
  actionJobs?: Record<string, StoredAction>;
  completionObligations?: Record<string, StoredCompletion>;
  commandIntents?: Record<string, Schemas['CommandIntent']>;
  externalPurchases?: Record<string, StoredExternalPurchase>;
  shops?: Record<string, Schemas['ShopRecord']>;
  listings?: Record<string, StoredListing>;
  orders?: Record<string, StoredOrder>;
  operatorRequests?: Record<string, StoredRequest>;
  codeRequests?: Record<string, StoredRequest>;
  actionRetryRequests?: Record<string, {jobId: string; result: CoreActionView}>;
  commandIntentHeads?: Record<string, Partial<Record<DurableCommand, string>>>;
  commandIntentCount?: number;
  _copyReferences?: Record<string, {users: string[]; albums: string[]}>;
  _tradeEscrow?: Record<string, Record<string, number>>;
  _codeImportOrder?: Record<string, number>;
  _codeImportOrderReady?: boolean;
  _codePoolRevisions?: Record<string, number>;
  _codePoolRevisionsReady?: boolean;
  [field: string]: unknown;
}
export type StorageRecordValue<T, K extends string = string> = unknown extends T ? unknown : T extends readonly (infer Row)[] ? Row :
  T extends object ? K extends keyof T ? T[K] : unknown : never;
export interface StoragePage<T> {items: T[]; total: number; next: string | null}
export interface StoragePageOptions {
  limit?: number; after?: string; search?: string; sort?: 'id' | 'name' | 'newest' | 'ordinal';
  ownerId?: string; holderId?: string; state?: string; status?: string;
  cardId?: string; variantId?: string; lineId?: string; rarityId?: string; poolId?: string; providerId?: string;
  states?: string[];
}
export interface StorageCollectionCounts {
  copies: number; ownedCopies: number; sealedCopies: number; packs: number; unopenedPacks: number; codes: number;
}
export interface StorageVariantCounts {
  items: {variantId: string; count: number; copyId: string}[];
  totalCards: number; uniqueCards: number; total: number; next: string | null;
}
export interface StorageQueries {
  get<F extends keyof StorageState, K extends string>(field: F, id: K): StorageRecordValue<StorageState[F], K> | undefined;
  value<F extends keyof StorageState>(field: F): StorageState[F];
  records<F extends keyof StorageState>(field: F, options: {ids: string[]}): Record<string, StorageRecordValue<StorageState[F]>>;
  userByIdentity(provider: string, subject: string): FrameworkUser | undefined;
  providerIdentity(userId: string): {provider: string; subject: string} | undefined;
  collectionCounts(ownerId: string): StorageCollectionCounts;
  variantCounts(options?: {ownerId?: string; after?: string; limit?: number; excludeTypes?: string[]}): StorageVariantCounts;
  ownedCardPresence(ownerId: string, cardIds: string[]): {cardId: string; owned: boolean}[];
  importedCodePrefix(poolId: string, limit: number, at: string): {row: StoredCode; ordinal: number}[];
  availableCodeStock(poolId: string, limit: number, at: string): StoredCode[];
  notifications(ownerId: string): (Schemas['Notification'] & {userId: string})[];
  codeHistoryEntries(holderId: string): {code: StoredCode; copy: FrameworkCopy}[];
  pageCopies(options?: StoragePageOptions): StoragePage<FrameworkCopy>;
  pagePacks(options?: StoragePageOptions): StoragePage<StoredPack>;
  pageCodes(options?: StoragePageOptions): StoragePage<StoredCode>;
  pageExternalPurchases(options?: StoragePageOptions): StoragePage<StoredExternalPurchase>;
}
export interface StorageMeasurement {
  usedBytes: number; reservedBytes: number; totalBytes: number; limitBytes: number;
  completionStoredBytes: number; completionReservedBytes: number; completionLimitBytes?: number;
}
/** Store callbacks are synchronous; inputs and outputs must also support structured cloning. */
export type SynchronousStorageResult<T> = T extends PromiseLike<unknown> ? never : T;
export interface StorageSnapshotMethods {
  read<T>(callback: (state: StorageState) => T & SynchronousStorageResult<T>): T;
  transact<T>(callback: (state: StorageState) => T & SynchronousStorageResult<T>): T;
  query<T>(callback: (queries: StorageQueries) => T & SynchronousStorageResult<T>): T;
  measure(state: StorageState): StorageMeasurement;
  assertCapacity(state: StorageState): StorageMeasurement;
  selectDueRaffles(at: string, limit?: number): string[];
  selectDueExpirations(collection: 'trades' | 'listings', at: string, limit?: number): string[];
  prepareRecordTransactions(options?: {force?: boolean}): {prepared: boolean};
  close(): void;
}
