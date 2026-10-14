import type {RevealState, RevealController} from '../client.js';
import type {Localization} from '../localization.js';
import type {ProgramRegistry} from './program.js';
import type {OpenerDisplayField} from './opener-display.js';
export type OpenerCard = NonNullable<RevealState['receipt']>['cards'][number];
export interface ProgramOpenerContext {
  localization?: Localization;
  onSelect?(copy: OpenerCard): void;
  cardRenderer?(copy: OpenerCard, options: {onSelect?(copy: OpenerCard): void; localization?: Localization}): HTMLElement;
  packArtwork?(receiptId: string): unknown;
}
export interface ProgramOpenerInstance {
  node: HTMLElement;
  update(state: RevealState): void;
  dispose(): void;
}
export interface ProgramOpenerView {
  (state: RevealState, controller: RevealController, context?: ProgramOpenerContext): ProgramOpenerInstance;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}
export interface ProgramOpenerOptions {
  registry: ProgramRegistry;
  programId: string;
  displayFields?: readonly OpenerDisplayField[];
  viewportHeight?: number;
  maxActivePrograms?: number;
  handshakeTimeout?: number;
  maxMessagesPerSecond?: number;
  onDiagnostic?(event: {code: string; programId?: string}): void;
}
export declare function createProgramOpenerView(options: ProgramOpenerOptions): ProgramOpenerView;
