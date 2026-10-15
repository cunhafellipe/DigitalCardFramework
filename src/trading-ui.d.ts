import type {Client} from './client.js';
import type {TradingContext, TradingModel, TradingSession} from './trading-session.js';
import type {Schemas} from './wire-types.js';

export interface TradingUIModel extends TradingModel {
  catalog: TradingModel['catalog'] & {currencies: {id: string; name: string; tradable?: boolean}[]};
  trades: Schemas['Trade'][];
}
export interface TradingUIRenderingContext<M extends TradingUIModel = TradingUIModel> extends TradingContext<M> {
  cardRenderer: NonNullable<TradingContext<M>['cardRenderer']>;
  inspect: NonNullable<TradingContext<M>['inspect']>;
}
/** Native trading owns a session when no shared session is supplied. */
export interface TradingUIContext<M extends TradingUIModel = TradingUIModel> extends TradingUIRenderingContext<M> {
  client: Pick<Client, 'directory' | 'tradeInventory'> & Pick<NonNullable<TradingContext<M>['client']>, 'reviewTransfer' | 'principal'>;
  action: NonNullable<TradingContext<M>['action']>;
  mutate: NonNullable<TradingContext<M>['mutate']>;
}
export type TradingUISharedSession = Pick<TradingSession,
  'draft' | 'state' | 'counter' | 'directory' | 'busy' | 'partnerPrivate' |
  'subscribe' | 'loadDirectory' | 'start' | 'review'>;
export interface TradingView {
  node: HTMLElement;
  /** Releases rendered cards and subscriptions; a supplied shared session remains host-owned. */
  dispose(): void;
}
export function renderTrading<M extends TradingUIModel>(model: M, context: TradingUIContext<M>, sharedSession?: null): TradingView;
export function renderTrading<M extends TradingUIModel>(model: M, context: TradingUIRenderingContext<M>, sharedSession: TradingUISharedSession): TradingView;
