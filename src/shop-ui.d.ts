import type {Client, CommandInput, CommandResult, CommandRunner} from './client.js';
import type {Schemas} from './wire-types.js';
import type {Localization} from './localization.js';
import type {ProgramPackProduct} from './presentation/program-pack-view.js';
import type {ProgramShopModel} from './presentation/program-shop-view.js';

export interface ShopProduct extends ProgramPackProduct {
  enabled?: boolean;
  price: Schemas['Money'];
  maxQuantity: number;
  slots: Schemas['PackSlot'][];
  duplicatePolicy: {scope: 'none' | 'pack' | 'inventory'; fallback: 'allow' | 'reject'};
  pity?: {rarityId: string; after: number};
  availableFrom?: string;
  availableUntil?: string;
  allocationStrategy?: {algorithm: string; version: number; deckScope: string; [field: string]: unknown};
}
export interface ShopCatalog<P extends ShopProduct = ShopProduct> {
  currencies: {id: string; name: string}[];
  lines: {id: string; name: string}[];
  rarities: {id: string; name: string}[];
  cards: {id: string; name: string}[];
  variants: {id: string; cardId: string; rarityId: string}[];
  products: P[];
}
export interface ShopModel<P extends ShopProduct = ShopProduct> extends Pick<ProgramShopModel, 'me' | 'wallet' | 'pity' | 'availability'> {
  catalog: ShopCatalog<P>;
}
export interface ShopInformationModel {
  catalog: Pick<ShopCatalog, 'rarities' | 'cards' | 'variants'>;
  pity: Record<string, number>;
  availability?: ShopModel['availability'];
}
export interface ShopProductInformation {
  deckVersion: 0 | 1 | 2 | 3 | 4;
  ticketDeck: boolean;
  count: number;
  cardsNote: string; pityNote: string; duplicateNote: string; windowNote: string; explanation: string; ratesSummary: string;
  ratesGroups: {slot: number; count: number; label: string; rows: {
    weight: number; totalWeight: number; remaining: number | null; label: string; publicLabel: string; value: string;
  }[]}[];
}
export type ShopInformationProduct = Pick<ShopProduct, 'id' | 'slots' | 'duplicatePolicy' | 'pity' | 'availableFrom' | 'availableUntil' | 'allocationStrategy'>;
export function shopProductInformation(model: ShopInformationModel, product: ShopInformationProduct, localization?: Localization): ShopProductInformation;
export type ShopCommands = Pick<CommandRunner, 'pending' | 'recover' | 'beginNew'> & {
  (command: 'purchase', input: CommandInput<'purchase'>): Promise<CommandResult<'purchase'>>;
  confirmFailed?: CommandRunner['confirmFailed'];
};
export interface ShopContext<M extends ShopModel = ShopModel> {
  localization?: Localization;
  client: Pick<Client, 'quote'> & Partial<Pick<Client, 'principal' | 'allocationStatus' | 'acknowledgeAllocation'>>;
  mutate: ShopCommands;
  action<T>(fn: () => T | PromiseLike<T>, options: {refreshAfter?: boolean; message: string | ((result: T) => string)}): unknown;
  refresh(): unknown | PromiseLike<unknown>;
  getPrincipal?(): string | null;
  isCurrentModel?(model: M): boolean;
  onPurchased?(): void;
  packArt?(product: M['catalog']['products'][number], small: boolean, onSelect: () => void, preview: undefined, registerDispose: (cleanup: () => void) => void): Node | string | null | undefined;
}
export interface ShopView {
  node: HTMLElement;
  /** Runs registered artwork cleanup and removes the view element. */
  dispose(): void;
}
export function renderShop<M extends ShopModel>(model: M, context: ShopContext<NoInfer<M>>, options?: {productId?: string; quantity?: number; forceReview?: boolean}): ShopView;
