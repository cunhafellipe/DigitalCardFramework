import {readFileSync,writeFileSync} from 'node:fs';
import {applicationShellSchema} from '../src/application-shell.js';
const target=new URL('../docs/application-shell.schema.json',import.meta.url);
const output=JSON.stringify(applicationShellSchema,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==output)throw new Error('Application shell schema drift');}
else writeFileSync(target,output);
