import type {Client, CommandInput, CommandResult, CommandRunner, CommandStorage} from './client.js';
import type {Localization, LocalizationMessages} from './localization.js';
import type {Schemas} from './wire-types.js';
import type {MarketplaceStockKind} from './presentation/marketplace-display.js';

export type MarketplaceCopy = Pick<Schemas['Copy'], 'id'> & {
  definition: Pick<Schemas['CardDefinitionView'], 'name'> & Partial<Schemas['CardDefinitionView']>;
  lockedBy?: string | null;
  [field: string]: unknown;
};
export interface MarketplacePack {
  id: string;
  product: {name?: string; [field: string]: unknown};
  openedAt?: string | null;
  lockedBy?: string | null;
  [field: string]: unknown;
}
export type MarketplaceVariant = Pick<Schemas['CardVariantView'], 'id' | 'cardId'> & Partial<Schemas['CardVariantView']>;
export interface MarketplaceProduct {
  id: string;
  name?: string;
  allocationStrategy?: {algorithm: string; version: number; deckScope: string; [field: string]: unknown};
  duplicatePolicy?: {scope: string; fallback: string};
  [field: string]: unknown;
}
export interface MarketplaceModel {
  me: {userId: string; role?: string; permissions?: string[]; adminStatus?: {restrictions?: {sellingBlocked?: boolean}}};
  catalog: {
    currencies: readonly {id: string; [field: string]: unknown}[];
    cards: readonly {id: string; name?: string; [field: string]: unknown}[];
    variants: readonly MarketplaceVariant[];
    products: readonly MarketplaceProduct[];
    [field: string]: unknown;
  };
  inventory?: readonly MarketplaceCopy[];
  packs?: readonly MarketplacePack[];
  capabilities?: {available: Record<string, boolean>};
}
export type MarketplaceClient = Pick<Client,
  'listings' | 'orders' | 'shops' | 'commerceSettings' | 'configureCommerce' | 'quoteListing' |
  'quoteMintPackStock' | 'stockAllocationStatus' | 'acknowledgeAllocation' | 'raffleStatus' | 'requestKey'> & Partial<Client>;
export type MarketplaceCommand = 'createShop' | 'createListing' | 'buyListing' | 'enterRaffle' | 'cancelListing';
export type MarketplaceCommandClient = MarketplaceClient & Pick<Client, MarketplaceCommand>;
export type MarketplaceRecoveryClient = MarketplaceClient & Pick<Client,
  'registerCommandIntent' | 'executeCommandIntent' | 'acknowledgeCommandIntent' | 'commandIntents'>;
export type MarketplaceCommandCall = {
  <C extends MarketplaceCommand>(command: C, input: CommandInput<C>): CommandResult<C> | PromiseLike<CommandResult<C>>;
};
export type MarketplaceCommands = MarketplaceCommandCall & {
  pending?(command: MarketplaceCommand): ReturnType<CommandRunner['pending']> | undefined;
  recover?: MarketplaceCommandCall;
  beginNew?: MarketplaceCommandCall;
  confirmFailed?<C extends MarketplaceCommand>(command: C, input: CommandInput<C>): boolean | PromiseLike<boolean>;
};
export type MarketplaceListingTarget = Pick<Schemas['ListingRecord'], 'id'> &
  Partial<Pick<Schemas['ListingRecord'], 'kind' | 'title' | 'raffle' | 'phase' | 'mine' | 'status'>>;
export type MarketplaceListingRenderer = (listing: Schemas['ListingRecord'], options: {
  purchase(listing: MarketplaceListingTarget, options?: {newPurchase?: boolean}): Promise<void>;
  defaultRenderer(listing: Schemas['ListingRecord']): HTMLElement;
  client: MarketplaceClient | undefined;
  localization: Localization;
}) => (HTMLElement & {dispose?(): void}) | {node: HTMLElement; dispose?(): void};
export interface MarketplaceHostContext<M extends MarketplaceModel = MarketplaceModel> {
  refresh?(): unknown;
  storage?: CommandStorage;
  locale?: string;
  messages?: LocalizationMessages;
  localization?: Localization;
  getPrincipal?(): string | null;
  isCurrentModel?(model: M): boolean;
  isActionBusy?(): boolean;
  cardRenderer?(copy: Schemas['Copy'], options: {interactive: false; localization: Localization}):
    (HTMLElement & {dispose?(): void}) | {node: HTMLElement; dispose?(): void};
  listingRenderer?: MarketplaceListingRenderer;
}
/** Command execution needs host callbacks, direct write methods, or the complete recovery transport. */
export type MarketplaceContext<M extends MarketplaceModel = MarketplaceModel> = MarketplaceHostContext<M> & (
  {client: MarketplaceClient; mutate: MarketplaceCommands} |
  {client: MarketplaceCommandClient | MarketplaceRecoveryClient; mutate?: MarketplaceCommands}
);
export interface MarketplaceSessionDraft {
  shop: string; title: string; currency: string; amount: string;
  kind: '' | MarketplaceStockKind;
  target: string; quantity: string; handler: string; params: string;
  preview: string; starts: string; ends: string; raffle: string; shopName: string;
  shopKind: 'player' | 'admin';
}
export type MarketplaceRaffleState = Schemas['RaffleStatus'] | {entered: true};
export interface MarketplaceState {
  listings: Schemas['ListingRecord'][];
  listingNext: string | null;
  listingTotal: number;
  orders: Schemas['OrderRecord'][];
  orderNext: string | null;
  orderTotal: number;
  ordersLoaded: boolean;
  shops: Schemas['ShopView'][];
  settings: Schemas['CommerceSettingsView'] | null;
  shopNext: string | null;
  raffles: Map<string, MarketplaceRaffleState>;
  status: string;
  /** Error codes originate in host callbacks and are not validated by the session. */
  diagnostic: {code: unknown} | null;
  error: boolean;
  stockNote: string;
  attemptNote: string;
  draft: MarketplaceSessionDraft;
}
export type MarketplaceTarget<M extends MarketplaceModel = MarketplaceModel> =
  | {id: string; name: string; copy: NonNullable<M['inventory']>[number]}
  | {id: string; name: string | undefined; pack: NonNullable<M['packs']>[number]}
  | {id: string; name: string; variant: M['catalog']['variants'][number]}
  | {id: string; name: string | undefined; product: M['catalog']['products'][number]};
