import type {Schemas} from './wire-types.js';

export interface AlbumAppearance {
  background?: string;
  color?: string;
  borderColor?: string;
  padding?: number;
  radius?: number;
  borderWidth?: number;
}
export type AlbumArtwork = Schemas['AlbumArtwork'];
export type AlbumLayout = Schemas['AlbumLayout'] & {
  id?: string;
  columns?: number;
  gap?: number;
  css?: string;
  appearance?: AlbumAppearance;
};
/** Sanitizes structured appearance and supported historical CSS declarations. */
export function albumAppearance(layout?: unknown): AlbumAppearance;
export function validateAlbumAppearance(input: unknown): AlbumAppearance;
export function applyAlbumAppearance(node: HTMLElement, appearance: AlbumAppearance): void;
export function validateAlbumPageSize(value: unknown): number;
export function validateAlbumArtwork(input: unknown): AlbumArtwork;
/** Invalid artwork is represented by an empty artwork object. */
export function albumArtwork(layout?: unknown): AlbumArtwork;
export function validateAlbumPageAssignments(layout: AlbumLayout, placements: readonly {
  data?: Record<string, unknown>;
}[]): void;
