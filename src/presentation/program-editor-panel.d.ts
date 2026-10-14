import type {ProgramRegistry} from './program.js';
import type {EditorField} from './editor-display.js';
export interface ProgramEditorPanel {id:string;programId:string;fields:readonly EditorField[]}
export interface ProgramEditorPanels {
  mount(options:{root:HTMLElement;getSelection():unknown;edit(change:()=>void):unknown;run?(change:()=>Promise<void>):unknown;report?(message:string):void;localization?:{text(key:string):string}}):{render():void;dispose():void};
  setEnabled(id:string,enabled:boolean):void;
  dispose():void;
}
export declare function createProgramEditorPanels(options:{registry:ProgramRegistry;panels:readonly ProgramEditorPanel[];maxActivePrograms?:number;handshakeTimeout?:number;maxMessagesPerSecond?:number}):ProgramEditorPanels;
