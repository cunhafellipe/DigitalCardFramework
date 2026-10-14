import type {Schemas} from '../wire-types.js';

export type PerformanceQuality = 'poster' | 'lite' | 'standard' | 'ultra';
export interface PerformancePolicy {
  mode: 'warn' | 'reject' | 'off';
  quality: PerformanceQuality;
  layerTextureBytes: number;
  faceTextureBytes: number;
  layerDownloadBytes: number;
  drawLayers: number;
  fullCanvasPasses: number;
  animationFrames: number;
  animatedPixels: number;
  decoders: number;
}
export const mobilePerformanceDefaults: Readonly<PerformancePolicy> & {readonly mode:'warn';readonly quality:'standard'};
export function performancePolicy(overrides?: Partial<PerformancePolicy>): Readonly<PerformancePolicy>;
/** Fields read by the analyzer; the package or project must already be validated. */
export interface PerformanceNode {
  id: string;
  type: string;
  width?: number;
  height?: number;
  children?: readonly PerformanceNode[];
  isolate?: boolean;
  asset?: string;
  typography?: Schemas['CardTypography'];
  runs?: readonly {text?: string;icon?: string}[];
  data?: unknown;
  mask?: {asset?: string;polygon?: readonly (readonly number[])[];rect?: readonly number[];invert?: boolean;transform?: object};
  video?: {poster?: string};
  material?: {kind?: string;maskAsset?: string;mask?: {asset?: string;polygon?: readonly (readonly number[])[];rect?: readonly number[];invert?: boolean;transform?: object};flakeAsset?: string};
  animation?: {frames?: readonly {asset: string}[]};
}
export interface PerformanceInput {
  manifest: {
    assets: readonly {id: string;width?: number;height?: number;bytes?: number}[];
    quality: Partial<Record<PerformanceQuality, {maxEdge: number}>>;
    canvas: {width: number;height: number};
    faces: Readonly<Record<string, {scene: string}>>;
  };
  scenes: ReadonlyMap<string, {nodes: readonly PerformanceNode[]}>;
}
export interface PerformanceLayer {
  face: string;
  layerId: string;
  path: string;
  assetIds: string[];
  estimatedTextureBytes: number;
  downloadBytes: number;
  estimatedGroupSurfaceBytes?: number;
}
export interface PerformanceFace {
  estimatedTextureBytes: number;
  estimatedGroupSurfaceBytes: number;
  drawLayers: number;
  fullCanvasPasses: number;
  decoders: number;
}
export type PerformanceIssue = {
  severity: 'warning';face: string;layerId: string;path: string;assetIds: string[];message: string;remedy: string;
} & ({code:'ADAPTER_COST_UNKNOWN';measured:null;threshold:null} | {
  code:'LAYER_TEXTURE'|'LAYER_DOWNLOAD'|'ANIMATION_FRAMES'|'ANIMATION_PIXELS'|'FACE_TEXTURE'|'FACE_LAYERS'|'FACE_OVERDRAW'|'FACE_DECODERS';
  measured:number;threshold:number;
});
export interface PerformanceReport {
  version: 1;
  policy: Readonly<PerformancePolicy>;
  issues: PerformanceIssue[];
  layers: PerformanceLayer[];
  faces: Record<string, PerformanceFace>;
  accepted: boolean;
  caveat: string;
}
export function analyzePerformance(input: PerformanceInput, overrides?: Partial<PerformancePolicy>): PerformanceReport;
/** Returns the same report, or throws an error with code PERFORMANCE_POLICY and the report. */
export function enforcePerformance<T extends {accepted:boolean;issues:readonly {face:string;path:string;code:string}[]}>(report:T):T;
