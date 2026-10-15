import type {ValidatedPackage, BuiltPackage} from './package.js';
import type {PerformanceNode} from './performance.js';
import type {FontAxis, FontType} from './text.js';

export interface ProjectAsset {
  id: string;
  path: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  role: string;
  width?: number;
  height?: number;
  duration?: number;
  font?: {family: string; face: string; license: string; axes?: Record<string, FontAxis>};
}
export interface ProjectFace {scene: string; poster: string; description: string}
export type ProjectManifest = ValidatedPackage['manifest'] & {
  format: 'digital-card';
  contractVersion: '0.1.0';
  id: string;
  revision: number;
  title: string;
  summary: string;
  profile: 'portable';
  faces: Record<'front' | 'back', ProjectFace>;
  assets: ProjectAsset[];
  capabilities: {required: string[]; optional: {id: string; fallback: 'poster' | 'omit-decorative' | 'static-pose'}[]};
};
/** Additional authored node fields remain unvalidated at the type boundary. */
export interface ProjectNode extends Omit<PerformanceNode, 'children'> {
  children?: ProjectNode[];
  x?: number;
  y?: number;
  [key: string]: unknown;
}
export interface ProjectScene {
  dialect: 'dc.scene2d@0.1';
  nodes: ProjectNode[];
  [key: string]: unknown;
}
export interface ProjectSnapshot {
  manifest: ProjectManifest;
  scenes: Map<string, ProjectScene>;
  assets: Map<string, Uint8Array>;
}
export interface ProjectPackage extends BuiltPackage {
  manifest: ProjectManifest;
  scenes: Map<string, ProjectScene>;
}
export interface Project extends ProjectSnapshot {
  undo: ProjectSnapshot[];
  redo: ProjectSnapshot[];
  getRevision(): number;
  /** Applies a synchronous change, validates it, and records history. */
  edit(change: (project: Project) => void): void;
  undoEdit(): boolean;
  redoEdit(): boolean;
  export(options?: {retainSources?: boolean}): Promise<ProjectPackage>;
  addMedia(blob: Blob, options?: {id?: string; width?: number; height?: number; duration?: number; role?: string}): Promise<ProjectAsset>;
  addFont(blob: Blob, options?: {id?: string; license?: string}): Promise<ProjectAsset & {mediaType: FontType; role: 'font'; font: {family: string; face: string; license: string; axes: Record<string, FontAxis>}}>;
  addImage(blob: Blob, options?: {id?: string; role?: string}): Promise<ProjectAsset & {width: number; height: number}>;
  setPosters(posters: Partial<Record<'front' | 'back', Blob>>): Promise<void>;
  saveDraft(key?: IDBValidKey): Promise<void>;
  serialize(): ProjectSnapshot;
}
export interface ProjectGlitterPreset {
  kind: 'glitter'; size: number; density: number; intensity: number; roughness: number;
  variation: number; shape: 'circle' | 'shard' | 'star'; seed: number;
}
export const materialPresets: {
  readonly 'Fine silver': ProjectGlitterPreset & {shape: 'circle'; color: string};
  readonly 'Chunky holo': ProjectGlitterPreset & {shape: 'shard'};
  readonly 'Gold stars': ProjectGlitterPreset & {shape: 'star'; color: string};
  readonly 'Soft foil': {kind: 'foil'; angle: number; radius: number; intensity: number; mode: 'surface'};
  readonly 'Lake reflection': {kind: 'water'; sweep: number; radius: number; intensity: number; mode: 'surface'};
  readonly 'Feathered bloom': {kind: 'bloom'; progress: number; feather: number; center: [number, number]};
};
/** The package must already have passed package validation. */
export function createProject(pkg: Pick<ValidatedPackage, 'manifest' | 'scenes' | 'files'>): Project;
export function openProject(bytes: Uint8Array): Promise<Project>;
export function loadDraft(key?: IDBValidKey): Promise<Project | null>;
/** Requires browser canvas support to generate the initial poster images. */
export function blankPackage(): Promise<ProjectPackage>;
