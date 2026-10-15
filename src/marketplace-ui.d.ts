import type {Client, CommandRunner} from './client.js';
import type {Schemas} from './wire-types.js';
import type {Localization, LocalizationMessages} from './localization.js';
import type {MarketplaceModel, MarketplaceSession} from './marketplace-session.js';

export interface MarketplaceLocalizationOptions {
  locale?: string; messages?: LocalizationMessages; localization?: Localization;
}
export interface MarketplaceUIView<R = void> {
  node: HTMLElement;
  ready: Promise<R>;
  dispose(): void;
}
export interface FulfillmentsModel {me: {role?: string; permissions?: string[]}}
export interface FulfillmentsOptions extends MarketplaceLocalizationOptions {
  client: Pick<Client, 'fulfillments' | 'actionJobs' | 'retryAction' | 'requestKey'>;
}
export function renderFulfillments(model: FulfillmentsModel, options: FulfillmentsOptions): MarketplaceUIView;
export interface TradingControlsOptions extends MarketplaceLocalizationOptions {
  client: Pick<Client, 'tradingPolicy' | 'configureTrading' | 'setCardTransferLock' | 'requestKey'>;
}
/** The model argument is currently unused. */
export function renderTradingControls(model: unknown, options: TradingControlsOptions): MarketplaceUIView;

export interface MarketplaceUIModel extends Omit<MarketplaceModel, 'inventory' | 'packs' | 'catalog'> {
  catalog: MarketplaceModel['catalog'] & {currencies: {id: string; name: string}[]};
  inventory: Schemas['InventoryCopy'][];
  packs: Schemas['PackView'][];
}
export type MarketplaceUIClient = Pick<Client,
  'listings' | 'orders' | 'shops' | 'commerceSettings' | 'configureCommerce' | 'quoteListing' |
  'quoteMintPackStock' | 'stockAllocationStatus' | 'acknowledgeAllocation' | 'raffleStatus' | 'requestKey'> &
  Partial<Pick<Client, 'principal'>>;
export type MarketplacePurchaseTarget = Pick<Schemas['ListingRecord'], 'id'> & Partial<Pick<Schemas['ListingRecord'], 'kind'>>;
export type MarketplaceListingRenderer = (listing: Schemas['ListingRecord'], options: {
  purchase(listing: MarketplacePurchaseTarget, options?: {newPurchase?: boolean}): ReturnType<MarketplaceSession['purchase']>;
  defaultRenderer(listing: Schemas['ListingRecord']): HTMLElement;
  client: MarketplaceUIClient | undefined;
  localization: Localization;
}) => (HTMLElement & {dispose?(): void}) | {node: HTMLElement; dispose?(): void};
export interface MarketplaceRenderingContext {
  client?: MarketplaceUIClient;
  listingRenderer?: MarketplaceListingRenderer;
}
export interface MarketplaceHostOptions extends MarketplaceLocalizationOptions {
  refresh?(): Promise<unknown>;
  storage?: Storage;
  getPrincipal?(): string | null;
  isCurrentModel?(model: MarketplaceUIModel): boolean;
  isActionBusy?(): boolean;
  cardRenderer?(copy: Schemas['Copy'], options: {interactive: false; localization: Localization}):
    (HTMLElement & {dispose?(): void}) | {node: HTMLElement; dispose?(): void};
  listingRenderer?: MarketplaceListingRenderer;
}
/** A checked command runner can be supplied; otherwise the view creates one from the full client. */
export type MarketplaceUIContext = MarketplaceHostOptions & (
  {client: Client; mutate?: CommandRunner} | {client: MarketplaceUIClient; mutate: CommandRunner}
);
export function renderMarketplace(model: MarketplaceUIModel, context: MarketplaceUIContext, sharedSession?: null): MarketplaceUIView;
/** Disposing this view preserves the supplied session; ready passes through its readiness result. */
export function renderMarketplace<S extends MarketplaceSession>(model: {catalog: {currencies: {id: string; name: string}[]}}, context: MarketplaceRenderingContext, sharedSession: S): MarketplaceUIView<Awaited<S['ready']>>;
