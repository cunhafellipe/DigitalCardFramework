import {bindingFactorySchema} from '../src/binding-factory-contracts.js';
import {codeIssuanceSchema} from '../src/code-issuance-contracts.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {allocationStrategySchema,allocationStrategyV2Schema,allocationStrategyV3Schema,allocationStrategyV4Schema} from '../src/allocation-strategy-contracts.js';
import {stockAllocationStrategySchema,stockAllocationStrategyV2Schema,stockAllocationStrategyV3Schema,stockAllocationStrategyV4Schema} from '../src/stock-allocation-strategy-contracts.js';
import {externalAllocationStrategySchema,externalAllocationStrategyV2Schema,externalAllocationStrategyV3Schema,externalAllocationStrategyV4Schema} from '../src/external-allocation-strategy-contracts.js';
for(const [filename,schema] of [['binding-factory.schema.json',bindingFactorySchema],['code-issuance.schema.json',codeIssuanceSchema],['allocation-strategy.schema.json',allocationStrategySchema],['stock-allocation-strategy.schema.json',stockAllocationStrategySchema],['external-allocation-strategy.schema.json',externalAllocationStrategySchema],['allocation-strategy-v2.schema.json',allocationStrategyV2Schema],['stock-allocation-strategy-v2.schema.json',stockAllocationStrategyV2Schema],['external-allocation-strategy-v2.schema.json',externalAllocationStrategyV2Schema],['allocation-strategy-v3.schema.json',allocationStrategyV3Schema],['stock-allocation-strategy-v3.schema.json',stockAllocationStrategyV3Schema],['external-allocation-strategy-v3.schema.json',externalAllocationStrategyV3Schema],['allocation-strategy-v4.schema.json',allocationStrategyV4Schema],['stock-allocation-strategy-v4.schema.json',stockAllocationStrategyV4Schema],['external-allocation-strategy-v4.schema.json',externalAllocationStrategyV4Schema]]){
  const path=new URL('../docs/'+filename,import.meta.url),content=JSON.stringify(schema,null,2)+'\n';
  if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('Allocation strategy schema drift: '+filename);}
  else writeFileSync(path,content);
}
