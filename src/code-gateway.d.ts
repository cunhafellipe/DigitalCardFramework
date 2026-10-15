import type {CodeProviderLookup, CodeProviderResult, CodeStatusProvider} from './remote-code-provider.js';
import type {Schemas} from './wire-types.js';

export type CodeGatewayConfirmation = Pick<Extract<CodeProviderResult, {status: 'redeemed' | 'revoked'}>, 'codeId' | 'status'>;
/** Framework methods used by the server-side status bridge. */
export interface CodeGatewayFramework<A, R extends CodeGatewayConfirmation = CodeGatewayConfirmation> {
  codeLookupMaterial(actor: A, codeId: string): Omit<CodeProviderLookup, 'signal'> | PromiseLike<Omit<CodeProviderLookup, 'signal'>>;
  confirmCodeStatus(actor: {permissions: ['codes.confirm']; codeProviderIds: string[]},
    input: Schemas['CodeConfirmation']): R | PromiseLike<R>;
}
export interface CodeGateway<A, R extends CodeGatewayConfirmation = CodeGatewayConfirmation> {
  reconcile(actor: A, input: {codeId: string; signal?: AbortSignal}): Promise<R | {codeId: string; status: 'unverified'}>;
}
export function createCodeGateway<A, R extends CodeGatewayConfirmation = CodeGatewayConfirmation>(options: {
  framework: CodeGatewayFramework<A, R>;
  providers?: Readonly<Record<string, CodeStatusProvider>>;
  timeoutMs?: number;
}): CodeGateway<A, R>;
