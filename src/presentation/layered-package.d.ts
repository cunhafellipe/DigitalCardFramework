import type {LayeredSourceNode, LayeredSourceImage, LayeredSourceGroup, LayeredSourceFrame} from './layered-source.js';
import type {SignaturePackage} from './signatures.js';

export interface LayeredPackageDocument {width: number; height: number; title: string; layers: LayeredSourceNode[];}
export type LayeredPackageImage = Omit<LayeredSourceImage, 'bytes' | 'animation'> & {
  asset: string;
  animation?: {progress: ['input', 'angle']; loop: false; frames: (Omit<LayeredSourceFrame, 'bytes'> & {asset: string})[]};
};
export type LayeredPackageNode = LayeredPackageImage | (Omit<LayeredSourceGroup, 'children'> & {children: LayeredPackageNode[]});
export interface LayeredPackageAsset {
  id: string; path: string; mediaType: 'image/png'; width: number; height: number;
  role: 'poster' | 'color'; bytes: number; sha256: string;
}
export interface LayeredPackageManifest {
  format: 'digital-card'; contractVersion: '0.1.0'; id: string; revision: 1; title: string;
  summary: 'Imported layered artwork'; profile: 'portable';
  canvas: {width: number; height: number};
  faces: Record<'front' | 'back', {scene: string; poster: string; description: string}>;
  assets: LayeredPackageAsset[];
  capabilities: {required: string[]; optional: string[]};
  quality: Record<'poster' | 'lite' | 'standard' | 'ultra', {maxEdge: number}>;
}
export interface LayeredPackage extends SignaturePackage {
  archive: Uint8Array;
  manifest: LayeredPackageManifest;
  scenes: Map<string, {dialect: 'dc.scene2d@0.1'; nodes: LayeredPackageNode[]}>;
  files: Map<string, Uint8Array>;
}
export declare function layeredPackage(doc: LayeredPackageDocument, options: {poster: Uint8Array; flatten?: boolean}): Promise<LayeredPackage>;
