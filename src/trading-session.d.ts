import type {Client, CommandInput, CommandResult} from './client.js';
import type {TradeDraft, TradeDraftCopy, TradeDraftOptions, TradeDraftState} from './trade-client.js';
import type {Localization, LocalizationMessages} from './localization.js';
import type {Schemas} from './wire-types.js';

export interface TradingModel {
  me: {userId: string};
  catalog: TradeDraftOptions['catalog'] & {currencies: {id: string; name?: string; tradable?: boolean}[]};
}
export type TradingReviewCopy = TradeDraftCopy | Schemas['Copy'];
export type TradingOfferAction = 'accept' | 'counter' | 'cancel' | 'decline';
export type TradingMutation = 'proposeTrade' | 'counterTrade' | 'acceptTrade' | 'cancelTrade';
export interface TradingContext<M extends TradingModel = TradingModel> {
  client?: TradeDraftOptions['client'] & Pick<Client, 'directory'> & {principal?(): string | null};
  localization?: Localization;
  locale?: string;
  messages?: LocalizationMessages;
  storage?: TradeDraftOptions['storage'];
  getPrincipal?(): string | null;
  isCurrentModel?(model: M): boolean;
  isActionBusy?(): boolean;
  action?(fn: () => unknown | PromiseLike<unknown>, options: {message: string}): unknown;
  mutate?<C extends TradingMutation>(command: C, input: CommandInput<C>): Promise<CommandResult<C>>;
  cardRenderer?(copy: TradingReviewCopy, options: {interactive: false; onSelect(copy: TradingReviewCopy): void; localization: Localization}):
    (HTMLElement & {dispose?(): void}) | {node: HTMLElement; dispose?(): void};
  inspect?(copy: TradingReviewCopy): void;
}
export type TradingActionResult<C> = C extends {action: (...args: never[]) => infer R} ? Awaited<R> : unknown;
export interface TradingSession<M extends TradingModel = TradingModel, C extends TradingContext<M> = TradingContext<M>> {
  model: M;
  context: C;
  localization: Localization;
  enabled: boolean;
  readonly draft: TradeDraft | undefined;
  readonly state: TradeDraftState | undefined;
  readonly counter: Schemas['Trade'] | null;
  readonly directory: Schemas['DirectoryEntry'][];
  readonly busy: boolean;
  readonly generation: number;
  readonly partnerPrivate: boolean;
  error?: string | null;
  diagnostic?: {code: string | undefined} | null;
  current(): boolean;
  /** Calls the listener immediately; the returned function removes it. */
  subscribe(listener: () => void): () => boolean;
  closeReview(): void;
  eligible(copy: Pick<TradeDraftCopy, 'tradable' | 'remoteReviewRequired' | 'lockedBy' | 'untradableReason'>): boolean;
  loadDirectory(search?: string): Promise<void>;
  start(recipient?: string | null, trade?: Schemas['Trade'] | null): void;
  offerActions(trade: Schemas['Trade']): Record<TradingOfferAction, boolean>;
  /** Resolves the host action's result, or undefined when the session is stale or busy. */
  run(fn: () => unknown | PromiseLike<unknown>, message: string): Promise<TradingActionResult<C> | undefined>;
  review(root: HTMLElement, trade?: Schemas['Trade'] | null, requestedAction?: TradingOfferAction | null): void;
  dispose(): void;
}
/** Enabled trading needs client callbacks; review and run additionally need their host UI callbacks. */
export function createTradingSession<M extends TradingModel, C extends TradingContext<M> = TradingContext<M>>(model: M, context?: C): TradingSession<M, C>;
/** Unknown status strings are returned unchanged. */
export function tradeStatusText(trade: {status: string}, localization: Localization): string;
