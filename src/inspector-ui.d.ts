import type {Schemas} from './wire-types.js';
import type {Localization, LocalizationMessages} from './localization.js';
import type {ProgramCardCopy, ProgramCardNode, ProgramCardOptions} from './presentation/program-card-view.js';

export type InspectorCopy = Pick<Schemas['Copy'], 'id' | 'cardId' | 'lineId' | 'rarityId'> & Partial<Pick<Schemas['Copy'],
  'serialNumber' | 'editionTotal' | 'openedBy' | 'openedAt' | 'openedByName' | 'metadata' | 'bindings' | 'codes' | 'provenance'>> & {
  definition: ProgramCardCopy['definition'] & {description?: string; tags?: string[]; stats?: Record<string, unknown>; metadata?: Record<string, unknown>};
  variant: ProgramCardCopy['variant'] & {metadata?: Record<string, unknown>};
};
export interface InspectorCombination {
  id?: string;
  name: string;
  rows: number;
  columns: number;
  gap?: number;
  pieces: readonly {cardId: string; row: number; column: number}[];
}
export interface InspectorCatalog {
  displayFields?: readonly {path: string; label: string}[];
  combinations?: readonly InspectorCombination[];
}
export interface InspectorCardOptions<C extends InspectorCopy> extends ProgramCardOptions<C> {
  interactive: false;
  localization: Localization;
  presentationMode?: 'interactive';
  backRenderer?: (copy: C) => Node | string;
}
export interface InspectorRenderingOptions<C extends InspectorCopy> {
  cardRenderer(copy: C, options: InspectorCardOptions<C>): ProgramCardNode;
  onClose?: (event: MouseEvent) => unknown;
  locale?: string;
  messages?: LocalizationMessages;
  localization?: Localization;
}
export interface InspectorOptions<C extends InspectorCopy> extends InspectorRenderingOptions<C> {
  metadataRenderer?: (copy: C, options: {localization: Localization}) => Node | string;
  backRenderer?: (copy: C) => Node | string;
  labels?: {line?: string; rarity?: string};
  catalog?: InspectorCatalog;
}
export interface ComparisonOptions<C extends InspectorCopy> extends InspectorRenderingOptions<C> {
  catalog: InspectorCatalog;
}
/** Returns the inspector element directly, without a separate disposal wrapper. */
export function render3DInspector<C extends InspectorCopy>(copy: C, options: InspectorOptions<C>): HTMLElement;
export function renderComparison<C extends InspectorCopy>(copies: readonly C[], options: ComparisonOptions<C>): HTMLElement;
