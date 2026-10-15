/// <reference types="node" />
import type {IncomingMessage, ServerResponse} from 'node:http';

export interface PresentationHttpIdentity {
  userId: string;
  disabled?: boolean;
}
export type PresentationRouteActor<Identity extends PresentationHttpIdentity> = Omit<Identity, 'id'> & {id: string};
/** Store methods used by the HTTP routes. The host owns the store's lifecycle. */
export interface PresentationHttpStore<Actor> {
  checkAccess(actor: Actor, action: 'import'): unknown | Promise<unknown>;
  import(actor: Actor, bytes: Uint8Array, options: {idempotencyKey: string | null}): unknown | Promise<unknown>;
  get(actor: Actor, id: string): unknown | Promise<unknown>;
  publish(actor: Actor, id: string): unknown | Promise<unknown>;
  cancel(actor: Actor, id: string): unknown | Promise<unknown>;
  file(digest: string, relative: string): {bytes: Uint8Array; mediaType: string} | Promise<{bytes: Uint8Array; mediaType: string}>;
  descriptor(digest: string): unknown | Promise<unknown>;
}
export interface PresentationHandlerOptions<Identity extends PresentationHttpIdentity = PresentationHttpIdentity> {
  store: PresentationHttpStore<PresentationRouteActor<Identity>>;
  resolveIdentity(request: IncomingMessage): Identity | null | undefined | Promise<Identity | null | undefined>;
  /** Exact URL origin used to enforce mutation requests. */
  allowedOrigin: string;
  /** Evaluated synchronously before the request body is read. */
  rateLimit?(input: {actor: Identity; request: IncomingMessage; mutation: boolean}): boolean;
  prefix?: string;
  maxUploadBytes?: number;
}
/** False leaves unmatched routes untouched; true means the response has ended. */
export type PresentationHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
export declare function createPresentationHandler<Identity extends PresentationHttpIdentity = PresentationHttpIdentity>(options: PresentationHandlerOptions<Identity>): PresentationHandler;
