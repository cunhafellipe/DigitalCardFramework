import type {PNGImageData} from './png-encode.js';

export type LayeredSourceFormat = 'psd' | 'ora' | 'layer-zip' | 'gif';
export interface LayeredSourceLimits {bytes?: number; pixels?: number; edge?: number; layers?: number; depth?: number; frames?: number;}
export interface ParseLayeredSourceOptions {
  format: LayeredSourceFormat;
  encodeRGBA(image: PNGImageData): Uint8Array | Promise<Uint8Array>;
  limits?: LayeredSourceLimits;
}
export interface LayeredSourceIssue {layer: string | undefined; code: string; message: string;}
export interface LayeredSourceReport<F extends LayeredSourceFormat = LayeredSourceFormat> {
  format: F;
  issues: LayeredSourceIssue[];
  notes: (F extends 'gif' ? string : {layer: string; message: string})[];
  layerCount: number;
}
export interface LayeredSourceFrame {
  x: number; y: number; width: number; height: number;
  rect: [number, number, number, number];
  bytes: Uint8Array;
  duration: number;
}
export interface LayeredSourceNodeBase {
  id: string; name?: string; x: number; y: number;
  opacity?: number;
  blend?: 'normal' | 'screen' | 'multiply' | 'add';
  parallax?: unknown;
  material?: unknown;
  bindings?: unknown;
}
export interface LayeredSourceImage extends LayeredSourceNodeBase {
  type: 'image'; width: number; height: number; bytes: Uint8Array;
  animation?: {progress: ['input', 'angle']; loop: false; frames: LayeredSourceFrame[]};
}
export interface LayeredSourceGroup extends LayeredSourceNodeBase {type: 'group'; children: LayeredSourceNode[];}
export type LayeredSourceNode = LayeredSourceImage | LayeredSourceGroup;
export interface LayeredDocument {
  width: number; height: number; title: string; layers: LayeredSourceNode[];
  merged: Uint8Array | null | undefined;
  report: LayeredSourceReport<'psd' | 'ora' | 'layer-zip'>;
}
export interface LayeredGIFDocument {
  width: number; height: number; title: string; layers: LayeredSourceImage[];
  poster: Uint8Array;
  report: LayeredSourceReport<'gif'>;
}
export type ParsedLayeredDocument = LayeredDocument | LayeredGIFDocument;
export declare function parseLayeredSource(bytes: Uint8Array, options: ParseLayeredSourceOptions & {format: 'gif'}): Promise<LayeredGIFDocument>;
export declare function parseLayeredSource(bytes: Uint8Array, options: ParseLayeredSourceOptions & {format: 'psd' | 'ora' | 'layer-zip'}): Promise<LayeredDocument>;
export declare function parseLayeredSource(bytes: Uint8Array, options: ParseLayeredSourceOptions): Promise<ParsedLayeredDocument>;
