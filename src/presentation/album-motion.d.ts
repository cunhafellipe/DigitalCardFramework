export interface AlbumMotionConfiguration {
  enabled?: boolean;
  limits?: {x: readonly [number, number]; y: readonly [number, number]};
  scale?: readonly [number, number];
  maxRotation?: readonly [number, number];
  syncGroup?: string | null;
}
export interface AlbumMotionInput {
  tilt?: {x?: number; y?: number};
  [field: string]: unknown;
}
export interface AlbumMotionState {
  tilt: {x: number; y: number};
  rotation: {x: number; y: number};
  [field: string]: unknown;
}
export interface AlbumMotionController {
  setInputs(id: string, input: AlbumMotionInput): void;
  setAll(input: AlbumMotionInput): void;
  snapshot(): Record<string, AlbumMotionState>;
  dispose(): void;
}
/** Inputs and snapshots are cloned; extra input fields must be structured-cloneable. */
export function createAlbumMotion(options: {
  members: readonly {id: string; motion?: AlbumMotionConfiguration; [field: string]: unknown}[];
  defaults?: AlbumMotionConfiguration;
  onChange?: (id: string, state: AlbumMotionState) => void;
}): AlbumMotionController;
