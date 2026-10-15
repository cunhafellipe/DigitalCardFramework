/// <reference types="node" />
import type {Buffer} from 'node:buffer';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {DatabaseSync} from 'node:sqlite';
import type {DiscoveryRequestOptions} from 'openid-client';
import type {ActionJson} from './action-contracts.js';

export type AuthSessionKind = 'session' | 'flow';
export type AuthResult<T> = T | Promise<T>;
export interface SessionStoreOptions {encryptionKey?: Buffer; clock?: () => number; maxSessions?: number;}
export interface AuthSessionStorage {
  create(kind: AuthSessionKind, data: ActionJson, ttl: number): AuthResult<string>;
  get(secret: unknown, kind: AuthSessionKind, options?: {consume?: boolean}): AuthResult<unknown>;
  revoke(secret: string | null | undefined): AuthResult<void>;
}
export declare class SessionStore implements AuthSessionStorage {
  constructor(path: ConstructorParameters<typeof DatabaseSync>[0], options?: SessionStoreOptions);
  create(kind: AuthSessionKind, data: ActionJson, ttl: number): string;
  /** Decoded state must be checked before application-specific properties are read. */
  get(secret: unknown, kind: AuthSessionKind, options?: {consume?: boolean}): unknown;
  revoke(secret: string | null | undefined): void;
  close(): void;
}
export interface AuthIdentity {issuer: string; subject: string; displayName: string;}
export type OIDCFlowData = {verifier: string; state: string; nonce: string};
export interface AuthProvider<Flow extends ActionJson = ActionJson> {
  begin(): AuthResult<{url: string; data: Flow}>;
  finish(url: URL, data: Flow): AuthResult<AuthIdentity>;
}
export interface OIDCProvider extends AuthProvider<OIDCFlowData> {
  begin(): Promise<{url: string; data: OIDCFlowData}>;
  finish(url: URL | Request, data: OIDCFlowData): Promise<AuthIdentity>;
}
export interface OIDCProviderOptions {
  issuer: string | URL; clientId: string; clientSecret?: string; origin: string;
  discoveryOptions?: DiscoveryRequestOptions;
}
export declare function createOIDCProvider(options: OIDCProviderOptions): Promise<OIDCProvider>;
export interface AuthSession {issuer: string; subject: string; userId: string;}
export interface AuthAccess {role?: string; permissions?: unknown; disabled?: boolean;}
export interface AuthPrincipal {userId: string; role: 'admin' | 'player'; permissions: string[];}
export interface AuthFramework {
  registerUser(authority: {role: 'admin'}, input: {provider: string; subject: string; displayName: string}): AuthResult<{id: string}>;
}
export interface AuthHostOptions<Flow extends ActionJson = ActionJson> {
  framework: AuthFramework;
  /** Trusted storage must preserve the identity fields created by this host. */
  sessions: AuthSessionStorage;
  provider: AuthProvider<Flow>;
  origin: string;
  adminSubjects?: Iterable<string>;
  resolveAccess?(session: Readonly<AuthSession>, options: {signal: AbortSignal}): AuthResult<AuthAccess | null | undefined>;
  sessionTTL?: number;
  secure?: boolean;
  rateLimit?(options: {request: IncomingMessage; mutation: true}): boolean;
}
export interface AuthHost {
  resolveIdentity(request: IncomingMessage): AuthResult<AuthPrincipal | null>;
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
}
export declare function createAuthHost<Flow extends ActionJson>(options: AuthHostOptions<Flow>): AuthHost;
