export type AlbumDisplayField = 'albumName' | 'cardName' | 'rarity' | 'pageName' | 'preview';
export interface AlbumDisplayGrant {
  profile: 'dc.album-display@1';
  fields: readonly AlbumDisplayField[];
}
export interface AlbumDisplaySnapshot {
  profile: 'dc.album-display@1';
  snapshotId: string;
  fields: readonly AlbumDisplayField[];
  name?: string;
  pages: readonly {index: number; name?: string}[];
  items: readonly {handle: string; position: number; page: number; name?: string; rarity?: string}[];
  previews: readonly {handle: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: Uint8Array}[];
}
export declare const albumDisplayProfile: 'dc.album-display@1';
export declare const albumDisplayFields: readonly AlbumDisplayField[];
export declare const albumDisplayLimits: Readonly<Record<string, number>>;
export declare const albumDisplaySchema: Record<string, unknown>;
export declare function validateAlbumDisplay(value: unknown): AlbumDisplaySnapshot;
