import type {Schemas} from './wire-types.js';
import type {TextNode} from './presentation/text.js';

export declare const POLICY_VERSION: 1;
export type CardStatScope = NonNullable<Schemas['CardStatField']['scope']>;
export type CardStatVisibility = NonNullable<Schemas['CardStatField']['visibility']>;
export type CardStatValues = Record<string, unknown>;
export type CardValueField = Omit<Schemas['CardStatField'], 'key' | 'label'> & Partial<Pick<Schemas['CardStatField'], 'key' | 'label'>>;
export interface CardPolicyContext {lineId?: string; type?: string; variantId?: string; cardId?: string;}
export interface CardPolicyNode extends Partial<TextNode> {type: string; children?: CardPolicyNode[];}
export interface CardPolicyPresentation {
  manifest: {
    faces: Record<string, {scene: string}>;
    canvas?: unknown;
    assets: {id: string; sha256: string}[];
    authoring?: {
      template?: string;
      values?: Record<string, CardStatValues>;
      fields?: Schemas['CardStatField'][];
    };
  };
  scenes: Map<string, {nodes: CardPolicyNode[]}> | Record<string, {nodes: CardPolicyNode[]}>;
  layouts?: Record<string, {nodeId: string; overflow?: boolean}>;
}
/** Inspection retains provenance values, including single-reference defaults. */
export type CardPolicyInspectionIssue = Required<Pick<Schemas['CardPolicyIssue'], 'code' | 'path' | 'message' | 'rule' | 'severity'>> & {policies: string | string[]};
export declare function reference(value: unknown): boolean;
export type FlattenedPolicyNode<T, Seen = never> = T extends Seen ? never : T |
  (T extends {children?: (infer Child)[]} ? FlattenedPolicyNode<Child, Seen | T> : never);
export declare function flattenNodes<T extends object>(nodes: T[]): FlattenedPolicyNode<T>[];
export declare function exact(value: unknown, keys: readonly string[], name?: string): void;
export declare function validateExpression(expr: unknown, options?: {depth?: number; count?: {value: number}}): void;
export declare function expression(expr: unknown, values: CardStatValues): unknown;
export declare function validateField(field: unknown, depth?: number): Schemas['CardStatField'];
export declare function valueError(field: CardValueField, value: unknown): string | null;
export declare function validatePolicy(document: unknown): Schemas['CardPolicy'];
export declare function resolveCardPolicy(
  documents: Schemas['CardPolicy'][],
  assignments: Schemas['CardPolicyAssignment'][],
  context: CardPolicyContext,
  options?: {resources?: Schemas['CardLibraryResource'][]},
): Schemas['CardPolicyEffective'];
export declare function deriveStats(fields: Schemas['CardStatField'][], values: CardStatValues, scope?: CardStatScope): CardStatValues;
export declare function policyDefaults(policy: Pick<Schemas['CardPolicyEffective'], 'defaults' | 'fields'>, scope?: CardStatScope): CardStatValues;
export declare function publicStats(values: CardStatValues | null | undefined, fields: Schemas['CardStatField'][], scope?: CardStatScope, visibility?: CardStatVisibility): CardStatValues;
export declare function inspectCardPolicy(policy: Schemas['CardPolicyEffective'], subjects: {
  card?: {stats?: CardStatValues} | null;
  variant?: {stats?: CardStatValues} | null;
  copy?: {stats?: CardStatValues} | null;
  presentation?: CardPolicyPresentation | null;
  templates?: Schemas['CardLibraryResource']['document'][];
}): CardPolicyInspectionIssue[];
