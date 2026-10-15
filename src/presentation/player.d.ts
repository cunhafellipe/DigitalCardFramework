import type {AlbumMotionInput} from './album-motion.js';
import type {PackageBrowserResolver} from './package.js';
import type {CompilerPackage} from './compiler.js';
import type {PerformanceQuality} from './performance.js';
import type {PresentationEvent, PublicInputManifest} from './integration.js';
import type {AdapterFrame, AdapterCaptureLease, PixelAdapterContext} from './wasm-pixels.js';

export interface PlayerBudget {
  estimatedGpuBytes: number; maxDpr: number; maxZoom: number; renderScale: number;
  maxCanvasPixels: number; maxTextureEdge: number; activeVideoDecoders: number; maxGraphOperationsPerUpdate: number;
}
export interface PlayerResolver extends PackageBrowserResolver {
  manifest: PackageBrowserResolver['manifest'] & PublicInputManifest;
}
export interface PlayerAdapterContext extends PixelAdapterContext {
  digest: string;
  asset(id: string): ReturnType<PlayerResolver['asset']>;
  backend: {id: 'dc.webgl2'; apiVersion: '0.1.0'; port: unknown};
}
export interface PlayerAdapterInstance {
  readonly canvas: HTMLCanvasElement;
  update(frame: AdapterFrame): {needsTime: boolean};
  render(): void;
  settle?(frame: AdapterFrame, options: {signal: AbortSignal}): AdapterCaptureLease | PromiseLike<AdapterCaptureLease>;
  dispose(): void;
}
export interface PlayerAdapter {
  id: string;
  capabilities?: readonly string[];
  estimate(size: {width: number; height: number}): number;
  create(context: PlayerAdapterContext, data: unknown): PlayerAdapterInstance | PromiseLike<PlayerAdapterInstance>;
}
export type PlayerResult = {mode: 'cancelled'} | {mode: 'poster'; quality: 'poster'; fallbackReason?: string} |
  {mode: 'interactive'; quality: PerformanceQuality};
export interface PlayerView {
  element: HTMLDivElement;
  ready: Promise<PlayerResult>;
  setInputs(input: AlbumMotionInput): Promise<PlayerResult | undefined> | undefined;
  setVisibility(state: 'visible' | 'prewarm' | 'hidden'): void;
  setAudio(options?: {enabled?: boolean; volume?: number}): void;
  setQuality(quality: PerformanceQuality): Promise<PlayerResult | undefined> | undefined;
  setSide(side: 'front' | 'back'): Promise<PlayerResult | undefined> | undefined;
  setLayerVisible(id: string, visible: boolean): void;
  updateScene(scene: CompilerPackage['scenes'] extends Map<string, infer S> ? S : never): Promise<PlayerResult | undefined>;
  activate(): void;
  snapshot(): Promise<Blob>;
  dispose(): void;
}
export interface PlayerDiagnostics {
  resolution: {width: number; height: number; scaleX: number; scaleY: number; requestedDpr: number; effectiveDpr: number; limited: boolean} | null;
  textureBytes: number; limits: PlayerBudget; views: number; pendingJobs: number; activeViews: number;
  scheduledFrames: number; frames: number; estimatedGpuBytes: number; assetReferences: number; requestedVideoDecoders: number;
  draws?: number; textures?: number; surfaceBytes?: number; groupSurfaces?: number;
}
export interface PlayerStage {
  mount(target: HTMLElement, model: {title?: string; resolver: PlayerResolver}, options?: PlayerMountOptions): PlayerView;
  mount(target: HTMLElement, model: {title?: string; resolver?: PlayerResolver}, options: PlayerMountOptions & {resolver: PlayerResolver}): PlayerView;
  setBudget(budget: Partial<PlayerBudget>): Promise<void>;
  invalidateLayout(): void;
  diagnostics(): PlayerDiagnostics;
  dispose(): void;
}
export interface PlayerMountOptions {
  resolver?: PlayerResolver; quality?: PerformanceQuality; side?: 'front' | 'back'; inputMode?: string;
  onEvent?(event: PresentationEvent): void;
}
export function createPlayerStage(options: {
  root: HTMLElement; budget?: Partial<PlayerBudget>; motion?: 'static' | 'respect-preference';
  adapters?: readonly PlayerAdapter[]; onDiagnostic?(event: PresentationEvent): void;
}): PlayerStage;
