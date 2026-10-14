import {readFileSync,writeFileSync} from 'node:fs';
import {accessProviderSchema} from '../src/access-provider-contracts.js';
const path=new URL('../docs/access-provider.schema.json',import.meta.url);
const content=JSON.stringify(accessProviderSchema,null,2)+'\n';
if(process.argv.includes('--check')){
  if(readFileSync(path,'utf8')!==content)throw new Error('Access provider schema drift');
}else writeFileSync(path,content);