/** Draft construction precedes validation; an empty kind and arbitrary parsed JSON remain possible. */
export interface MarketplaceListingInput {
  shopId: string;
  title: string;
  price: Schemas['Money'];
  items:
    | {kind: 'copies' | 'packs'; ids: string[]}
    | {kind: 'action'; handler: string; params: unknown; quantity: number}
    | {kind: 'mint-card'; variantId: string; quantity: number}
    | {kind: '' | 'mint-pack'; productId: string; quantity: number};
  previewAt?: string;
  startsAt?: string;
  endsAt?: string;
  raffle?: unknown;
}
export interface MarketplaceStockControls {
  tickets: boolean; quote: boolean; inspect: boolean; ack: boolean; retry: boolean;
  create: boolean; reviewed: boolean; blocked: boolean;
}
export type MarketplacePendingPurchase = ReturnType<CommandRunner['pending']> | undefined;
export interface MarketplaceSession<M extends MarketplaceModel = MarketplaceModel, C extends MarketplaceContext<M> = MarketplaceContext<M>> {
  model: M;
  context: C;
  localization: Localization;
  state: MarketplaceState;
  admin: boolean | undefined;
  ready: Promise<void>;
  readonly busy: boolean;
  readonly formVersion: number;
  /** Stored journal fields beyond key/_confirmed have not been validated here. */
  readonly originalPurchase: MarketplacePendingPurchase;
  readonly canCreateShop: boolean | undefined;
  readonly canList: boolean;
  current(): boolean;
  enabled(name: string): boolean;
  workflow(kind?: string): 'packs' | 'directSales' | 'resale';
  kinds(): MarketplaceStockKind[];
  targets(): MarketplaceTarget<M>[];
  stockDeckVersion(): 0 | 1 | 2 | 3 | 4;
  ticketStock(): boolean;
  stockControls(): MarketplaceStockControls;
  disclosure(): string;
  listingInput(): MarketplaceListingInput;
  edit(key: string, value: string): void;
  subscribe(listener: () => void): () => boolean;
  publish(): void;
  closeReview(): void;
  /** Stale/busy sessions and caught errors resolve undefined. */
  action<T>(fn: () => T | PromiseLike<T>): Promise<Awaited<T> | undefined>;
  load(reset?: boolean): Promise<void>;
  loadOrders(): Promise<void>;
  loadShops(): Promise<void>;
  compose(): Promise<void>;
  applySettings(revision: number, json: string): Promise<void>;
  createShop(): Promise<void>;
  createListing(): Promise<void>;
  quoteStock(): Promise<void>;
  inspectStock(): Promise<void>;
  acknowledgeStock(): Promise<void>;
  retryListing(): Promise<void>;
  raffleStatus(listing: MarketplaceListingTarget): Promise<void>;
  enterRaffle(listing: MarketplaceListingTarget): Promise<void>;
  cancel(listing: MarketplaceListingTarget): Promise<void>;
  purchase(root: HTMLElement, listing: MarketplaceListingTarget, options?: {newPurchase?: boolean}): Promise<void>;
  /** Purchase/recover return their async setup; other review kinds return synchronously. */
  review(root: HTMLElement, kind: string, listing?: MarketplaceListingTarget): void | Promise<void>;
  actionReview(root: HTMLElement): void;
  settingsReview(root: HTMLElement): void;
  dispose(): void;
}
export function createMarketplaceSession<M extends MarketplaceModel, C extends MarketplaceContext<M>>(model: M, context: C): MarketplaceSession<M, C>;
export function marketplaceEnum(localization: Localization, group: string, value: string): string;
export function marketplaceRaffleText(localization: Localization, status?: Partial<Pick<Schemas['RaffleStatus'], 'orderId' | 'winner' | 'claimUntil' | 'drawnAt' | 'entered'>> | null): string;
