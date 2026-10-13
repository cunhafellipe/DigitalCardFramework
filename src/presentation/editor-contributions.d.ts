export type EditorContributionField = 'x' | 'y' | 'rotation';
export interface EditorContributionControl {
  readonly id: string;
  readonly label: string;
  readonly field: EditorContributionField;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
}
export interface EditorContribution {
  readonly protocol: 'digital-card-editor-contribution@1';
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly controls: readonly EditorContributionControl[];
}
export type EditorContributionGrants = Partial<Record<EditorContributionField, {readonly minimum: number; readonly maximum: number}>>;
export interface EditorContributionSelection {
  project: unknown;
  side: unknown;
  node: Partial<Record<EditorContributionField, number>>;
  locked?: boolean;
}
export interface EditorContributionMountOptions {
  root: HTMLElement;
  getSelection(): EditorContributionSelection | null | undefined;
  edit(change: () => void): void | Promise<void>;
  run?(change: () => Promise<void>): void | Promise<void>;
  report?(message: string): void;
}
export interface EditorContributions {
  readonly contributions: readonly EditorContribution[];
  mount(options: EditorContributionMountOptions): {render(): void; dispose(): void};
  setEnabled(id: string, enabled: boolean): void;
  dispose(): void;
}
export declare const editorContributionProtocol: 'digital-card-editor-contribution@1';
export declare const editorContributionSchema: Record<string, unknown>;
export declare function validateEditorContribution(value: unknown): EditorContribution;
export declare function createEditorContributions(manifests?: readonly unknown[], options?: {grants?: EditorContributionGrants}): EditorContributions;
