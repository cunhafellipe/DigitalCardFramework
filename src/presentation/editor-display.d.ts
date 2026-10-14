export type EditorField='x'|'y'|'rotation'|'width'|'height'|'opacity'|'brightness'|'saturation'|'blend'|'text'|'color'|'typography.size'|'typography.lineHeight'|'typography.letterSpacing'|'typography.align';
export interface EditorDisplayGrant {profile:'dc.editor-selection@1';fields:readonly EditorField[]}
export interface EditorDisplaySnapshot {profile:'dc.editor-selection@1';snapshotId:string;revision:number;side:'front'|'back';nodeType:'image'|'video'|'audio'|'group'|'text'|'adapter';locked:boolean;fields:readonly EditorField[];values:Readonly<Partial<Record<EditorField,string|number>>>}
export interface EditorProposal {snapshotId:string;revision:number;patch:Readonly<Partial<Record<EditorField,string|number>>>}
export declare const editorDisplayProfile:'dc.editor-selection@1';
export declare const editorFields:readonly EditorField[];
export declare const editorDisplaySchema:object;
export declare const editorProposalSchema:object;
export declare function validateEditorFields(fields:unknown):EditorField[];
export declare function validateEditorDisplay(value:unknown):EditorDisplaySnapshot;
export declare function validateEditorProposal(value:unknown,snapshot:EditorDisplaySnapshot):EditorProposal;
