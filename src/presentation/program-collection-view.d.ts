import type {ProgramRegistry} from './program.js';
import type {CollectionDisplayField} from './collection-display.js';
import type {Localization} from '../localization.js';
import type {Schemas} from '../wire-types.js';
type CardCopy=Schemas['InventoryCopy'];
type Catalog=Schemas['CatalogManifest'];
type Participant={userId:string;preferences?:{favoriteCopyIds?:string[];wishlistCardIds?:string[]}};
export interface ProgramCollectionModel {catalog:Catalog;inventory:CardCopy[];me:Participant}
export interface ProgramCollectionContext {state?:object;localization?:Localization;inspect?(copy:CardCopy):void;inspectTogether?(copies:CardCopy[]):void;action(fn:()=>Promise<unknown>,options?:{message?:string}):Promise<unknown>;mutate(command:'preferences'|'tradeUp',input:Record<string,unknown>):Promise<unknown>;getPrincipal?():string|null;isCurrentModel?(model:ProgramCollectionModel):boolean;isActionBusy?():boolean;cardRenderer?:Function}
export interface ProgramCollectionInstance {node:HTMLElement;dispose():void}
export interface ProgramCollectionView {(model:ProgramCollectionModel,context:ProgramCollectionContext):ProgramCollectionInstance;setEnabled(value:boolean):void;dispose():void}
export interface ProgramCollectionOptions {registry:ProgramRegistry;programId:string;displayFields?:readonly CollectionDisplayField[];fallbackRenderer?(model:ProgramCollectionModel,context:ProgramCollectionContext):HTMLElement|ProgramCollectionInstance;viewportHeight?:number;maxActivePrograms?:number;handshakeTimeout?:number;maxMessagesPerSecond?:number;onDiagnostic?(event:{code:string;programId:string}):void}
export declare function createProgramCollectionView(options:ProgramCollectionOptions):ProgramCollectionView;
