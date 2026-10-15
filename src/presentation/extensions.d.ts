import type {ActionJson} from '../action-contracts.js';

/** Executable extensions are supplied by the host. */
export interface ExtensionModule {
  id: string;
  version: string;
  apiVersion: string;
  trust: 'host-installed';
  provides?: readonly string[];
  before?: readonly string[];
  after?: readonly string[];
  fallback: unknown;
  create: (...args: never[]) => unknown;
  estimate: (...args: never[]) => unknown;
  validate?: (configuration: Record<string, ActionJson>) => unknown;
}
export interface ExtensionComposition<M extends ExtensionModule> {
  modules: M[];
  get(slot: string): M | undefined;
  explainComposition(): {
    apiVersion: string;
    order: string[];
    slots: Record<string, string>;
    versions: Record<string, string>;
  };
}
export function composeExtensions<M extends ExtensionModule>(modules: readonly M[], options?: {
  select?: Readonly<Record<string, string>>;
  configuration?: Readonly<Record<string, Record<string, ActionJson>>>;
  apiVersion?: string;
}): ExtensionComposition<M>;

export type ConfigurationField = {scopes: readonly string[]} & (
  {type: 'number'; default: number; min?: number; max?: number} |
  {type: 'string'; default: string} |
  {type: 'boolean'; default: boolean} |
  {type: 'object'; default: null | ActionJson[] | {[key: string]: ActionJson}}
);
export type ConfigurationSchema = Readonly<Record<string, ConfigurationField>>;
export type ConfigurationValues<S extends ConfigurationSchema> = {
  -readonly [K in keyof S]: S[K]['type'] extends 'number' ? number :
    S[K]['type'] extends 'string' ? string :
    S[K]['type'] extends 'boolean' ? boolean :
    S[K]['type'] extends 'object' ? null | ActionJson[] | {[key: string]: ActionJson} : ActionJson;
};
export function resolveConfiguration<S extends ConfigurationSchema>(schema: S,
  layers: readonly {scope: string; values: Partial<ConfigurationValues<S>>}[],
  options?: {ceilings?: Readonly<Partial<Record<keyof S, number>>>},
): ConfigurationValues<S>;
