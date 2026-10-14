import type {AlbumDisplaySnapshot} from './album-display.js';
export type CollectionDisplayField='cardName'|'line'|'rarity'|'finish'|'tags'|'stats'|'metadata'|'preview';
export interface CollectionDisplayGrant {profile:'dc.collection-display@1';fields:readonly CollectionDisplayField[]}
export interface CollectionQuery {mode:'owned'|'catalog';search:string;line:string;rarity:string;finish:''|'standard'|'gloss'|'holo'|'foil';sort:'newest'|'name'|'rarity';show:'all'|'favorites'|'duplicates'|'available';inserts:boolean}
export interface CollectionDisplayOption {handle:string;label:string}
export interface CollectionDisplayItem {handle:string;position:number;selected:boolean;favorite:boolean;wished:boolean;discovered:boolean;copies:number;reserved:boolean;available:boolean;name?:string;line?:string;rarity?:string;finish?:string;tags?:string[];stats?:Record<string,unknown>;metadata?:Record<string,unknown>}
export interface CollectionDisplaySnapshot {profile:'dc.collection-display@1';snapshotId:string;fields:CollectionDisplayField[];locale:string;dir:'ltr'|'rtl';labels:Record<string,string>;query:CollectionQuery;options:{lines:CollectionDisplayOption[];rarities:CollectionDisplayOption[];recipes:CollectionDisplayOption[]};optionWindows:Record<'lines'|'rarities'|'recipes',{search:string;page:number;hasMore:boolean}>;counts:{discoveries:number;definitions:number;copies:number;matching:number;selected:number};page:number;hasMore:boolean;selected:string[];tradeUps:boolean;busy:boolean;items:CollectionDisplayItem[];previews:AlbumDisplaySnapshot['previews']}
export type CollectionIntentEvent={snapshotId:string}&({intent:'collection-query';query:CollectionQuery}|{intent:'collection-options';kind:'lines'|'rarities'|'recipes';search:string;page:number}|{intent:'collection-more';direction:1|-1}|{intent:'collection-inspect'|'collection-favorite'|'collection-wishlist';handle:string}|{intent:'collection-select';handle:string;selected:boolean}|{intent:'collection-clear'|'collection-compare'}|{intent:'collection-tradeup-review';recipe:string});
export declare const collectionDisplayProfile:'dc.collection-display@1';
export declare const collectionDisplayFields:readonly CollectionDisplayField[];
export declare const collectionDisplayLimits:Readonly<Record<string,number>>;
export declare const collectionDisplayLabelKeys:readonly string[];
export declare const collectionIntents:readonly CollectionIntentEvent['intent'][];
export declare const collectionDisplaySchema:Readonly<Record<string,unknown>>;
export declare function validateCollectionQuery(value:unknown):CollectionQuery;
export declare function validateCollectionDisplay(value:unknown):CollectionDisplaySnapshot;
export declare function validateCollectionIntent(value:unknown,snapshot?:CollectionDisplaySnapshot):CollectionIntentEvent;
