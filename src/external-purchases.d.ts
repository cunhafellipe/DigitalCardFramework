import type {Schemas} from './wire-types.js';

export type ExternalPurchaseFingerprintInput = Pick<Schemas['ExternalPurchaseIntent'],
  'providerId' | 'transactionId' | 'userId' | 'externalCurrency' | 'externalUnits'> & {
  quote: Omit<Schemas['ExternalPurchaseQuote'], 'bindingActivation'> & {bindingActivation?: never};
};
/** Validates purchase terms and returns their canonical SHA-256 fingerprint. */
export function externalPurchaseFingerprint(input: ExternalPurchaseFingerprintInput): string;
/** Validates provider transaction identifiers and returns their stable purchase ID. */
export function externalPurchaseId(providerId: string, transactionId: string): `ep_${string}`;
