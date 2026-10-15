import type {Client, CommandInput, CommandResult} from './client.js';
import type {Localization, LocalizationMessages} from './localization.js';
import type {CardPolicyAdminOptions} from './card-policy-ui.js';
import type {CollectionCatalog, CollectionVariant, CollectionPreviewCopy, CollectionCardOptions} from './collection-ui.js';
import type {ProgramPackProduct} from './presentation/program-pack-view.js';

export interface StudioCatalog extends Pick<CollectionCatalog, 'version' | 'lines' | 'rarities' | 'cards'> {
  currencies: {id: string; name: string}[];
  variants: (CollectionVariant & {name?: string; enabled?: boolean})[];
  products: ProgramPackProduct[];
}
export interface StudioModel {
  me: {userId: string; role?: string; permissions?: string[]};
  catalog: StudioCatalog;
}
/** Includes policy/library operations reached through the embedded visual studio. */
export type StudioClient = Pick<Client, 'operatorCatalog' | 'previewImport' | 'commitImport' | 'effectiveCardPolicy'> & CardPolicyAdminOptions['client'];
export interface StudioContext {
  client: StudioClient;
  cardRenderer(copy: CollectionPreviewCopy, options: CollectionCardOptions<CollectionPreviewCopy>): HTMLElement;
  inspect(copy: CollectionPreviewCopy): void;
  action(fn: () => unknown | PromiseLike<unknown>, options: {message: string; refreshAfter?: boolean}): unknown;
  mutate(command: 'commitImport', input: CommandInput<'commitImport'>): Promise<CommandResult<'commitImport'>>;
  locale?: string;
  messages?: LocalizationMessages;
  localization?: Localization;
}
export interface StudioView {
  node: HTMLElement;
  /** Invalidates pending catalog previews and disposes the embedded visual studio. */
  dispose(): void;
}
/** Without catalog.read access returns the explanatory element directly; neither result exposes ready. */
export function renderStudio(model: StudioModel, context: StudioContext): HTMLElement | StudioView;
