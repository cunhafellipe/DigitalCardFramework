import type {CompilerManifest, CompilerPackage} from './compiler.js';

export interface PackageLimits {
  compressed: number;
  inflated: number;
  entries: number;
  entry: number;
  ratio: number;
}
export const DEFAULT_LIMITS: Readonly<PackageLimits>;
export interface ZipReadOptions extends Partial<PackageLimits> {
  /** Accept directory entries and data descriptors from source artwork archives. */
  sourceArchive?: boolean;
}
export interface PackageValidationOptions {
  verifyMedia?: boolean;
}
export interface PackageImportOptions extends PackageValidationOptions {
  limits?: ZipReadOptions;
}
export type ValidatedPackage = CompilerPackage;
export type BuiltPackage = ValidatedPackage & {archive: Uint8Array};
export function crc32(bytes: Uint8Array): number;
export function writeZip(files: Map<string, Uint8Array>): Uint8Array;
export function readZip(bytes: Uint8Array, options?: ZipReadOptions): Promise<Map<string, Uint8Array>>;
export function sniff(asset: {mediaType: string; width?: number; height?: number}, bytes: Uint8Array): void;
export function validatePackage<F extends ReadonlyMap<string, Uint8Array>>(files: F, options?: PackageValidationOptions): Promise<Omit<ValidatedPackage, 'files'> & {files: F}>;
export function buildPackage(manifest: CompilerManifest, scenes: ReadonlyMap<string, CompilerPackage['scenes'] extends Map<string, infer S> ? S : never>, assets: ReadonlyMap<string, Uint8Array>, options?: PackageValidationOptions): Promise<BuiltPackage>;
export function importPackage(bytes: Uint8Array, options?: PackageImportOptions): Promise<ValidatedPackage>;
export interface PackageBrowserResolver<P extends ValidatedPackage = ValidatedPackage> {
  manifest: P['manifest'];
  scenes: P['scenes'];
  digest: string;
  asset(id: string): Promise<P['manifest']['assets'][number] & {url: string}>;
  dispose(): void;
  diagnostics(): {objectURLs: number};
}
export function browserResolver<P extends ValidatedPackage>(pkg: P): PackageBrowserResolver<P>;
