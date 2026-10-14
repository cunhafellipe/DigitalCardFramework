import {readFileSync,writeFileSync} from 'node:fs';
import {tradingDisplaySchema} from '../src/presentation/trading-display.js';
const path=new URL('../docs/trading-display.schema.json',import.meta.url);
const content=JSON.stringify(tradingDisplaySchema,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('Trading display schema drift');}
else writeFileSync(path,content);
