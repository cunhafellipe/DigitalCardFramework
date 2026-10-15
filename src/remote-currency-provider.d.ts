import type {CurrencyLookupResponse} from './currency-provider-contracts.js';
import type {RemoteCodeProviderOptions} from './remote-code-provider.js';
export {currencyProviderProtocol, currencyProviderSchema, validateCurrencyProviderRequest, validateCurrencyProviderResponse} from './currency-provider-contracts.js';
export type {CurrencyProviderRequest, CurrencyProviderResponse} from './currency-provider-contracts.js';

export interface CurrencyMapping {currencyId: string; numerator?: number; denominator?: number;}
export type CurrencyMappings = Readonly<Record<string, Readonly<CurrencyMapping>>>;
export interface RemoteCurrencyProviderOptions extends RemoteCodeProviderOptions {currencies: CurrencyMappings;}
export interface CurrencyAccountLookup {userId: string; signal?: AbortSignal;}
export interface CurrencySettlementLookup {transactionId: string; account: string; signal?: AbortSignal;}
export type CurrencySettlementResult =
  | Pick<Extract<CurrencyLookupResponse, {status: 'settled'}>, 'transactionId' | 'account' | 'status' | 'currency' | 'amountUnits'>
  | Pick<Extract<CurrencyLookupResponse, {status: 'unknown' | 'pending' | 'refunded'}>, 'transactionId' | 'account' | 'status'>;
export interface CurrencyProvider {
  providerId?: string;
  /** Required by the currency gateway; the registry alone only validates callbacks. */
  currencies?: CurrencyMappings;
  assertActive?(): void;
  resolveAccount(input: CurrencyAccountLookup): string | Promise<string>;
  lookup(input: CurrencySettlementLookup): CurrencySettlementResult | Promise<CurrencySettlementResult>;
}
export interface RemoteCurrencyProvider extends CurrencyProvider {
  readonly providerId: string;
  readonly currencies: CurrencyMappings;
  assertActive(): void;
  /** Permanently disables this provider and aborts active requests. */
  disable(): void;
  resolveAccount(input: CurrencyAccountLookup): Promise<string>;
  lookup(input: CurrencySettlementLookup): Promise<CurrencySettlementResult>;
}
export interface CurrencyProviderRegistryOptions {
  currencyProviders?: Record<string, CurrencyProvider>;
  currencyProviderEndpoints?: Record<string, Omit<RemoteCurrencyProviderOptions, 'providerId'> & {providerId?: string}>;
}
export interface CurrencyProviderRegistry {
  readonly providers: Readonly<Record<string, CurrencyProvider>>;
  /** Only configured remote endpoints can be disabled through the registry. */
  disable(providerId: string): void;
  /** Disables remote endpoints; direct host adapters are not closed. */
  close(): void;
}
export declare function createRemoteCurrencyProvider(options: RemoteCurrencyProviderOptions): RemoteCurrencyProvider;
export declare function createCurrencyProviderRegistry(options?: CurrencyProviderRegistryOptions): CurrencyProviderRegistry;
