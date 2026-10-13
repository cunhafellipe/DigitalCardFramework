import {readFileSync,writeFileSync} from 'node:fs';
import {editorContributionSchema} from '../src/presentation/editor-contributions.js';
const path=new URL('../docs/editor-contribution.schema.json',import.meta.url);
const content=JSON.stringify(editorContributionSchema,null,2)+'\n';
if(process.argv.includes('--check')){
  if(readFileSync(path,'utf8')!==content)throw new Error('Editor contribution schema drift');
}else writeFileSync(path,content);
