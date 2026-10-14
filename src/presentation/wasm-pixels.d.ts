export interface AdapterFrame {
  inputs: Readonly<Record<string, number | boolean>>;
  activeTimeSeconds: number;
  deltaSeconds?: number;
  quality?: string;
  staticMotion: boolean;
}
export interface AdapterCaptureLease { readonly canvas: HTMLCanvasElement; dispose(): void; }
export interface PixelAdapterContext {
  width: number;
  height: number;
  signal: AbortSignal;
  invalidate(): void;
  initialFrame?: AdapterFrame;
}
export interface PixelProgram { id: string; version: string; url: string; sha256: string; }
export interface PixelAdapterData { program: string; version: string; clock?: boolean; params?: number[]; }
export interface PixelAdapterInstance {
  readonly canvas: HTMLCanvasElement;
  update(frame: AdapterFrame): { needsTime: boolean };
  render(): void;
  settle(frame: AdapterFrame, options?: { signal?: AbortSignal }): Promise<AdapterCaptureLease>;
  dispose(): void;
}
export interface WasmPixelAdapter {
  readonly id: 'dc.wasm-pixels';
  readonly version: '0.1.0';
  readonly apiVersion: '0.1.0';
  readonly trust: 'host-installed';
  readonly capabilities: string[];
  readonly provides: string[];
  readonly fallback: 'poster';
  estimate(size: { width: number; height: number }): number;
  create(context: PixelAdapterContext, data: PixelAdapterData): Promise<PixelAdapterInstance>;
  setEnabled(id: string, version: string, enabled: boolean): void;
  dispose(): void;
}
export declare function wasmPixelAdapter(options: {
  programs: readonly PixelProgram[];
  maxWorkers?: number;
  maxPixels?: number;
  memoryPages?: number;
  deadlineMs?: number;
  maxModuleBytes?: number;
}): WasmPixelAdapter;
