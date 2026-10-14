export type OpenerDisplayField = 'cardName' | 'rarity' | 'isNew' | 'preview';
export type OpenerIntent = 'opener-reveal' | 'opener-skip' | 'opener-replay' | 'opener-inspect';
export interface OpenerDisplayGrant {profile: 'dc.opener-display@1'; fields: readonly OpenerDisplayField[];}
export interface OpenerDisplaySnapshot {
  profile: 'dc.opener-display@1';
  snapshotId: string;
  fields: readonly OpenerDisplayField[];
  phase: 'idle' | 'loading' | 'ready' | 'revealing' | 'complete' | 'error';
  revealed: number;
  total: number;
  locale: string;
  dir: 'ltr' | 'rtl';
  labels: Record<'title' | 'status' | 'progress' | 'reveal' | 'skip' | 'replay' | 'inspect' | 'new' | 'duplicate', string>;
  items: readonly {position: number; label: string; handle?: string; name?: string; rarity?: string; isNew?: boolean}[];
  previews: readonly {handle: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: Uint8Array}[];
}
export interface OpenerIntentEvent {intent: OpenerIntent; snapshotId: string; handle?: string;}
export declare const openerDisplayProfile: 'dc.opener-display@1';
export declare const openerDisplayFields: readonly OpenerDisplayField[];
export declare const openerDisplayLabelKeys: readonly (keyof OpenerDisplaySnapshot['labels'])[];
export declare const openerDisplayLimits: Readonly<Record<string, number>>;
export declare const openerDisplaySchema: Record<string, unknown>;
export declare function validateOpenerDisplay(value: unknown): OpenerDisplaySnapshot;
