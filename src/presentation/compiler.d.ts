import type {PathLike} from 'node:fs';
import type {SignaturePackage} from './signatures.js';
import type {PerformanceInput, PerformanceNode, PerformancePolicy, PerformanceReport} from './performance.js';

export type CompilerManifest = PerformanceInput['manifest'] & {
  assets: {id: string; path: string; mediaType: string; width?: number; height?: number; bytes?: number; sha256?: string}[];
  [key: string]: unknown;
}
export interface CompilerPackage extends SignaturePackage {
  manifest: CompilerManifest;
  scenes: Map<string, {nodes: PerformanceNode[]; [key: string]: unknown}>;
  files: Map<string, Uint8Array>;
}
export interface CompilerReport {
  digest: string;
  downloadBytes: number;
  assets: number;
  profiles: Record<string, {estimatedTextureBytes: number; maxEdge: number}>;
  warnings: string[];
  performance: PerformanceReport;
}
export interface CompiledPackage extends CompilerPackage {
  archive: Uint8Array;
  report: CompilerReport;
}
export interface CompilerImageResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  mediaType: string;
}
export interface CompileDirectoryOptions {
  root: PathLike;
  out: string;
  archivePath?: string;
  maxEdge?: number;
  imageProcessor?: (bytes: Uint8Array, options: {maxEdge: number; mediaType: string}) => CompilerImageResult | PromiseLike<CompilerImageResult>;
  performance?: Partial<PerformancePolicy>;
  signal?: AbortSignal;
}
export interface PublicationOptions {
  contentRoot: string;
  limits?: Partial<{compressed: number; inflated: number; entries: number; entry: number; ratio: number}>;
  performance?: Partial<PerformancePolicy>;
  expectedDigest?: string;
  stagingPath?: string;
  temporaryBytes?: number;
}
export function readWithin(root: PathLike, relative: string): Promise<Uint8Array>;
export function compileDirectory(options: CompileDirectoryOptions): Promise<CompiledPackage>;
export function writeCompiled(pkg: Pick<SignaturePackage, 'files'> & {archive: Uint8Array}, options: {out: string; archivePath?: string}): Promise<void>;
export function buildReport(pkg: Pick<CompilerPackage, 'digest' | 'manifest' | 'scenes' | 'files'>, performance?: Partial<PerformancePolicy>): CompilerReport;
export function publishPackage(bytes: Uint8Array, options: PublicationOptions): Promise<{digest: string; folder: string; report: CompilerReport}>;
