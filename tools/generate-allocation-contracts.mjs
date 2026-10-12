import {readFileSync,writeFileSync} from 'node:fs';
import {allocationStrategySchema} from '../src/allocation-strategy-contracts.js';
const path=new URL('../docs/allocation-strategy.schema.json',import.meta.url);
const content=JSON.stringify(allocationStrategySchema,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('Allocation strategy schema drift');}
else writeFileSync(path,content);
