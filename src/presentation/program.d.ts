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
}
export interface MountedProgram {
  setInputs(inputs: ProgramInputs): void;
  setVisibility(value: 'visible' | 'hidden'): void;
  dispose(): void;
}
export declare function programHeaders(assetOrigin: string): Record<string, string>;
export declare function mountProgram(root: HTMLElement, options: ProgramMountOptions): MountedProgram;
export declare function connectProgram(options?: {onInputs?(inputs: ProgramInputs): void}): Promise<{
  intent(name: string): void;
  dispose(): void;
}>;
