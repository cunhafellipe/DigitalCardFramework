import type {Client, CommandInput, CommandResult} from './client.js';
import type {Schemas} from './wire-types.js';
import type {CardBehavior} from './card-types.js';
import type {Localization, LocalizationMessages} from './localization.js';
import type {ProgramAlbumModel} from './presentation/program-album-view.js';
import type {ProgramCardCopy, ProgramCardOptions} from './presentation/program-card-view.js';

export type CollectionDefinition = Pick<Schemas['CardDefinitionView'], 'id' | 'lineId' | 'name'> &
  Partial<Pick<Schemas['CardDefinitionView'], 'type' | 'tags' | 'stats' | 'metadata'>> & {behavior?: Partial<CardBehavior>};
export type CollectionVariant = Pick<Schemas['CardVariantView'], 'id' | 'cardId' | 'rarityId'> &
  {finish?: string; supplyLimit?: number; metadata?: Record<string, unknown>};
export interface CollectionPreviewCopy extends ProgramCardCopy {
  id: string; cardId: string; lineId: string;
  definition: CollectionDefinition;
  variant: Partial<CollectionVariant>;
  bindings: Record<string, never>; metadata: Record<string, never>;
  serialNumber: null; editionTotal: number | null;
}
export interface CollectionCatalog {
  version: number;
  features: {tradeUps?: boolean; cardTrading?: boolean};
  lines: {id: string; name: string}[];
  rarities: {id: string; name: string; rank?: number}[];
  cards: CollectionDefinition[];
  variants: CollectionVariant[];
  recipes?: {id: string; name: string}[];
}
export interface CollectionModel<C extends Schemas['InventoryCopy'] = Schemas['InventoryCopy']> {
  catalog: CollectionCatalog;
  inventory: C[];
  me: {preferences?: Pick<Schemas['Preferences'], 'favoriteCopyIds' | 'wishlistCardIds'>};
}
export interface CollectionLocalization {
  locale?: string; messages?: LocalizationMessages; localization?: Localization;
}
export interface CollectionCardOptions<C extends ProgramCardCopy> extends ProgramCardOptions<C> {
  onSelect(copy: C): void;
  localization: Localization;
}
export interface CollectionContext<C extends Schemas['InventoryCopy'] = Schemas['InventoryCopy']> extends CollectionLocalization {
  cardRenderer(copy: C | CollectionPreviewCopy, options: CollectionCardOptions<C | CollectionPreviewCopy>): HTMLElement;
  inspect(copy: C | CollectionPreviewCopy): void;
  inspectTogether(copies: C[]): void;
  action(fn: () => unknown | PromiseLike<unknown>, options: {message: string}): unknown;
  mutate<K extends 'tradeUp' | 'preferences'>(command: K, input: CommandInput<K>): Promise<CommandResult<K>>;
}
/** Returns the collection element directly, without a disposal wrapper. */
export function renderCollection<C extends Schemas['InventoryCopy']>(model: CollectionModel<C>, context: CollectionContext<NoInfer<C>>): HTMLElement;

export interface AlbumsModel<C extends Schemas['Copy'] = Schemas['Copy']> {
  me: {userId: string; role?: string; permissions?: string[]};
  catalog: {features: {publicAlbums?: boolean}};
  inventory: C[];
  albums: Schemas['AlbumRecord'][];
}
export interface AlbumPreviewOptions<C extends Schemas['Copy']> {
  cardRenderer(copy: C | Schemas['Copy'], options?: ProgramCardOptions<C | Schemas['Copy']>): HTMLElement;
  onSelect(copy: C | Schemas['Copy']): void;
  layouts?: AlbumLayouts<C>;
  localization: Localization;
}
export interface AlbumPreviewModel<C extends Schemas['Copy'] = Schemas['Copy']> extends ProgramAlbumModel<C | Schemas['Copy']>,
  Partial<Pick<Schemas['AlbumView'], 'id' | 'ownerId' | 'ownerName' | 'visibility' | 'version' | 'updatedAt'>> {
  name: string;
  layout: Schemas['AlbumLayout'] & {id?: string; columns?: number; gap?: number};
}
export type AlbumPreviewRenderer<C extends Schemas['Copy'] = Schemas['Copy']> = (
  model: AlbumPreviewModel<C>, options: AlbumPreviewOptions<C>,
) => (HTMLElement & {dispose?(): void}) | {node: HTMLElement; dispose?(): void};
export type AlbumLayouts<C extends Schemas['Copy'] = Schemas['Copy']> = Record<string, AlbumPreviewRenderer<C>>;
export interface AlbumsContext<C extends Schemas['Copy'] = Schemas['Copy']> extends CollectionLocalization {
  client: Pick<Client, 'publicAlbums' | 'viewAlbum'>;
  cardRenderer(copy: C | Schemas['Copy'], options?: ProgramCardOptions<C | Schemas['Copy']>): HTMLElement;
  albumRenderer: AlbumPreviewRenderer<C>;
  layouts?: AlbumLayouts<C>;
  inspect(copy: C | Schemas['Copy']): void;
  action(fn: () => unknown | PromiseLike<unknown>, options: {message: string}): unknown;
  mutate(command: 'saveAlbum', input: CommandInput<'saveAlbum'>): Promise<CommandResult<'saveAlbum'>>;
  state?: {selectedAlbumId?: string | null};
}
export interface AlbumsView {
  node: HTMLElement;
  /** Closes the artwork editor and disposes the current preview. */
  dispose(): void;
}
export function renderAlbums<C extends Schemas['Copy']>(model: AlbumsModel<C>, context: AlbumsContext<NoInfer<C>>): AlbumsView;
