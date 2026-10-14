import type {AlbumDisplaySnapshot} from './album-display.js';
export type ShopDisplayField='productName'|'line'|'price'|'availability'|'pity'|'allocation'|'rates'|'preview';
export interface ShopDisplayGrant {profile:'dc.shop-display@1';fields:readonly ShopDisplayField[]}
export interface ShopDisplayItem {handle:string;position:number;quantity:number;maxQuantity:number;selected:boolean;reviewable:boolean;recoverable:boolean;name?:string;line?:string;price?:{unitAmount:number;totalAmount:number;currency:string};available?:boolean;window?:string;pity?:string;allocation?:string}
export interface ShopRateRow {position:number;slot:number;draws:number;weight:number;totalWeight:number;remaining:number|null;label:string;value:string}
export interface ShopDisplaySnapshot {profile:'dc.shop-display@1';snapshotId:string;fields:ShopDisplayField[];locale:string;dir:'ltr'|'rtl';labels:Record<string,string>;search:string;page:number;hasMore:boolean;total:number;busy:boolean;items:ShopDisplayItem[];details:{handle:string;page:number;total:number;hasMore:boolean;summary:string;explanation:string;rows:ShopRateRow[]}|null;previews:AlbumDisplaySnapshot['previews']}
export type ShopIntentEvent={snapshotId:string}&({intent:'shop-query';search:string}|{intent:'shop-more'|'shop-rates';direction:1|-1}|{intent:'shop-select';handle:string}|{intent:'shop-quantity'|'shop-review';handle:string;quantity:number});
export declare const shopDisplayProfile:'dc.shop-display@1';
export declare const shopDisplayFields:readonly ShopDisplayField[];
export declare const shopDisplayLimits:Readonly<Record<string,number>>;
export declare const shopDisplayLabelKeys:readonly string[];
export declare const shopIntents:readonly ShopIntentEvent['intent'][];
export declare const shopDisplaySchema:Readonly<Record<string,unknown>>;
export declare function validateShopDisplay(value:unknown):ShopDisplaySnapshot;
export declare function validateShopIntent(value:unknown,snapshot?:ShopDisplaySnapshot):ShopIntentEvent;
