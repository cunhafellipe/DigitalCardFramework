import type {Client} from './client.js';
import type {Schemas} from './wire-types.js';
import type {Localization, LocalizationMessages} from './localization.js';
import type {MarketplaceModel, MarketplaceSession, MarketplaceClient, MarketplaceListingRenderer as SessionListingRenderer, MarketplaceListingTarget, MarketplaceContext} from './marketplace-session.js';

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
export type MarketplaceUIClient = MarketplaceClient;
export type MarketplacePurchaseTarget = MarketplaceListingTarget;
export type MarketplaceListingRenderer = SessionListingRenderer;
export interface MarketplaceRenderingContext {
  client?: MarketplaceUIClient;
  listingRenderer?: MarketplaceListingRenderer;
}
export interface MarketplaceHostOptions extends Omit<MarketplaceContext<MarketplaceUIModel>, 'client' | 'mutate'> {}
/** Command execution uses a host runner, direct write methods, or the complete recovery transport. */
export type MarketplaceUIContext = MarketplaceContext<MarketplaceUIModel>;
export function renderMarketplace(model: MarketplaceUIModel, context: MarketplaceUIContext, sharedSession?: null): MarketplaceUIView;
/** Disposing this view preserves the supplied session; ready passes through its readiness result. */
export function renderMarketplace<S extends MarketplaceSession>(model: {catalog: {currencies: {id: string; name: string}[]}}, context: MarketplaceRenderingContext, sharedSession: S): MarketplaceUIView<Awaited<S['ready']>>;
