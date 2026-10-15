import type {CurrencyMapping, CurrencyMappings, CurrencyProvider} from './remote-currency-provider.js';
import type {Schemas} from './wire-types.js';

/** Currency gateways admit providers with explicit conversion mappings. */
export type GatewayCurrencyProvider = CurrencyProvider & {currencies: CurrencyMappings};
export interface ExternalCreditInput {
  providerId: string;
  transactionId: string;
  userId: string;
  currencyId: string;
  amount: number;
  externalCurrency: string;
  externalUnits: string;
}
export interface CurrencyGatewayFramework<A extends {userId: string}, R extends Schemas['ExternalCreditReceipt'] = Schemas['ExternalCreditReceipt']> {
  me(actor: A): unknown;
  settleExternalCredit(actor: {permissions: ['currency.settle']}, input: ExternalCreditInput): R | PromiseLike<R>;
}
export interface CurrencyGateway<A extends {userId: string}, R extends Schemas['ExternalCreditReceipt'] = Schemas['ExternalCreditReceipt']> {
  describe(): {id: string; currencies: Record<string, CurrencyMapping>; contract: 'dc.currency-settlement@1'}[];
  reconcile(actor: A, input: {providerId: string; transactionId: string}, options?: {signal?: AbortSignal}): Promise<R>;
}
export function createCurrencyGateway<A extends {userId: string}, R extends Schemas['ExternalCreditReceipt'] = Schemas['ExternalCreditReceipt']>(options: {
  framework: CurrencyGatewayFramework<A, R>;
  providers?: Readonly<Record<string, GatewayCurrencyProvider>>;
  timeoutMs?: number;
}): CurrencyGateway<A, R>;
