import type {Schemas} from './wire-types.js';

export type CardPolicyDefinitionName = keyof Pick<Schemas,
  'CardStatField' | 'CardPolicyRequirements' | 'CardTypography' | 'CardPolicyDefaults' |
  'CardPolicy' | 'CardPolicyAssignment' | 'CardPolicyIssue' | 'CardPolicyEffective' |
  'CardLibraryResource' | 'CardPolicyRegistry' | 'CardPolicySave' | 'CardPolicyPreview' |
  'CardPolicyImpact' | 'CardPolicyActivation' | 'CardPolicyLifecycle' | 'CardLibrarySave' |
  'CardLibraryLifecycle' | 'CardCopyStats'>;
export interface CardPolicyObjectSchema {
  type: 'object';
  additionalProperties: false;
  properties: Record<string, unknown>;
  required: string[];
}
export type CardPolicyDefinitions = Record<CardPolicyDefinitionName, CardPolicyObjectSchema>;
export declare const policyDefinitions: CardPolicyDefinitions;
export declare const cardPolicySchema: {
  $schema: 'https://json-schema.org/draft/2020-12/schema';
  $id: 'https://digital-card.invalid/schema/card-policy-1.json';
  $ref: '#/$defs/CardPolicy';
  $defs: CardPolicyDefinitions;
};
