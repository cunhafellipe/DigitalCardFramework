import type {AlbumDisplayField} from './album-display.js';
import type {ProgramRegistry} from './program.js';
import type {ProgramCardCopy, ProgramCardOptions} from './program-card-view.js';

export interface ProgramAlbumModel<Copy extends ProgramCardCopy> {
  name?: string;
  layout?: {id?: string; pageSize?: number; artwork?: unknown};
  cards: readonly {copy: Copy; placement?: {position?: number; data?: unknown}}[];
}
export interface ProgramAlbumOptions<Copy extends ProgramCardCopy> {
  cardRenderer?(copy: Copy, options?: ProgramCardOptions<Copy>): HTMLElement;
  onSelect?(copy: Copy): void;
  [key: string]: unknown;
}
export interface ProgramAlbumNode extends HTMLElement {
  dispose?(): void;
}
export interface ProgramAlbumRenderer<Copy extends ProgramCardCopy> {
  (model: ProgramAlbumModel<Copy>, options?: ProgramAlbumOptions<Copy>): ProgramAlbumNode;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}
export interface ProgramAlbumRendererOptions<Copy extends ProgramCardCopy> {
  registry: ProgramRegistry;
  programId: string;
  displayFields?: readonly AlbumDisplayField[];
  fallbackRenderer?(model: ProgramAlbumModel<Copy>, options: ProgramAlbumOptions<Copy>): HTMLElement | {node: HTMLElement; dispose?(): void};
  viewportHeight?: number;
  maxActivePrograms?: number;
  handshakeTimeout?: number;
  maxMessagesPerSecond?: number;
  onDiagnostic?(event: {code: string; programId?: string}): void;
}
export declare function createProgramAlbumRenderer<Copy extends ProgramCardCopy = ProgramCardCopy>(options: ProgramAlbumRendererOptions<Copy>): ProgramAlbumRenderer<Copy>;
