export type EditorTransformParameter =
  | {label: string; type: 'number'; default: number; minimum?: number; maximum?: number; step?: number}
  | {label: string; type: 'string'; default: string; maxLength?: number}
  | {label: string; type: 'boolean'; default: boolean};
export interface EditorTransformGrants {
  faces: readonly ('front' | 'back')[];
  newRasterAssets: boolean;
  capabilities?: readonly string[];
}
export interface EditorTransformTool {
  id: string;
  version: string;
  title: string;
  parameters: Readonly<Record<string, EditorTransformParameter>>;
  grants: EditorTransformGrants;
}
export interface EditorTransformRequestHeader {
  protocol: 'digital-card-editor-transform@1';
  kind: 'request';
  requestId: string;
  toolId: string;
  toolVersion: string;
  sourceDigest: string;
  parameters: Record<string, string | number | boolean>;
  grants: EditorTransformGrants;
}
export interface EditorTransformResultHeader {
  protocol: 'digital-card-editor-transform@1';
  kind: 'result';
  requestId: string;
  toolId: string;
  toolVersion: string;
  sourceDigest: string;
}
export interface EditorTransformReview {
  readonly requestId: string;
  readonly toolId: string;
  readonly title: string;
  readonly changes: {readonly scenes: readonly string[]; readonly addedAssets: readonly string[]};
}
/** Pass a project returned by the presentation project API. */
export interface EditorTransformProject {
  manifest: Record<string, unknown>;
  scenes: Map<string, Record<string, unknown>>;
  assets: Map<string, Uint8Array>;
  getRevision(): number;
  export(options?: {retainSources?: boolean}): Promise<unknown>;
  edit(change: (project: EditorTransformProject) => void): void;
}
export interface EditorTransforms {
  readonly tools: readonly EditorTransformTool[];
  prepare(project: EditorTransformProject, options: {toolId: string; parameters?: Record<string, string | number | boolean>}): Promise<{requestId: string; archive: Uint8Array}>;
  review(project: EditorTransformProject, requestId: string, resultArchive: Uint8Array): Promise<EditorTransformReview>;
  apply(project: EditorTransformProject, review: EditorTransformReview): void;
  mountReview(project: EditorTransformProject, review: EditorTransformReview, options: {root: HTMLElement; side?: 'front' | 'back'; adapters?: readonly unknown[]}): {ready: Promise<{mode: string; quality?: string; fallbackReason?: string}>; dispose(): void};
  discard(requestId: string): void;
  setEnabled(toolId: string, enabled: boolean): void;
  dispose(): void;
}
export declare const editorTransformProtocol: 'digital-card-editor-transform@1';
export declare const editorTransformLimits: Readonly<Record<string, number>>;
export declare const editorTransformSchema: Record<string, unknown>;
export declare function validateEditorTransformHeader(value: unknown): EditorTransformRequestHeader | EditorTransformResultHeader;
export declare function createEditorTransforms(options?: {tools?: readonly EditorTransformTool[]; maxOutstandingJobs?: number}): EditorTransforms;
