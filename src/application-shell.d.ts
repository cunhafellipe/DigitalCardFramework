export type ApplicationShellRegion='account'|'balances'|'statistics'|'navigation'|'status'|'recovery'|'content'|'overlays';
export type ApplicationShellToken='bg'|'panel'|'text'|'muted'|'accent'|'border'|'button-text'|'card-text';
export interface ApplicationShellLayout {
  gap?:number; padding?:number; columns?:number; grow?:0|1;
  align?:'start'|'center'|'end'|'stretch'; justify?:'start'|'center'|'end'|'space-between';
  color?:ApplicationShellToken; background?:ApplicationShellToken;
}
export interface ApplicationShellResponsive extends ApplicationShellLayout {flow?:'row'|'column'|'grid'}
interface Styled {layout?:ApplicationShellLayout;narrow?:ApplicationShellResponsive;wide?:ApplicationShellResponsive}
export interface ApplicationShellContainer extends Styled {type:'row'|'column'|'grid';children:ApplicationShellNode[]}
export interface ApplicationShellHeading extends Styled {type:'heading';text:string;level?:2|3|4|5|6}
export interface ApplicationShellText extends Styled {type:'text';text:string}
export interface ApplicationShellNativeRegion extends Styled {type:'region';name:Exclude<ApplicationShellRegion,'navigation'|'overlays'>}
export interface ApplicationShellNavigation extends Styled {type:'region';name:'navigation';arrangement?:'horizontal'|'vertical';groups?:Array<{label?:string;entries:Array<{section:string;label?:string}>}>}
export interface ApplicationShellOverlays {type:'region';name:'overlays'}
export type ApplicationShellNode=ApplicationShellContainer|ApplicationShellHeading|ApplicationShellText|ApplicationShellNativeRegion|ApplicationShellNavigation|ApplicationShellOverlays;
export interface ApplicationShell {profile:'dc.application-shell@1';tree:ApplicationShellContainer}
export type ApplicationShellSource=ApplicationShell|PromiseLike<ApplicationShell|null>|null;
export interface ApplicationShellMountOptions {shell?:ApplicationShellSource}
export interface ApplicationShellMounted {readonly shellReady:Promise<boolean>;setShell(source:ApplicationShellSource):Promise<boolean>}
export const applicationShellProfile:'dc.application-shell@1';
export const applicationShellLimits:Readonly<{bytes:32768;nodes:64;depth:8;text:500;sections:64;groups:16}>;
export const applicationShellSchema:Record<string,unknown>;
export function validateApplicationShell(value:unknown):ApplicationShell;
export function loadApplicationShell(url:string|URL,options?:{fetch?:typeof globalThis.fetch;signal?:AbortSignal}):Promise<ApplicationShell>;
