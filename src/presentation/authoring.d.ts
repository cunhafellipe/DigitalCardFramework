import type {BuiltPackage, ValidatedPackage} from './package.js';
import type {Project, ProjectManifest, ProjectNode, ProjectPackage} from './project.js';
import type {PerformancePolicy, PerformanceReport} from './performance.js';
import type {PresentationReference} from './integration.js';

export interface AuthoringImage {
  bytes: Uint8Array;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}
export interface ImagePackageOptions extends AuthoringImage {
  id?: string;
  title?: string;
  back?: AuthoringImage;
}
export function imagePackage(options: ImagePackageOptions): Promise<BuiltPackage>;
/** Custom source fields are interpreted and validated by the selected importer. */
export interface AuthoringSource {
  format?: string;
  bytes?: Uint8Array;
  [field: string]: unknown;
}
export interface AuthoringEffect {
  id: string;
  node: string;
  side?: 'front' | 'back';
  parameters?: Record<string, unknown>;
}
export interface AuthoringRequest {
  id?: string;
  title?: string;
  source: AuthoringSource;
  effects?: AuthoringEffect[];
  [field: string]: unknown;
}
export type AuthoringBatchRequest = AuthoringRequest & {id: string};
export interface AuthoringOperationOptions {signal?: AbortSignal}
export interface AuthoringContext extends AuthoringOperationOptions {request: AuthoringRequest}
export type AuthoringPackage = ProjectPackage & {performance: PerformanceReport};
export type AuthoringEvent =
  | {type: 'build.started'; operationId: string}
  | {type: 'build.completed'; operationId: string; digest: string; performance: PerformanceReport}
  | {type: 'build.failed'; operationId: string; code: string; message: string}
  | {type: 'presentation.published'; key: string; id: string; digest: string}
  | {type: 'catalog.committed'; key: string; digests: string[]};
export interface AuthoringCatalog {
  cards: {id: string; presentation?: PresentationReference; [field: string]: unknown}[];
  [field: string]: unknown;
}
export interface AuthoringOptions<C extends AuthoringCatalog = AuthoringCatalog, R = unknown> {
  performance?: Partial<PerformancePolicy>;
  importers?: Record<string, (source: AuthoringSource & {id?: string; title?: string}, context: AuthoringContext) => ValidatedPackage | PromiseLike<ValidatedPackage>>;
  /** Recipes run during the synchronous project edit. */
  effects?: Record<string, (node: ProjectNode, parameters: Record<string, unknown>, context: {manifest: ProjectManifest; side: 'front' | 'back'}) => ProjectNode | ProjectNode[]>;
  transform?: (project: Project, context: AuthoringContext) => unknown | PromiseLike<unknown>;
  publish?: (pkg: AuthoringPackage, options: AuthoringOperationOptions & {key: string}) => PresentationReference | PromiseLike<PresentationReference>;
  commitCatalog?: (catalog: C, options: AuthoringOperationOptions & {key: string}) => R;
  validateCatalog?: (catalog: C) => unknown | PromiseLike<unknown>;
  /** Observer failures are ignored; event objects are shallowly frozen. */
  onEvent?: (event: Readonly<AuthoringEvent>) => unknown | PromiseLike<unknown>;
}
export interface Authoring<C extends AuthoringCatalog = AuthoringCatalog, R = unknown> {
  build(request: AuthoringRequest, options?: AuthoringOperationOptions): Promise<AuthoringPackage>;
  buildBatch(requests: AuthoringBatchRequest[], options?: AuthoringOperationOptions): Promise<AuthoringPackage[]>;
  publishPack(input: {cards: AuthoringBatchRequest[]; catalog: C; key: string}, options?: AuthoringOperationOptions): Promise<{catalog: C; result: Awaited<R>; digests: string[]}>;
  describe(): {apiVersion: '0.1.0'; importers: string[]; effects: string[]; publication: boolean};
}
/** Publication requires both publishers, a complete catalog, and a stable key. */
export function createAuthoring<C extends AuthoringCatalog = AuthoringCatalog, R = unknown>(options?: AuthoringOptions<C, R>): Authoring<C, R>;
