import type {Client, CommandRunner, RevealController, RevealState} from './client.js';
import type {Operations, Schemas} from './wire-types.js';
import type {Localization, LocalizationMessages} from './localization.js';
import type {AlbumLayout} from './album-appearance.js';
import type {ApplicationShellMounted, ApplicationShellSource} from './application-shell.js';
import type {InspectorCopy, InspectorOptions, ComparisonOptions} from './inspector-ui.js';
import type {ProgramInputs} from './presentation/program.js';
import type {CodeHistoryRevealRenderer} from './code-ui.js';
import type {MarketplaceListingRenderer} from './marketplace-session.js';

export {albumAppearance, validateAlbumAppearance} from './album-appearance.js';
export const defaultCSS: string;
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: unknown): HTMLElementTagNameMap[K];
export function element(tag: string, className?: string, text?: unknown): HTMLElement;

export interface UILocalizationOptions {
  locale?: string;
  messages?: LocalizationMessages;
  localization?: Localization;
}
export type UIThemeToken = '--dc-bg' | '--dc-panel' | '--dc-text' | '--dc-muted' | '--dc-accent' |
  '--dc-border' | '--dc-radius' | '--dc-card-ratio' | '--dc-font' | '--dc-button-text' | '--dc-card-text';
export interface UIStyleOptions {theme?: Partial<Record<UIThemeToken, string | number>>; css?: string}
/** Removes this installation's style element, root class and configured theme properties. */
export function installStyles(root: HTMLElement, options?: UIStyleOptions): () => void;

export interface UIPackProduct {name: string; lineId: string; artwork?: Schemas['PackArtwork']}
export interface UIPackOptions extends UILocalizationOptions {
  small?: boolean;
  lineName?: string;
  previewCards?: readonly (Node | string)[];
  side?: 'front' | 'back';
}
export interface UIPackView {node: HTMLDivElement; setSide(side: 'front' | 'back'): void; dispose(): void}
export function renderPack(product: UIPackProduct, options?: UIPackOptions): UIPackView;

/** Rendering also supports catalog previews without ownership fields. */
export interface UICardCopy {
  id?: string;
  cardId?: string;
  variantId?: string;
  lineId?: string;
  rarityId: string;
  serialNumber?: number | null;
  editionTotal?: number | null;
  ownerId?: string;
  openedBy?: string | null;
  openedAt?: string | null;
  openedByName?: string | null;
  metadata?: Record<string, unknown>;
  bindings?: Schemas['Copy']['bindings'];
  definition: {
    id?: string;
    name: string;
    description?: string;
    metadata?: Record<string, unknown>;
    stats?: Record<string, unknown>;
    tags?: readonly string[];
    appearance?: {background?: string};
    layers?: readonly {
      src: string;
      effect?: string;
      crop?: {x: number; y: number; width: number; height: number};
      opacity?: number;
      depth?: number;
      blend?: string;
    }[];
    back?: string;
    presentation?: Schemas['CardDefinitionView']['presentation'];
  };
  variant: {
    id?: string; finish?: string; effectMask?: string; back?: string;
    metadata?: Record<string, unknown>; stats?: Record<string, unknown>;
    presentation?: Schemas['CardVariantView']['presentation'];
  };
}
export interface UICardNode extends HTMLElement {dispose?(): void}
export type UICardOptions<C extends UICardCopy = UICardCopy> = {
  onSelect?(copy: C): void;
  interactive?: boolean;
  backRenderer?(copy: C): Node | string;
  effects?: boolean;
  presentationMode?: 'poster' | 'interactive';
  localization?: Localization;
}
export type UICardRenderer<C extends UICardCopy = UICardCopy> = (copy: C, options?: UICardOptions<C>) => UICardNode;
export function renderCard<C extends UICardCopy>(copy: C, options?: UICardOptions<NoInfer<C>>): UICardNode;
export function renderInspector<C extends InspectorCopy>(copy: C, options?: Omit<InspectorOptions<NoInfer<C>>, 'cardRenderer'> & {
  cardRenderer?: InspectorOptions<C>['cardRenderer'];
}): HTMLElement;
export type UITiltInspectorCopy = InspectorCopy & {bindings: NonNullable<InspectorCopy['bindings']>};
export interface UITiltInspectorOptions<C extends UITiltInspectorCopy> extends UILocalizationOptions {
  cardRenderer?: UICardRenderer<C>;
  metadataRenderer?(copy: C, options: {localization: Localization}): Node | string;
  backRenderer?(copy: C): Node | string;
  onClose?(event?: MouseEvent): unknown;
  labels?: {line?: string; rarity?: string};
}
export function renderTiltInspector<C extends UITiltInspectorCopy>(copy: C, options?: UITiltInspectorOptions<NoInfer<C>>): HTMLElement;

