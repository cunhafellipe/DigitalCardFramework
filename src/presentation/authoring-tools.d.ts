import type {Schemas} from '../wire-types.js';
import type {CardPolicyContext, CardPolicyInspectionIssue, CardStatScope} from '../card-policy.js';
import type {Project, ProjectNode} from './project.js';
import type {BuiltPackage, ValidatedPackage} from './package.js';
import type {TextNode, TextStatBinding} from './text.js';
import type {PerformanceNode} from './performance.js';

export type AuthoringSide = 'front' | 'back';
export function addText(project: Project, side?: AuthoringSide, options?: Partial<ProjectNode> & Partial<TextNode>): string;
export function configureAuthoring(project: Project, options?: {policy?: Schemas['CardPolicyEffective']; context?: CardPolicyContext; policyRevision?: number}): void;
/** Values are validated against the configured stat field when the project is edited. */
export function setStat(project: Project, key: string, value: unknown, scope?: CardStatScope): void;
export function addStatBlock(project: Project, side: AuthoringSide, keys: (string | {key: string; scope: CardStatScope})[], options?: {
  view?: TextStatBinding['view']; x?: number; y?: number; width?: number; rowHeight?: number; columns?: number;
}): string[];
export type SelectionCommand = 'lock' | 'unlock' | 'forward' | 'backward' | 'delete' | 'duplicate' | 'group' | 'ungroup' | 'left' | 'right' | 'top' | 'bottom' | 'center' | 'snap';
export function transformSelection(project: Project, side: AuthoringSide, ids: string[], command: SelectionCommand, value?: number): void;

export type LibraryEntry = Schemas['CardLibraryResource'] & {key: string; archive?: Uint8Array; shared?: boolean};
export interface LibraryWriter<E = LibraryEntry, R = unknown> {put(entry: E): R}
export interface LibraryReader<E = LibraryEntry> {
  list(): Promise<E[]>;
  get(key: string): Promise<E | undefined>;
}
export interface MemoryLibrary<E extends {key: string} = LibraryEntry> extends LibraryReader<E>, LibraryWriter<E, Promise<void>> {
  remove(key: string): Promise<void>;
}
export interface LocalLibrary<E extends {key: string} = LibraryEntry> extends LibraryReader<E>, LibraryWriter<E, Promise<IDBValidKey>> {
  remove(key: string): Promise<undefined>;
}
export function createMemoryLibrary<E extends {key: string} = LibraryEntry>(): MemoryLibrary<E>;
/** Stores structured-cloneable entries in IndexedDB using immutable entry keys. */
export function createLocalLibrary<E extends {key: string} = LibraryEntry>(name?: string): LocalLibrary<E>;
export interface SharedLibraryClient<R = Schemas['CardResourceSaveReceipt']> {
  cardPolicies(): Schemas['CardPolicyRegistry'] | PromiseLike<Schemas['CardPolicyRegistry']>;
  saveCardResource(input: Schemas['CardLibrarySave']): R;
}
export type SharedLibraryEntry = LibraryEntry & {shared: true};
export interface SharedLibrary<R = Schemas['CardResourceSaveReceipt']> extends LibraryReader<SharedLibraryEntry>, LibraryWriter<LibraryEntry, Promise<Awaited<R>>> {}
export function createSharedLibrary<R = Schemas['CardResourceSaveReceipt']>(options: {
  client: SharedLibraryClient<R>;
  upload(pkg: ValidatedPackage): unknown | PromiseLike<unknown>;
  download(digest: string): Uint8Array | PromiseLike<Uint8Array>;
}): SharedLibrary<R>;
export interface CombinedLibrary<P, S, PR, PI = P> extends LibraryWriter<PI, PR> {
  list(): Promise<(P | S)[]>;
  get(key: string, sharedEntry?: boolean): Promise<P | S | undefined>;
}
export function combineLibraries<P, S, PI, SI, PR, SR>(personal: LibraryReader<P> & LibraryWriter<PI, PR>, shared: LibraryReader<S> & LibraryWriter<SI, SR>, options: {canShare: true}): CombinedLibrary<P, S, PR, PI> & {share(entry: SI): SR};
export function combineLibraries<P, S, PI, SI, PR, SR>(personal: LibraryReader<P> & LibraryWriter<PI, PR>, shared: LibraryReader<S> & LibraryWriter<SI, SR>, options?: {canShare?: false}): CombinedLibrary<P, S, PR, PI>;
export function combineLibraries<P, S, PI, SI, PR, SR>(personal: LibraryReader<P> & LibraryWriter<PI, PR>, shared: LibraryReader<S> & LibraryWriter<SI, SR>, options: {canShare?: boolean}): CombinedLibrary<P, S, PR, PI> & {share?: (entry: SI) => SR};

