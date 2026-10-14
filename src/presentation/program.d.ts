import type {MarketplaceDisplayGrant,MarketplaceDisplaySnapshot,MarketplaceIntentEvent} from './marketplace-display.js';
import type {TradingDisplayGrant,TradingDisplaySnapshot,TradingIntentEvent} from './trading-display.js';
import type {ShopDisplayGrant,ShopDisplaySnapshot,ShopIntentEvent} from './shop-display.js';
import type {AlbumDisplayGrant, AlbumDisplaySnapshot} from './album-display.js';
import type {OpenerDisplayGrant, OpenerDisplaySnapshot, OpenerIntent, OpenerIntentEvent} from './opener-display.js';
import type {EditorDisplayGrant,EditorDisplaySnapshot,EditorProposal} from './editor-display.js';
export interface ProgramInputs {
  tilt?: {x?: number; y?: number};
  revealProgress?: number;
  flipProgress?: number;
}
export interface ProgramRegistryEntry {
  approved: boolean;
  url: string;
  version: string;
  title?: string;
  intents?: readonly string[];
  albumDisplay?: AlbumDisplayGrant;
  openerDisplay?: OpenerDisplayGrant;
  editorDisplay?: EditorDisplayGrant;
  collectionDisplay?:CollectionDisplayGrant;
  shopDisplay?:ShopDisplayGrant;
  tradingDisplay?:TradingDisplayGrant;
  marketplaceDisplay?:MarketplaceDisplayGrant;
}
export type ProgramRegistry = ReadonlyMap<string, ProgramRegistryEntry>;
export interface ProgramMountOptions {
  programId: string;
  registry: ProgramRegistry;
  inputs?: ProgramInputs;
  onIntent?(event: {intent: string}): void;
  maxMessagesPerSecond?: number;
  handshakeTimeout?: number;
  onReady?(): void;
  onError?(error: {code: string}): void;
  albumDisplay?: AlbumDisplaySnapshot;
  onAlbumSelect?(event: {snapshotId: string; handle: string}): void;
  openerDisplay?: OpenerDisplaySnapshot;
  onOpenerIntent?(event: OpenerIntentEvent): void;
  editorDisplay?:EditorDisplaySnapshot;
  onEditorProposal?(event:EditorProposal):void;
  onSessionEnd?():void;
  collectionDisplay?:CollectionDisplaySnapshot;
  onCollectionIntent?(event:CollectionIntentEvent):void;
  marketplaceDisplay?:MarketplaceDisplaySnapshot;
  onMarketplaceIntent?(event:MarketplaceIntentEvent):void;
  tradingDisplay?:TradingDisplaySnapshot;
  onTradingIntent?(event:TradingIntentEvent):void;
  shopDisplay?:ShopDisplaySnapshot;
  onShopIntent?(event:ShopIntentEvent):void;
}
export interface MountedProgram {
  setCollectionDisplay(snapshot:CollectionDisplaySnapshot):void;
  setMarketplaceDisplay(snapshot:MarketplaceDisplaySnapshot):void;
  setTradingDisplay(snapshot:TradingDisplaySnapshot):void;
  setShopDisplay(snapshot:ShopDisplaySnapshot):void;
  setInputs(inputs: ProgramInputs): void;
  setAlbumDisplay(snapshot: AlbumDisplaySnapshot): void;
  setOpenerDisplay(snapshot: OpenerDisplaySnapshot): void;
  setEditorDisplay(snapshot:EditorDisplaySnapshot):void;
  setVisibility(value: 'visible' | 'hidden'): void;
  dispose(): void;
}
export declare function programHeaders(assetOrigin: string): Record<string, string>;
export declare function mountProgram(root: HTMLElement, options: ProgramMountOptions): MountedProgram;
export declare function connectProgram(options?: {onInputs?(inputs: ProgramInputs): void; onAlbumDisplay?(snapshot: AlbumDisplaySnapshot): void; onOpenerDisplay?(snapshot: OpenerDisplaySnapshot): void;onEditorDisplay?(snapshot:EditorDisplaySnapshot):void;onCollectionDisplay?(snapshot:CollectionDisplaySnapshot):void;onShopDisplay?(snapshot:ShopDisplaySnapshot):void;onTradingDisplay?(snapshot:TradingDisplaySnapshot):void;onMarketplaceDisplay?(snapshot:MarketplaceDisplaySnapshot):void}): Promise<{
  collectionIntent(event:CollectionIntentEvent):void;
  marketplaceIntent(event:MarketplaceIntentEvent):void;
  tradingIntent(event:TradingIntentEvent):void;
  shopIntent(event:ShopIntentEvent):void;
  editorProposal(snapshotId:string,revision:number,patch:EditorProposal['patch']):void;
  intent(name: string): void;
  selectItem(snapshotId: string, handle: string): void;
  openerIntent(intent: OpenerIntent, snapshotId: string, handle?: string): void;
  dispose(): void;
}>;
import type {CollectionDisplayGrant,CollectionDisplaySnapshot,CollectionIntentEvent} from './collection-display.js';
