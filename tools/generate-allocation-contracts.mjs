import {readFileSync,writeFileSync} from 'node:fs';
import {allocationStrategySchema} from '../src/allocation-strategy-contracts.js';
import {stockAllocationStrategySchema} from '../src/stock-allocation-strategy-contracts.js';
import {externalAllocationStrategySchema} from '../src/external-allocation-strategy-contracts.js';
for(const [filename,schema] of [['allocation-strategy.schema.json',allocationStrategySchema],['stock-allocation-strategy.schema.json',stockAllocationStrategySchema],['external-allocation-strategy.schema.json',externalAllocationStrategySchema]]){
  const path=new URL('../docs/'+filename,import.meta.url),content=JSON.stringify(schema,null,2)+'\n';
  if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('Allocation strategy schema drift: '+filename);}
  else writeFileSync(path,content);
}