export interface UIAlbumModel<C extends UICardCopy = UICardCopy> {
  name?: string;
  layout?: AlbumLayout;
  cards: readonly {copy: C; placement?: {position?: number; data?: Record<string, unknown>}}[];
}
export interface UIAlbumNode extends HTMLDivElement {
  /** Present only for book layouts that supply artwork or pageSize. */
  setPage?(index: number): void;
  dispose(): void;
}
export interface UIView {node: Node | string; dispose?(): void; requestLeave?(proceed: () => void): unknown}
export type UIAlbumResult = (Node & {dispose?(): void}) | string | UIView;
export type UIAlbumOptions<C extends UICardCopy = UICardCopy> = {
  locale?: string;
  messages?: LocalizationMessages;
  localization?: Localization;
  cardRenderer?: UICardRenderer<C>;
  onSelect?(copy: C): void;
  layouts?: Record<string, UIAlbumLayout<C>>;
}
export type UIAlbumLayout<C extends UICardCopy = UICardCopy> = (model: UIAlbumModel<C>, options: {
  cardRenderer: UICardRenderer<C>;
  onSelect?: (copy: C) => void;
  localization: Localization;
}) => UIAlbumResult;
export function renderAlbum<C extends UICardCopy>(model: UIAlbumModel<C>, options?: Omit<UIAlbumOptions<NoInfer<C>>, 'layouts'> & {layouts?: undefined}): UIAlbumNode;
export function renderAlbum<C extends UICardCopy>(model: UIAlbumModel<C>, options: UIAlbumOptions<NoInfer<C>>): UIAlbumResult;

export interface UIOpenerViewContext {
  localization: Localization;
  onSelect?: (copy: Schemas['Copy']) => void;
  cardRenderer: UICardRenderer<Schemas['Copy']>;
  packArtwork?: (packId: string) => Schemas['PackArtwork'] | null | undefined;
}
export interface UIOpenerRetainedView {node: Node | string; update?(state: RevealState): void; dispose?(): void}
export type UIOpenerView = (state: RevealState, controller: RevealController, context: UIOpenerViewContext) => Node | string | UIOpenerRetainedView;
export interface UIOpenerOptions extends UILocalizationOptions {
  controller: RevealController;
  cardRenderer?: UICardRenderer<Schemas['Copy']>;
  view?: UIOpenerView;
  onSelect?: (copy: Schemas['Copy']) => void;
  packArtwork?: UIOpenerViewContext['packArtwork'];
}
/** Returns an unsubscribe/disposal callback, rather than a mounted view wrapper. */
export function mountOpener(root: HTMLElement, options: UIOpenerOptions): () => void;

