import type {ProgramRegistry} from './program.js';
import type {MarketplaceDisplayField} from './marketplace-display.js';
import type {MarketplaceContext,MarketplaceModel,MarketplaceSession} from '../marketplace-session.js';
export type ProgramMarketplaceModel=MarketplaceModel;
export type ProgramMarketplaceContext=MarketplaceContext;
export interface ProgramMarketplaceInstance {node:HTMLElement;ready?:Promise<unknown>;dispose():void}
export interface ProgramMarketplaceView {(model:ProgramMarketplaceModel,context:ProgramMarketplaceContext):ProgramMarketplaceInstance;setEnabled(value:boolean):void;dispose():void}
export interface ProgramMarketplaceOptions {registry:ProgramRegistry;programId:string;displayFields?:readonly MarketplaceDisplayField[];fallbackRenderer?(model:ProgramMarketplaceModel,context:ProgramMarketplaceContext,session:MarketplaceSession):HTMLElement|ProgramMarketplaceInstance;viewportHeight?:number;maxActivePrograms?:number;handshakeTimeout?:number;maxMessagesPerSecond?:number;onDiagnostic?(event:{code:string;programId:string}):void}
export declare function createProgramMarketplaceView(options:ProgramMarketplaceOptions):ProgramMarketplaceView;
