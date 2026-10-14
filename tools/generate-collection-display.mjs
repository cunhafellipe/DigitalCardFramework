import {readFileSync,writeFileSync} from 'node:fs';
import {collectionDisplaySchema} from '../src/presentation/collection-display.js';
const path=new URL('../docs/collection-display.schema.json',import.meta.url);
const content=JSON.stringify(collectionDisplaySchema,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('Collection display schema drift');}
else writeFileSync(path,content);