export interface UIFrameworkModel {
  catalog: Awaited<ReturnType<Client['catalog']>>;
  me: Awaited<ReturnType<Client['me']>>;
  capabilities: Schemas['CapabilityAvailability'] | null;
  wallet: Awaited<ReturnType<Client['wallet']>>;
  packs: Awaited<ReturnType<Client['packs']>>;
  inventory: Awaited<ReturnType<Client['inventory']>>;
  albums: Awaited<ReturnType<Client['albums']>>;
  trades: Awaited<ReturnType<Client['trades']>>;
  availability: Schemas['Availability'] | null;
  pity: Operations['pityProgress']['response'];
  recoverable: Schemas['CommandIntent'][];
}
export interface UIAction {
  <T>(fn: () => T | PromiseLike<T>, options?: {refreshAfter?: boolean; message?: string | ((result: T) => string)}): Promise<T | undefined>;
}
export interface UIFrameworkSectionContext {
  client: Client;
  inspect(copy: InspectorCopy): void;
  inspectTogether(copies: readonly InspectorCopy[]): void;
  refresh(): Promise<void>;
  mutate: CommandRunner;
  action: UIAction;
  navigate(section: UIFrameworkSection, approved?: boolean): void;
  cardRenderer: UICardRenderer;
  localization: Localization;
}
export type UIFrameworkSectionView = (model: UIFrameworkModel, context: UIFrameworkSectionContext) => Node | string | UIView;
export type UIFrameworkSection = string | UIFrameworkSectionView;
export interface UIFrameworkPackView {
  node: Node | string;
  dispose?(): void;
  setPresentationInputs?(inputs: ProgramInputs): void;
}
export type UIFrameworkPackResult = (Node & {dispose?(): void; setPresentationInputs?(inputs: ProgramInputs): void}) | UIFrameworkPackView;
export interface UIFrameworkProduct extends UIPackProduct {id: string; slots?: Schemas['PackSlot'][]}
export type UIFrameworkPackRenderer = (product: UIFrameworkProduct, options: Omit<UIPackOptions, 'previewCards'> & {
  previewCards: HTMLElement[];
  localization: Localization;
  onSelect?: () => void;
}) => UIFrameworkPackResult;
export interface UIFrameworkViewContext extends UIFrameworkSectionContext {
  isActionBusy(): boolean;
  getPrincipal(): string | null;
  isCurrentModel(captured: UIFrameworkModel): boolean;
  albumRenderer: (model: UIAlbumModel, options: UIAlbumOptions) => UIAlbumResult;
  codeRevealRenderer?: CodeHistoryRevealRenderer;
  listingRenderer?: MarketplaceListingRenderer;
  packArt(product: UIFrameworkProduct, small?: boolean, onSelect?: () => void,
    onRendered?: (result: UIFrameworkPackResult) => void, ownDispose?: (cleanup: () => void) => void): Node | string;
  onPurchased(): void;
  layouts: Record<string, UIAlbumLayout>;
  state: Record<string, unknown>;
}
export interface UIFrameworkOptions extends Omit<UILocalizationOptions, 'localization'>, UIStyleOptions {
  client: Client;
  cardRenderer?: UICardRenderer;
  packRenderer?: UIFrameworkPackRenderer;
  albumRenderer?: UIFrameworkViewContext['albumRenderer'];
  inspectorRenderer?: (copy: InspectorCopy, options: InspectorOptions<InspectorCopy>) => Node | string;
  comparisonRenderer?: (copies: readonly InspectorCopy[], options: ComparisonOptions<InspectorCopy>) => Node | string;
  codeRevealRenderer?: CodeHistoryRevealRenderer;
  listingRenderer?: MarketplaceListingRenderer;
  views?: Record<string, (model: UIFrameworkModel, context: UIFrameworkViewContext) => Node | string | UIView>;
  viewLabels?: Record<string, string>;
  backRenderer?: (copy: UICardCopy) => Node | string;
  metadataRenderer?: InspectorOptions<InspectorCopy>['metadataRenderer'];
  openerView?: UIOpenerView;
  layouts?: Record<string, UIAlbumLayout>;
  participants?: readonly {id: string; name: string}[];
  navigation?: 'sections' | 'tabs';
  sections?: UIFrameworkSection[];
  shell?: ApplicationShellSource;
}
export interface UIFrameworkMounted extends ApplicationShellMounted {
  /** Resolves after the first model refresh; initial load failures reject. */
  ready: Promise<void>;
  refresh(): Promise<void>;
  inspect(copy: InspectorCopy): void;
  inspectTogether(copies: readonly InspectorCopy[]): void;
  dispose(): void;
}
export function mountFramework(root: HTMLElement, options: UIFrameworkOptions): UIFrameworkMounted;
