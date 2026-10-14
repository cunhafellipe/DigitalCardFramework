import type {AccessPermission, AccessRole, AuthenticatedAccessIdentity} from './access-provider-contracts.js';
export {accessProviderProtocol,accessProviderSchema,validateAccessProviderRequest,validateAccessProviderResponse} from './access-provider-contracts.js';
export type {AccessPermission,AccessRole,AuthenticatedAccessIdentity,AccessProviderRequest,AccessProviderResponse} from './access-provider-contracts.js';
export interface ResolvedAccess {
  readonly role: AccessRole;
  readonly permissions: readonly AccessPermission[];
}
export interface RemoteAccessProviderOptions {
  providerId: string;
  url: string;
  token: string;
  /** Admin requires an explicit ceiling containing every known framework permission. */
  allowRoles: readonly AccessRole[];
  allowPermissions: readonly AccessPermission[];
  allowLoopbackHttp?: boolean;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxConcurrent?: number;
}
export interface AccessProviderState {
  providerId: string;
  scope: 'access';
  enabled: boolean;
  generation: number;
}
export type AccessResolver = (identity: AuthenticatedAccessIdentity, options?: {signal?: AbortSignal}) => ResolvedAccess | {role?: AccessRole; permissions?: readonly string[]; disabled?: boolean} | null | Promise<ResolvedAccess | {role?: AccessRole; permissions?: readonly string[]; disabled?: boolean} | null>;
export interface RemoteAccessProvider {
  readonly providerId: string;
  readonly allowRoles: readonly AccessRole[];
  readonly allowPermissions: readonly AccessPermission[];
  resolveAccess(identity: AuthenticatedAccessIdentity, options?: {signal?: AbortSignal}): Promise<ResolvedAccess | null>;
  setEnabled(enabled: boolean): AccessProviderState;
  close(): void;
}
export declare function createRemoteAccessProvider(options: RemoteAccessProviderOptions): RemoteAccessProvider;
export declare function createHostAccessResolver(options?: {remoteAccess?: RemoteAccessProviderOptions; resolveAccess?: AccessResolver}): {
  readonly resolveAccess: AccessResolver | undefined;
  close(): void;
  setEnabled(enabled: boolean): AccessProviderState;
};
