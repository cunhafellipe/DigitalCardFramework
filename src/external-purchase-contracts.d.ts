import type {Schemas} from './wire-types.js';

export type ExternalPurchaseDefinitionName = keyof Pick<Schemas,
  'ExternalPurchasePrice' | 'ExternalPurchaseQuote' | 'ExternalPurchaseIntent' | 'PrepareExternalPurchase' |
  'ExternalDebitProof' | 'ExternalNoDebitProof' | 'ExternalRefundProof' | 'CommitExternalPurchase' |
  'CancelExternalPurchase' | 'ConfirmExternalCompensation' | 'ExternalPurchaseStatus' | 'LookupExternalPurchase' |
  'PendingExternalPurchases' | 'ReconcileLegacyExternalPurchase' | 'ExternalLegacyDecision' |
  'ResolveLegacyExternalPurchase' | 'ExternalLegacyResolution' | 'ExternalPurchaseReceipt' |
  'ExternalPurchasePack' | 'ExternalPurchaseProjection' | 'ExternalPurchasePage'>;
export interface ExternalPurchaseObjectSchema {
  type: 'object';
  additionalProperties: false;
  properties: Record<string, unknown>;
  required: string[];
  allOf?: Record<string, unknown>[];
}
export type ExternalPurchaseDefinitions = {[Name in ExternalPurchaseDefinitionName]: ExternalPurchaseObjectSchema};
/** Builds trusted-host schemas, using the prefix for references between definitions. */
export declare function externalPurchaseDefinitions(prefix?: string): ExternalPurchaseDefinitions;
export declare const externalPurchaseSchema: {
  $schema: 'https://json-schema.org/draft/2020-12/schema';
  $id: 'urn:digital-card:external-purchases:v1';
  $defs: ExternalPurchaseDefinitions;
};
