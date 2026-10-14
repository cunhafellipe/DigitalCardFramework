import type {ProgramInputs, ProgramRegistry} from './program.js';

export interface ProgramPackProduct {
  id: string;
  name: string;
  lineId: string;
}
export interface ProgramPackOptions<Product extends ProgramPackProduct> {
  small?: boolean;
  lineName?: string;
  previewCards?: HTMLElement[];
  side?: 'front' | 'back';
  onSelect?(product: Product): void;
  [key: string]: unknown;
}
export interface ProgramPackView {
  node: HTMLElement;
  setSide?(side: 'front' | 'back'): void;
  setPresentationInputs?(inputs: ProgramInputs): void;
  dispose?(): void;
}
export interface ProgramPackRenderer<Product extends ProgramPackProduct> {
  (product: Product, options?: ProgramPackOptions<Product>): ProgramPackView | HTMLElement;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}
export interface ProgramPackRendererOptions<Product extends ProgramPackProduct> {
  registry: ProgramRegistry;
  products?: Readonly<Record<string, string>>;
  fallbackRenderer?(product: Product, options: ProgramPackOptions<Product>): ProgramPackView | HTMLElement;
  maxActivePrograms?: number;
  handshakeTimeout?: number;
  maxMessagesPerSecond?: number;
  onDiagnostic?(event: {code: string; programId?: string}): void;
}
export declare function createProgramPackRenderer<Product extends ProgramPackProduct = ProgramPackProduct>(options: ProgramPackRendererOptions<Product>): ProgramPackRenderer<Product>;
