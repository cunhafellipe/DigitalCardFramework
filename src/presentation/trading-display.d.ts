import type {AlbumDisplaySnapshot} from './album-display.js';
export type TradingDisplayField='participantName'|'cardName'|'line'|'rarity'|'eligibility'|'currency'|'message'|'offerStatus'|'dates'|'preview';
export interface TradingDisplayGrant {profile:'dc.trading-display@1';fields:readonly TradingDisplayField[]}
export interface TradingWindow<T> {page:number;total:number;hasPrevious:boolean;hasMore:boolean;items:T[]}
export interface TradingParticipant {handle:string;position:number;selected:boolean;name?:string;private?:boolean}
export interface TradingCard {handle:string;position:number;selected:boolean;eligible:boolean;remoteReviewRequired:boolean;inspectable:boolean;name?:string;line?:string;rarity?:string;reason?:string}
export interface TradingCurrency {handle:string;position:number;name?:string;give?:number;receive?:number}
export interface TradingOffer {handle:string;position:number;selected:boolean;relation:'sent'|'received';accept:boolean;counter:boolean;cancel:boolean;decline:boolean;cardCounts:{give:number;receive:number};currencyCounts:{give:number;receive:number};status?:string;from?:string;to?:string;message?:string;created?:string;expires?:string}
export interface TradingDisplaySnapshot {profile:'dc.trading-display@1';snapshotId:string;fields:TradingDisplayField[];locale:string;dir:'ltr'|'rtl';labels:Record<string,string>;busy:boolean;trading:boolean;cardTrading:boolean;currencyTrading:boolean;phase:'idle'|'loading'|'ready'|'error';reviewPhase:'idle'|'pending'|'allowed'|'error';composingCounter:boolean;reviewRequestable:boolean;recipient:{selected:true;name?:string;private?:boolean}|null;directory:TradingWindow<TradingParticipant>&{search:string};inventories:Record<'give'|'receive',TradingWindow<TradingCard>&{search:string;hasBackendMore:boolean;private?:boolean}>;trays:Record<'give'|'receive',TradingCard[]>;currencies:TradingWindow<TradingCurrency>;offers:TradingWindow<TradingOffer>;details:{offerHandle:string;cards:Record<'give'|'receive',TradingWindow<TradingCard>>;currencies:TradingWindow<TradingCurrency>}|null;previews:AlbumDisplaySnapshot['previews'];message?:string;error?:string}
export type TradingIntentEvent={snapshotId:string}&({intent:'directory-query';search:string}|{intent:'directory-page'|'currency-page'|'offers-page'|'offer-currencies-page';direction:1|-1}|{intent:'recipient-select'|'offer-select'|'offer-counter';handle:string}|{intent:'inventory-query';side:'give'|'receive';search:string}|{intent:'inventory-page'|'offer-cards-page';side:'give'|'receive';direction:1|-1}|{intent:'card-add'|'card-remove'|'card-inspect';side:'give'|'receive';handle:string}|{intent:'currency-set';side:'give'|'receive';handle:string;amount:number}|{intent:'message-set';message:string}|{intent:'draft-clear'|'draft-review'}|{intent:'offer-review';handle:string;action:'accept'|'cancel'|'decline'});
export declare const tradingDisplayProfile:'dc.trading-display@1';
export declare const tradingDisplayFields:readonly TradingDisplayField[];
export declare const tradingDisplayLimits:Readonly<Record<string,number>>;
export declare const tradingDisplayLabelKeys:readonly string[];
export declare const tradingIntents:readonly TradingIntentEvent['intent'][];
export declare const tradingDisplaySchema:Readonly<Record<string,unknown>>;
export declare function validateTradingDisplay(value:unknown):TradingDisplaySnapshot;
export declare function validateTradingIntent(value:unknown,snapshot?:TradingDisplaySnapshot):TradingIntentEvent;
