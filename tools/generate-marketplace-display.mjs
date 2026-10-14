import {readFileSync,writeFileSync} from 'node:fs';
import {marketplaceDisplaySchema} from '../src/presentation/marketplace-display.js';
const path=new URL('../docs/marketplace-display.schema.json',import.meta.url);
const content=JSON.stringify(marketplaceDisplaySchema,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('Marketplace display schema drift');}
else writeFileSync(path,content);
