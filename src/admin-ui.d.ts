import type {Client} from './client.js';
import type {AdminController, createAdminController} from './admin-client.js';
import type {Localization, LocalizationMessages} from './localization.js';

export type AdminPanelStorage = Parameters<typeof createAdminController>[0]['storage'];
export interface AdminUIState {
  tab?: 'overview' | 'lines' | 'people' | 'website' | 'activity';
  advanced?: boolean;
  lineId?: string | null;
  productId?: string | null;
  userId?: string | null;
  personAction?: 'give' | 'remove' | null;
  peopleSearch?: string;
  lineSearch?: string;
  [field: string]: unknown;
}
export interface AdminPanelOptions {
  namespace?: string;
  storage?: AdminPanelStorage;
  uiState?: AdminUIState;
  navigate?: (destination: 'tradingControls') => unknown;
  locale?: string;
  messages?: LocalizationMessages;
  localization?: Localization;
}
export interface MountedAdminPanel<C extends AdminController | undefined = AdminController | undefined> {
  node: HTMLElement;
  /** Initial loading failures are displayed in the panel and handled by this promise. */
  ready: Promise<void>;
  readonly controller: C;
  /** May defer the callback until an unsaved draft is discarded; callback results are ignored. */
  requestLeave(next: () => unknown): void;
  refresh(): Promise<void> | (undefined extends C ? undefined : never);
  /** Preserves UI state, removes this panel, and disposes only an internally created controller. */
  dispose(): void;
}
export function mountAdminPanel<C extends AdminController>(root: HTMLElement, options: AdminPanelOptions & {controller: C; client?: Client}): MountedAdminPanel<C>;
export function mountAdminPanel(root: HTMLElement, options: AdminPanelOptions & {client: Client; controller?: null}): MountedAdminPanel;

export interface RenderAdminPanelOptions extends Pick<AdminPanelOptions, 'navigate' | 'locale' | 'messages' | 'localization'> {
  client: Client;
  state?: {admin?: AdminUIState | null};
}
export interface RenderedAdminPanel {
  node: HTMLElement;
  ready: Promise<void>;
  controller(): AdminController | undefined;
  requestLeave(next: () => unknown): void;
  dispose(): void;
}
/** Permission failures remain panel state; the renderer always returns this lifecycle handle. */
export function renderAdminPanel(model: {me: {userId: string}}, options: RenderAdminPanelOptions): RenderedAdminPanel;