export interface LibrarySaveOptions {id?: string; revision?: number; name?: string; tags?: string[]}
type LibraryDocument = Schemas['CardLibraryResource']['document'];
export interface TemplateSlot {face?: AuthoringSide; nodeId: string; fixed: Record<string, unknown>}
export interface TemplateStructureNode {id: string; children?: TemplateStructureNode[]}
export type TemplateEntry = Omit<LibraryEntry, 'kind' | 'document' | 'archive'> & {
  kind: 'template'; archive: Uint8Array;
  document: LibraryDocument & {
    canvas: {width: number; height: number}; packageDigest: string; slots: TemplateSlot[];
    structure: Record<string, TemplateStructureNode[]>; assetDigests: Record<string, string>; tags: string[];
  };
};
export type TextStyleEntry = Omit<LibraryEntry, 'kind' | 'document'> & {
  kind: 'style'; document: LibraryDocument & {typography: Schemas['CardTypography']; packageDigest: string; tags: string[]};
};
export type MaskEntry = Omit<LibraryEntry, 'kind' | 'document' | 'archive'> & {
  kind: 'mask'; archive: Uint8Array;
  document: LibraryDocument & {use: 'clip' | 'effect'; mask: NonNullable<PerformanceNode['mask']>; packageDigest: string; tags: string[]};
};
export function saveTextStyle(project: Project, node: Pick<TextNode, 'typography'>, library: LibraryWriter<TextStyleEntry & {archive: Uint8Array}>, options?: LibrarySaveOptions): Promise<TextStyleEntry & {archive: Uint8Array}>;
export function applyTextStyle(project: Project, side: AuthoringSide, nodeId: string, entry: TextStyleEntry): Promise<void>;
export function saveTemplate(project: Project, library: LibraryWriter<TemplateEntry>, options?: LibrarySaveOptions): Promise<TemplateEntry>;
export function loadTemplate(entry: TemplateEntry): Promise<BuiltPackage>;
export function saveMask(project: Project, side: AuthoringSide, nodeId: string, library: LibraryWriter<MaskEntry>, options?: LibrarySaveOptions & {use?: 'clip' | 'effect'}): Promise<MaskEntry>;
export function applyMask(project: Project, side: AuthoringSide, nodeId: string, entry: MaskEntry): Promise<void>;
export interface TemplateMigrationPreview {
  beforeDigest: string;
  template: string;
  changes: {face: string; nodeId: string; change: 'added' | 'updated' | 'removed'}[];
  package: BuiltPackage;
}
export type TemplateBatchResult = {id: string; preview: TemplateMigrationPreview; error?: never} | {id: string; error: {code: string; message: string}; preview?: never};
export function previewTemplateMigration(project: Project, entry: TemplateEntry): Promise<TemplateMigrationPreview>;
export function applyTemplateMigration(project: Project, preview: TemplateMigrationPreview): Promise<void>;
export function previewTemplateBatch(projects: Project[], entry: TemplateEntry): Promise<TemplateBatchResult[]>;
export function inspectProject(project: Project, policy: Schemas['CardPolicyEffective']): CardPolicyInspectionIssue[];
