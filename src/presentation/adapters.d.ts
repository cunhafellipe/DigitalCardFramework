import type {ExtensionModule} from './extensions.js';
import type {AdapterFrame, PixelAdapterContext} from './wasm-pixels.js';

/** Resource and cancellation fields used by the optional media adapters. */
export interface MediaAdapterContext extends Pick<PixelAdapterContext, 'width' | 'height' | 'signal'> {
  asset(id: string): Promise<{url: string}>;
}
export interface MediaAdapterData {
  asset: string;
  clock?: boolean;
  duration?: number;
}
export interface MediaAdapterInstance {
  canvas: HTMLCanvasElement;
  update(frame: AdapterFrame): {needsTime: boolean};
  render(): void;
  dispose(): void;
}
export interface MediaAdapter<I extends string, D extends MediaAdapterData, C extends MediaAdapterContext = MediaAdapterContext> extends ExtensionModule {
  id: I;
  version: '0.1.0';
  apiVersion: '0.1.0';
  trust: 'host-installed';
  capabilities: string[];
  provides: string[];
  fallback: 'poster';
  estimate(size?: {width?: number; height?: number}): number;
  create(context: C, data: D): Promise<MediaAdapterInstance>;
}
/** Imports require the optional pinned media dependencies used by this bundle. */
export function gltfAdapter(): MediaAdapter<'dc.gltf', MediaAdapterData & {turnRadians?: number}>;
export function riveAdapter(options: {
  wasmURL: string; approvedDigests?: readonly string[];
}): MediaAdapter<'dc.rive', MediaAdapterData & {artboard?: string; animation?: string}, MediaAdapterContext & {digest: string}>;
export function dotLottieAdapter(options: {wasmURL: string}): MediaAdapter<'dc.dotlottie', MediaAdapterData & {animation?: string}>;
