import type {CodeIssuanceIdentity, CodeIssuanceEntry, CodeIssuanceRequest, CodeIssuanceResponse, IssuedCodeResult} from './code-issuance-contracts.js';
import type {RemoteCodeProviderOptions} from './remote-code-provider.js';
export {codeIssuanceProtocol, codeIssuanceSchema, validateCodeIssuanceRequest, validateCodeIssuanceResponse} from './code-issuance-contracts.js';
export type {CodeIssuanceRequest, CodeIssuanceResponse, IssuedCodeResult} from './code-issuance-contracts.js';

export interface RemoteCodeIssuerOptions extends RemoteCodeProviderOptions {
  kind?: 'external';
  /** Ignored: the adapter always fixes the transport scope to code-issuance. */
  scope?: unknown;
}
export interface RemoteCodeIssuer {
  readonly kind: 'external';
  readonly providerId: string;
  readonly timeoutMs: number;
  grant(): Readonly<Pick<CodeIssuanceIdentity, 'providerId' | 'grantId' | 'generation'>>;
  assertGrant(grant: Readonly<Pick<CodeIssuanceIdentity, 'providerId' | 'grantId' | 'generation'>>): void;
  setEnabled(enabled: boolean): {providerId: string; scope: 'code-issuance'; enabled: boolean; generation: number};
  close(): void;
  /** Remote error frames reject; processed entries may still be pending or failed. */
  evaluate(request: CodeIssuanceRequest, options?: {signal?: AbortSignal}): Promise<Extract<CodeIssuanceResponse, {status: 'processed'}>>;
}
export interface PureCodeIssuerOptions {
  kind: 'pure';
  providerId: string;
  /** Must return synchronously; promise results are rejected. */
  generate(entry: CodeIssuanceEntry): IssuedCodeResult;
}
export type PureCodeIssuanceResponse = Omit<Extract<CodeIssuanceResponse, {status: 'processed'}>, 'results'> & {
  results: (CodeIssuanceEntry & ({state: 'issued'; result: IssuedCodeResult} | {state: 'not-issued' | 'cancelled'}))[];
};
export interface PureCodeIssuer {
  kind: 'pure';
  providerId: string;
  timeoutMs: number;
  grant(): Pick<CodeIssuanceIdentity, 'providerId' | 'grantId' | 'generation'>;
  assertGrant(grant: Readonly<Pick<CodeIssuanceIdentity, 'providerId' | 'grantId' | 'generation'>>): void;
  close(): void;
  evaluate(request: CodeIssuanceRequest, options?: {signal?: AbortSignal}): Promise<PureCodeIssuanceResponse>;
}
export interface CodeIssuerRegistry {
  issuers: Readonly<Record<string, PureCodeIssuer | RemoteCodeIssuer>>;
  close(): void;
}
export declare function createRemoteCodeIssuer(options: RemoteCodeIssuerOptions): RemoteCodeIssuer;
export declare function createCodeIssuerRegistry(options?: {allocationCodeIssuers?: Record<string, PureCodeIssuerOptions | RemoteCodeIssuerOptions>}): CodeIssuerRegistry;
