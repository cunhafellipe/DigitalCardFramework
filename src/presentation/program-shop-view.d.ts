import type {ProgramRegistry} from './program.js';
import type {ShopDisplayField} from './shop-display.js';
import type {Localization} from '../localization.js';
import type {Schemas} from '../wire-types.js';
export interface ProgramShopModel {catalog:Schemas['CatalogManifest'];me:{userId:string};wallet:Record<string,number>;pity:Record<string,number>;availability?:{products:{id:string;available:boolean}[];variants:{id:string;remaining:number|null}[]}}
export interface ProgramShopContext {state?:object;localization?:Localization;client:Record<string,any>;mutate:Function;action(fn:()=>Promise<unknown>,options?:{refreshAfter?:boolean;message?:string|Function}):Promise<unknown>;refresh():Promise<unknown>;getPrincipal?():string|null;isCurrentModel?(model:ProgramShopModel):boolean;isActionBusy?():boolean;packArt?:Function;onPurchased?():void}
export interface ProgramShopInstance {node:HTMLElement;dispose():void}
export interface ProgramShopView {(model:ProgramShopModel,context:ProgramShopContext):ProgramShopInstance;setEnabled(value:boolean):void;dispose():void}
export interface ProgramShopOptions {registry:ProgramRegistry;programId:string;displayFields?:readonly ShopDisplayField[];fallbackRenderer?(model:ProgramShopModel,context:ProgramShopContext):HTMLElement|ProgramShopInstance;viewportHeight?:number;maxActivePrograms?:number;handshakeTimeout?:number;maxMessagesPerSecond?:number;onDiagnostic?(event:{code:string;programId:string}):void}
export declare function createProgramShopView(options:ProgramShopOptions):ProgramShopView;
