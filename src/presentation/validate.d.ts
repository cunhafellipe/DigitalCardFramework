import type {CompilerManifest} from './compiler.js';
import type {ProjectAsset} from './project.js';

export const CONTRACT: '0.1.0';
export const CAPABILITIES: string[];
export type ValidatedManifestAsset = CompilerManifest['assets'][number] &
  Required<Pick<ProjectAsset, 'bytes' | 'sha256' | 'role'>> & Partial<Pick<ProjectAsset, 'duration' | 'font'>>;
/** Validates without replacing the supplied manifest; returns its asset index and capability set. */
export function validateManifest(manifest: unknown): {assets: Map<string, ValidatedManifestAsset>; capabilities: Set<string>};
/** Validates a scene against its manifest and counts nodes and graph operations. */
export function validateScene(scene: unknown, manifest: CompilerManifest): {nodes: number; operations: number};
