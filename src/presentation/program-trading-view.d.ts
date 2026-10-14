import type {ProgramRegistry} from './program.js';
import type {TradingDisplayField} from './trading-display.js';
import type {Localization} from '../localization.js';
import type {Schemas} from '../wire-types.js';
export interface ProgramTradingModel {catalog:Schemas['CatalogManifest'];me:{userId:string};trades:Schemas['Trade'][]}
export interface ProgramTradingContext {state?:object;localization?:Localization;client:Record<string,any>;cardRenderer:Function;inspect:Function;mutate:Function;action(fn:()=>Promise<unknown>,options?:{refreshAfter?:boolean;message?:string|Function}):Promise<unknown>;refresh():Promise<unknown>;getPrincipal?():string|null;isCurrentModel?(model:ProgramTradingModel):boolean;isActionBusy?():boolean;storage?:Storage}
export interface ProgramTradingInstance {node:HTMLElement;dispose():void}
export interface ProgramTradingView {(model:ProgramTradingModel,context:ProgramTradingContext):ProgramTradingInstance;setEnabled(value:boolean):void;dispose():void}
export interface ProgramTradingOptions {registry:ProgramRegistry;programId:string;displayFields?:readonly TradingDisplayField[];fallbackRenderer?(model:ProgramTradingModel,context:ProgramTradingContext,session:unknown):HTMLElement|ProgramTradingInstance;viewportHeight?:number;maxActivePrograms?:number;handshakeTimeout?:number;maxMessagesPerSecond?:number;onDiagnostic?(event:{code:string;programId:string}):void}
export declare function createProgramTradingView(options:ProgramTradingOptions):ProgramTradingView;
