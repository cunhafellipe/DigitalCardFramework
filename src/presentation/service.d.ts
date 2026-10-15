import type {CompilerManifest, CompilerReport} from './compiler.js';
import type {PackageLimits} from './package.js';
import type {PerformancePolicy} from './performance.js';
import type {ImportIsolationOptions} from './import-executor.js';
import type {ProjectManifest} from './project.js';

export interface PresentationValidationOptions {
  limits?: Partial<PackageLimits>;
  timeoutMs?: number;
  maxHeapMb?: number;
  signal?: AbortSignal;
  performance?: Partial<PerformancePolicy>;
}
export interface PresentationValidation {
  digest: string;
  report: CompilerReport;
  capabilities: ProjectManifest['capabilities'];
}
/** Resolves only after the validation worker exits successfully. */
export function validateInWorker(file: string, options?: PresentationValidationOptions): Promise<PresentationValidation & {ok: true}>;
export type PresentationImportState = 'received' | 'validating' | 'compiling' | 'ready' | 'rejected' | 'cancelled' | 'published';
/** Public job snapshots exclude the private quarantine upload path. */
export interface PresentationImportJob {
  id: string;
  actor: string;
  key: string;
  uploadHash: string;
  createdAt: number;
  state: PresentationImportState;
  report?: CompilerReport;
  digest?: string;
  error?: string;
  publishedAt?: number;
}
export interface PresentationPublication {archive: Uint8Array; digest: string}
export interface PresentationStoreOptions<A extends {id: string}> {
  root: string;
  /** Host checks may inspect a public job, a digest, or a custom checkAccess resource. */
  authorize(actor: A, action: string, resource: unknown): unknown | PromiseLike<unknown>;
  limits?: Partial<PackageLimits>;
  scan?: (input: {path: string; digest: string; signal: AbortSignal}) => unknown | PromiseLike<unknown>;
  onPublished?: (actor: A, publication: PresentationPublication) => unknown | PromiseLike<unknown>;
  validatePublication?: (actor: A, publication: PresentationPublication) => unknown | PromiseLike<unknown>;
  scanTimeoutMs?: number;
  performance?: Partial<PerformancePolicy>;
  allowCapabilities?: string[] | null;
  maxPendingPerActor?: number;
  maxConcurrentImports?: number;
  maxPendingImports?: number;
  validationTimeoutMs?: number;
  validationHeapMb?: number;
  validate?: (file: string, options: PresentationValidationOptions) => PresentationValidation | PromiseLike<PresentationValidation>;
  importIsolation?: ImportIsolationOptions;
  maxStoredUploadBytes?: number;
  clock?: () => number;
}
export interface PresentationRetentionPlan {
  generatedAt: number;
  candidates: string[];
  action: 'review-only';
  note: string;
}
export interface PresentationStore<A extends {id: string} = {id: string}> {
  checkAccess(actor: A, action: string, resource?: unknown): Promise<void>;
  import(actor: A, bytes: Uint8Array, options: {idempotencyKey: string}): Promise<PresentationImportJob>;
  get(actor: A, id: string): Promise<PresentationImportJob>;
  cancel(actor: A, id: string): Promise<PresentationImportJob>;
  publish(actor: A, id: string): Promise<PresentationImportJob>;
  availability(actor: A, digest: string, policy: {state: 'available' | 'quarantined'; reason?: unknown}): Promise<void>;
  descriptor(digest: string): Promise<CompilerManifest>;
  file(digest: string, relative: string): Promise<{bytes: Uint8Array; mediaType: string}>;
  retentionPlan(options?: {references?: string[]; graceMs?: number}): Promise<PresentationRetentionPlan>;
  close(): Promise<void>;
}
/** Opens a single-process durable store; the host supplies authentication and authorization. */
export function createPresentationStore<A extends {id: string} = {id: string}>(options: PresentationStoreOptions<A>): Promise<PresentationStore<A>>;
export function presentationRoutes<A extends {id: string}>(store: Pick<PresentationStore<A>, 'checkAccess' | 'import' | 'get' | 'publish' | 'cancel' | 'file' | 'descriptor'>, options: {
  authenticate(request: Request): NoInfer<A> | null | undefined | false | PromiseLike<NoInfer<A> | null | undefined | false>;
  maxUploadBytes?: number;
  prefix?: string;
}): (request: Request) => Promise<Response | null>;
