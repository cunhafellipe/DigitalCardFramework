export interface CodeProviderIdentity {
  protocol: 'digital-card-code-status@1';
  requestId: string;
  providerId: string;
  codeId: string;
}
export interface CodeProviderRequest extends CodeProviderIdentity {
  operation: 'lookup';
  externalId: string | null;
  code: string;
}
export type CodeProviderResponse = CodeProviderIdentity & (
  | {status: 'unknown'}
  | {status: 'redeemed' | 'revoked'; eventId: string; occurredAt: string}
  | {status: 'error'; errorCode: 'invalid-request' | 'unauthenticated' | 'not-found' | 'rate-limited' | 'unavailable'}
);
export declare const codeProviderProtocol: 'digital-card-code-status@1';
export declare const codeProviderSchema: Record<string, unknown>;
/** Validates the exact request shape and bounded identifiers/text; returns the original value. */
export declare function validateCodeProviderRequest(value: unknown): CodeProviderRequest;
/** Also validates event timestamps; returns the original value or throws. */
export declare function validateCodeProviderResponse(value: unknown): CodeProviderResponse;
