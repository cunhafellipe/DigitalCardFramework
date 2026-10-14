import type {AlbumDisplayGrant, AlbumDisplaySnapshot} from './album-display.js';
export interface ProgramInputs {
  tilt?: {x?: number; y?: number};
  revealProgress?: number;
  flipProgress?: number;
}
export interface ProgramRegistryEntry {
  approved: boolean;
  url: string;
  version: string;
  title?: string;
  intents?: readonly string[];
  albumDisplay?: AlbumDisplayGrant;
}
export type ProgramRegistry = ReadonlyMap<string, ProgramRegistryEntry>;
export interface ProgramMountOptions {
  programId: string;
  registry: ProgramRegistry;
  inputs?: ProgramInputs;
  onIntent?(event: {intent: string}): void;
  maxMessagesPerSecond?: number;
  handshakeTimeout?: number;
  onReady?(): void;
  onError?(error: {code: string}): void;
  albumDisplay?: AlbumDisplaySnapshot;
  onAlbumSelect?(event: {snapshotId: string; handle: string}): void;
}
export interface MountedProgram {
  setInputs(inputs: ProgramInputs): void;
  setAlbumDisplay(snapshot: AlbumDisplaySnapshot): void;
  setVisibility(value: 'visible' | 'hidden'): void;
  dispose(): void;
}
export declare function programHeaders(assetOrigin: string): Record<string, string>;
export declare function mountProgram(root: HTMLElement, options: ProgramMountOptions): MountedProgram;
export declare function connectProgram(options?: {onInputs?(inputs: ProgramInputs): void; onAlbumDisplay?(snapshot: AlbumDisplaySnapshot): void}): Promise<{
  intent(name: string): void;
  selectItem(snapshotId: string, handle: string): void;
  dispose(): void;
}>;
