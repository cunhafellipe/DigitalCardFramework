import type {CodeProviderRequest, CodeProviderResponse} from './code-provider-contracts.js';
export {codeProviderProtocol, codeProviderSchema, validateCodeProviderRequest, validateCodeProviderResponse} from './code-provider-contracts.js';
export type {CodeProviderRequest, CodeProviderResponse} from './code-provider-contracts.js';

export interface RemoteCodeProviderOptions {
  providerId: string; url: string; token: string;
  allowLoopbackHttp?: boolean; timeoutMs?: number;
  maxRequestBytes?: number; maxResponseBytes?: number; maxConcurrent?: number;
}
export type CodeProviderLookup = Pick<CodeProviderRequest, 'providerId' | 'codeId' | 'code'> & {externalId?: string | null; signal?: AbortSignal};
export type CodeProviderResult =
  | Pick<Extract<CodeProviderResponse, {status: 'unknown'}>, 'codeId' | 'status'>
  | Pick<Extract<CodeProviderResponse, {status: 'redeemed' | 'revoked'}>, 'codeId' | 'status' | 'eventId' | 'occurredAt'>;
export interface CodeStatusProvider {
  providerId?: string;
  assertActive?(): void;
  lookup(input: CodeProviderLookup): CodeProviderResult | Promise<CodeProviderResult>;
}
export interface RemoteCodeProvider extends CodeStatusProvider {
  readonly providerId: string;
  assertActive(): void;
  /** Permanently disables this provider and aborts active requests. */
  disable(): void;
  lookup(input: CodeProviderLookup): Promise<CodeProviderResult>;
}
export interface CodeProviderRegistryOptions {
  codeProviders?: Record<string, CodeStatusProvider>;
  codeProviderEndpoints?: Record<string, Omit<RemoteCodeProviderOptions, 'providerId'> & {providerId?: string}>;
}
export interface CodeProviderRegistry {
  readonly providers: Readonly<Record<string, CodeStatusProvider>>;
  /** Only configured remote endpoints can be disabled through the registry. */
  disable(providerId: string): void;
  /** Disables remote endpoints; direct host adapters are not closed. */
  close(): void;
}
export declare function createRemoteCodeProvider(options: RemoteCodeProviderOptions): RemoteCodeProvider;
export declare function createCodeProviderRegistry(options?: CodeProviderRegistryOptions): CodeProviderRegistry;
