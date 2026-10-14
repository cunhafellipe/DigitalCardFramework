import type { ActionJson } from '../action-contracts.js';
import type { Schemas } from '../wire-types.js';

export type StatsCSVValue = ActionJson;
export interface StatsCSVRow {
  scope: 'card' | 'variant';
  key: string;
  /** An empty CSV cell deletes the value; JSON null remains an explicit value. */
  value: StatsCSVValue | undefined;
}
/** Structural subset of a presentation project used by CSV operations. */
export interface StatsCSVDocument {
  manifest: {
    authoring?: {
      fields?: Schemas['CardStatField'][];
      values?: Partial<Record<'card' | 'variant', Record<string, StatsCSVValue>>>;
    };
  };
}
export interface StatsCSVProject extends StatsCSVDocument {
  edit(callback: (draft: StatsCSVDocument) => void): unknown;
}
export function exportStatsCSV(project: StatsCSVDocument): string;
export function parseStatsCSV(source: string): StatsCSVRow[];
export function importStatsCSV(project: StatsCSVProject, source: string): number;
