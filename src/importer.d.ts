import type {Schemas} from './wire-types.js';

export interface ParseContentOptions {format?: 'json' | 'yaml' | 'yml'; maxBytes?: number;}
export type PrepareImportOptions = Pick<Schemas['ImportPreviewRequest'], 'source' | 'mode' | 'expectedVersion'> & {
  format?: ParseContentOptions['format'];
  base?: Schemas['CatalogManifest'] | null;
};
/** Import preparation precedes the policy revision added by the admin preview endpoint. */
export type PreparedImport = Pick<Schemas['ImportPreview'], 'manifest' | 'digest' | 'expectedVersion' | 'changes' | 'warnings'> & {
  counts: Record<'cards' | 'variants' | 'products' | 'combinations', number>;
};
export declare function contentDigest(value: unknown): string;
export declare function parseContent(source: string, options?: ParseContentOptions): unknown;
export declare function prepareImport(options: PrepareImportOptions): PreparedImport;
export declare function exportContent(manifest: unknown, options?: {format?: 'json' | 'yaml'}): string;
