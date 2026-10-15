import type {ParsedLayeredDocument} from './layered-source.js';
import type {LayeredPackage} from './layered-package.js';

export interface ImportLayeredFileOptions {
  workerURL?: string | URL;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface LayeredFileImport {
  report: ParsedLayeredDocument['report'];
  sourceSize: {width: number; height: number};
  canFlatten: boolean;
  build(options?: {flatten?: boolean}): Promise<LayeredPackage>;
}
export declare function importLayeredFile(file: File, options?: ImportLayeredFileOptions): Promise<LayeredFileImport>;
