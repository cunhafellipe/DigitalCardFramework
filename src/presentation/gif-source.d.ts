import type {PNGImageData} from './png-encode.js';
import type {LayeredGIFDocument, LayeredSourceLimits} from './layered-source.js';

export type GIFSourceLimits = Pick<LayeredSourceLimits, 'frames' | 'pixels' | 'edge'>;
export interface GIFInspection {width: number; height: number; frames: number;}
export interface ParseGIFSourceOptions {
  encodeRGBA(image: PNGImageData): Uint8Array | Promise<Uint8Array>;
  limits?: GIFSourceLimits;
  signal?: AbortSignal;
}
export declare function inspectGIF(bytes: Uint8Array, limits?: GIFSourceLimits): GIFInspection;
export declare function parseGIFSource(bytes: Uint8Array, options: ParseGIFSourceOptions): Promise<LayeredGIFDocument>;
