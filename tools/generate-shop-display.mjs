import {readFileSync,writeFileSync} from 'node:fs';
import {shopDisplaySchema} from '../src/presentation/shop-display.js';
const path=new URL('../docs/shop-display.schema.json',import.meta.url);
const content=JSON.stringify(shopDisplaySchema,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('Shop display schema drift');}
else writeFileSync(path,content);
