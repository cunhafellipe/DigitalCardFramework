import type {ProgramInputs, ProgramRegistry} from './program.js';

export interface ProgramCardCopy {
  cardId?: string;
  variantId?: string;
  variant: {id?: string; finish?: string};
  rarityId: string;
  definition: {id?: string; name: string};
}
export interface ProgramCardOptions<Copy extends ProgramCardCopy> {
  onSelect?(copy: Copy): void;
  interactive?: boolean;
  [key: string]: unknown;
}
export interface ProgramCardNode extends HTMLElement {
  setPresentationInputs?(inputs: ProgramInputs): void;
  setPresentationSide?(side: 'front' | 'back'): void;
  dispose?(): void;
}
export interface ProgramCardRenderer<Copy extends ProgramCardCopy> {
  (copy: Copy, options?: ProgramCardOptions<Copy>): ProgramCardNode;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}
export interface ProgramCardRendererOptions<Copy extends ProgramCardCopy> {
  registry: ProgramRegistry;
  cards?: Readonly<Record<string, string>>;
  variants?: Readonly<Record<string, string>>;
  fallbackRenderer?(copy: Copy, options: ProgramCardOptions<Copy>): HTMLElement;
  maxActivePrograms?: number;
  handshakeTimeout?: number;
  maxMessagesPerSecond?: number;
  onDiagnostic?(event: {code: string; programId?: string}): void;
}
export declare function createProgramCardRenderer<Copy extends ProgramCardCopy = ProgramCardCopy>(options: ProgramCardRendererOptions<Copy>): ProgramCardRenderer<Copy>;
