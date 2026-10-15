export interface CurrencyProviderIdentity {
  protocol: 'digital-card-currency-settlement@1';
  requestId: string;
  providerId: string;
}
export interface CurrencyAccountRequest extends CurrencyProviderIdentity {
  operation: 'resolve-account';
  userId: string;
}
export interface CurrencyLookupRequest extends CurrencyProviderIdentity {
  operation: 'lookup';
  transactionId: string;
  account: string;
}
export type CurrencyProviderRequest = CurrencyAccountRequest | CurrencyLookupRequest;
export type CurrencyProviderError = {status: 'error'; errorCode: 'invalid-request' | 'unauthenticated' | 'not-found' | 'rate-limited' | 'unavailable'};
export type CurrencyAccountResponse = CurrencyAccountRequest & ({status: 'resolved'; account: string} | CurrencyProviderError);
export type CurrencyLookupResponse = CurrencyLookupRequest & (
  | {status: 'settled'; currency: string; amountUnits: string}
  | {status: 'unknown' | 'pending' | 'refunded'}
  | CurrencyProviderError
);
export type CurrencyProviderResponse = CurrencyAccountResponse | CurrencyLookupResponse;
export declare const currencyProviderProtocol: 'digital-card-currency-settlement@1';
export declare const currencyProviderSchema: Record<string, unknown>;
/** Validates the exact request shape and bounded identifiers/text; returns the original value. */
export declare function validateCurrencyProviderRequest(value: unknown): CurrencyProviderRequest;
/** Settled amounts remain positive decimal strings (up to forty digits), not JS numbers. */
export declare function validateCurrencyProviderResponse(value: unknown): CurrencyProviderResponse;
