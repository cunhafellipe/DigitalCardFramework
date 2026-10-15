import type {Buffer} from 'node:buffer';
import type {FrameworkStorage} from './storage-record-types.js';
import type {StorageMeasurement, StorageState, SynchronousStorageResult} from './storage-types.js';

export interface SQLiteMigration {
  from: number;
  to: number;
  stage: 'before-schema' | 'after-records' | 'before-commit';
}
export interface SQLiteStoreOptions<MigrationResult = unknown> {
  encryptionKey?: Buffer;
  maxStateBytes?: number;
  maxCompletionBytes?: number;
  readOnly?: boolean;
  /** Migration callbacks run synchronously and their results must support structured cloning. */
  onMigration?(migration: SQLiteMigration): MigrationResult & SynchronousStorageResult<MigrationResult>;
}
export interface SQLiteStorageMeasurement extends StorageMeasurement {
  completionLimitBytes: number;
}
export interface SQLiteStorageDiagnostics {
  storageSchema: number;
  decodedQueryRecords: number;
  compatibilityMaterializations: number;
  recordWrites: number;
  readOnly: boolean;
}
export interface SQLiteStore<MigrationResult = unknown> extends FrameworkStorage {}
export class SQLiteStore<MigrationResult = unknown> {
  /** Read-only instances reject writes and migrations that require a writable database. */
  constructor(path?: string, options?: SQLiteStoreOptions<MigrationResult>);
  measure(state: StorageState): SQLiteStorageMeasurement;
  assertCapacity(state: StorageState, options?: {previous?: StorageState}): SQLiteStorageMeasurement;
  selectDueActions(at: string, limit?: number): string[];
  diagnostics(): SQLiteStorageDiagnostics;
  integrity(): boolean;
  backup<P extends string>(path: P): Promise<{path: P; revision: number}>;
}
