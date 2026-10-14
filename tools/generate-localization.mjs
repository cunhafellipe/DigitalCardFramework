import {readFileSync,writeFileSync} from 'node:fs';
import {localizationSchema,localizationKeys} from '../src/localization.js';
const keys=Object.keys(localizationKeys).map(key=>JSON.stringify(key)).join(' | ');
const declarations=`export type LocalizationKey = ${keys};
export type LocalizationPlural = Partial<Record<'zero'|'one'|'two'|'few'|'many', string>> & {other: string};
export type LocalizationMessages = Partial<Record<LocalizationKey, string | LocalizationPlural>>;
export interface LocalizationBundle { readonly protocol: 'digital-card-localization@1'; readonly locale: string; readonly messages: Readonly<LocalizationMessages>; }
export interface Localization { readonly locale: string; readonly dir: 'ltr'|'rtl'; text(key: LocalizationKey, values?: Record<string,string|number>): string; number(value: number): string; date(value: string|number|Date): string; }
export declare const localizationProtocol: 'digital-card-localization@1';
export declare const localizationSchema: Readonly<Record<string,unknown>>;
export declare const localizationKeys: Readonly<Record<LocalizationKey,{readonly placeholders: readonly string[]; readonly plural: boolean}>>;
export declare const englishMessages: Readonly<Record<LocalizationKey,string|LocalizationPlural>>;
export declare function validateLocalizationBundle(input: unknown): LocalizationBundle;
export declare const diagnosticKeys: Readonly<Record<string,LocalizationKey>>;
export declare function localizeDiagnostic(localization: Localization, error: unknown): string;
export declare function createLocalization(options?: {locale?: string; messages?: LocalizationMessages}): Localization;
`;
for(const [name,content]of [['docs/localization.contract.json',JSON.stringify(localizationSchema,null,2)+'\n'],['src/localization.d.ts',declarations]]){
 const path=new URL('../'+name,import.meta.url);
 if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('Localization contract drift: '+name);}else writeFileSync(path,content);
}
