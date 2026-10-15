import type {ActionJson} from './action-contracts.js';
import type {
  StorageState, StorageRecordValue, StorageCollectionCounts, StoredCode,
  StorageSnapshotMethods, SynchronousStorageResult,
} from './storage-types.js';

export interface RecordTransactionOptions {
  maxRecords?: number; maxBytes?: number;
  bindingFactories?: boolean; codeIssuance?: boolean; allocationJournal?: boolean;
  allocationPurchase?: boolean; allocationListing?: boolean; intent?: boolean; preferences?: boolean;
  packCompletion?: boolean; tradeProposal?: boolean; tradeCompletion?: boolean;
  tradeAcceptance?: boolean; tradeCounter?: boolean; actionDelivery?: boolean; actionRetry?: boolean;
  listingCompletion?: boolean; listingCancellation?: boolean; listingPurchase?: boolean; listingCreation?: boolean;
  raffle?: boolean; raffleDraw?: boolean;
}
type ObjectField<F extends string> = unknown extends StorageState[F] ? F :
  NonNullable<StorageState[F]> extends readonly unknown[] ? never : NonNullable<StorageState[F]> extends object ? F : never;
type ArrayField<F extends string> = unknown extends StorageState[F] ? F :
  NonNullable<StorageState[F]> extends readonly unknown[] ? F : never;
type ScalarValue<T> = unknown extends T ? unknown : T extends object ? never : T;
type DefinedValue<T> = T extends undefined ? never : T;
export type BindingFactoryResultAdmission = {invocationId: string; jobId: string; leaseToken: string} & (
  {state: 'active'; data: Record<string, ActionJson>; dependencyOf?: never} |
  {state: 'activation_failed'; data?: never; dependencyOf?: string}
);
/** Detached staged records; every method is invalid after the synchronous callback ends. */
export interface StorageRecordTransaction {
  get<F extends string, K extends string>(name: F, key: K): StorageRecordValue<StorageState[F], K> | undefined;
  value<F extends string>(name: F): StorageState[F];
  count<F extends string>(name: F & (ObjectField<F> | ArrayField<F>)): number;
  ownerCounts(ownerId: string): StorageCollectionCounts;
  availableCodeStock(poolId: string, limit: number, at: string): StoredCode[];
  importedCodePrefix(poolId: string, limit: number, at: string): {row: StoredCode; ordinal: number}[];
  ownedCardPresence(ownerId: string, cardIds: string[]): {cardId: string; owned: boolean}[];
  ownedVariantCount(ownerId: string, variantIds: string[]): number;
  put<F extends string, V extends StorageRecordValue<StorageState[F]>>(name: F & ObjectField<F>, key: string, value: V & DefinedValue<V>): V;
  append<F extends string, V extends StorageRecordValue<StorageState[F]>>(name: F & ArrayField<F>, value: V & DefinedValue<V>): number;
  trimNotifications(ownerId: string, limit?: 2000): void;
  setScalar<F extends string, V extends ScalarValue<StorageState[F]>>(name: F, value: V & DefinedValue<V>): void;
  reserveIntentCompletion(id: string, options?: {admission?: boolean}): void;
  reserveTradeCompletion(id: string): void;
  reserveListingCompletion(id: string): void;
  admitBindingFactoryResult(value: BindingFactoryResultAdmission): Readonly<{invocationId: string}>;
  reserveActionCompletion(id: string): void;
  reservePackCompletion(id: string): void;
}
export interface FrameworkStorage extends StorageSnapshotMethods {
  /** Stages bounded changes; the selected domain scope and invariants are checked before commit. */
  transactRecords<T>(callback: (records: StorageRecordTransaction) => T & SynchronousStorageResult<T>, options?: RecordTransactionOptions): T;
}
