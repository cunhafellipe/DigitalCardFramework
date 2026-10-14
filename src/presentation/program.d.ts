import type {AlbumDisplayGrant, AlbumDisplaySnapshot} from './album-display.js';
import type {OpenerDisplayGrant, OpenerDisplaySnapshot, OpenerIntent, OpenerIntentEvent} from './opener-display.js';
import type {EditorDisplayGrant,EditorDisplaySnapshot,EditorProposal} from './editor-display.js';
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
  openerDisplay?: OpenerDisplayGrant;
  editorDisplay?: EditorDisplayGrant;
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
  openerDisplay?: OpenerDisplaySnapshot;
  onOpenerIntent?(event: OpenerIntentEvent): void;
  editorDisplay?:EditorDisplaySnapshot;
  onEditorProposal?(event:EditorProposal):void;
  onSessionEnd?():void;
}
export interface MountedProgram {
  setInputs(inputs: ProgramInputs): void;
  setAlbumDisplay(snapshot: AlbumDisplaySnapshot): void;
  setOpenerDisplay(snapshot: OpenerDisplaySnapshot): void;
  setEditorDisplay(snapshot:EditorDisplaySnapshot):void;
  setVisibility(value: 'visible' | 'hidden'): void;
  dispose(): void;
}
export declare function programHeaders(assetOrigin: string): Record<string, string>;
export declare function mountProgram(root: HTMLElement, options: ProgramMountOptions): MountedProgram;
export declare function connectProgram(options?: {onInputs?(inputs: ProgramInputs): void; onAlbumDisplay?(snapshot: AlbumDisplaySnapshot): void; onOpenerDisplay?(snapshot: OpenerDisplaySnapshot): void;onEditorDisplay?(snapshot:EditorDisplaySnapshot):void}): Promise<{
  editorProposal(snapshotId:string,revision:number,patch:EditorProposal['patch']):void;
  intent(name: string): void;
  selectItem(snapshotId: string, handle: string): void;
  openerIntent(intent: OpenerIntent, snapshotId: string, handle?: string): void;
  dispose(): void;
}>;
