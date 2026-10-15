import type {Client, CommandInput, CommandResult} from './client.js';
import type {Schemas} from './wire-types.js';

export interface ActivityModel {
  me: {preferences?: Pick<Schemas['Preferences'], 'inventoryVisibility' | 'blockedUserIds'>};
  catalog: {currencies: readonly {id: string; name?: string}[]};
}
export type ActivityCommand = 'preferences' | 'readNotifications' | 'consumeBinding';
export interface ActivityContext {
  client: Pick<Client, 'notifications' | 'history' | 'bindings' | 'directory'>;
  action(fn: () => unknown | PromiseLike<unknown>, options: {message: string}): unknown;
  mutate<C extends ActivityCommand>(command: C, input: CommandInput<C>): Promise<CommandResult<C>>;
}
export interface ActivityView {
  node: HTMLElement;
  /** Stops updates from the pending activity load. */
  dispose(): void;
}
/** Starts loading immediately; the returned view has no separate readiness promise. */
export function renderActivity(model: ActivityModel, context: ActivityContext): ActivityView;
