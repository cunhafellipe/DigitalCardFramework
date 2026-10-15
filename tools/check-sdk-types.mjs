import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const compiler=process.env.DC_TYPESCRIPT_COMPILER??fileURLToPath(new URL('./lib/tsc.js',import.meta.resolve('typescript/package.json')));
const result=spawnSync(process.execPath,[compiler,'--strict','--noUncheckedIndexedAccess','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--lib','ES2022,DOM','--noEmit','src/admin-client.ts','src/client.ts','src/wire-client.ts','src/trade-client.ts','test/sdk-consumer.ts','test/client-consumer.ts','test/trade-client-consumer.ts','test/capability-consumer.ts','test/admin-consumer.ts','test/mask-consumer.ts','test/action-consumer.ts','test/group-consumer.ts','test/pack-artwork-consumer.ts','test/album-artwork-consumer.ts','test/plugin-consumer.ts','test/plugin-deployment-consumer.ts','test/editor-contribution-consumer.ts','test/localization-consumer.ts','test/program-consumer.ts','test/access-provider-consumer.ts','test/collection-display-consumer.ts','test/import-executor-consumer.ts','test/wasm-pixels-consumer.ts','test/program-shop-consumer.ts','test/program-trading-consumer.ts','test/program-marketplace-consumer.ts','test/application-shell-consumer.ts','test/policy-contracts-consumer.ts','test/provider-contracts-consumer.ts','test/allocation-contracts-consumer.ts'],{stdio:'inherit',cwd:fileURLToPath(new URL('../',import.meta.url))});
if(result.error)throw result.error;
if(result.status!==0)process.exitCode=result.status??1;
else{
  for(const generator of ['generate-wire-types.mjs','generate-wire-validators.mjs','generate-action-contracts.mjs','generate-allocation-contracts.mjs','generate-editor-contributions.mjs','generate-editor-display.mjs','generate-collection-display.mjs','generate-shop-display.mjs','generate-trading-display.mjs','generate-marketplace-display.mjs','generate-application-shell.mjs','generate-access-provider.mjs','generate-localization.mjs','generate-plugin-contracts.mjs','generate-plugin-manifest.mjs']){
    const checked=spawnSync(process.execPath,[fileURLToPath(new URL(generator,import.meta.url)),'--check'],{stdio:'inherit'});
    if(checked.status!==0)throw new Error('Generated contract drift');
  }
  const directory=mkdtempSync(join(tmpdir(),'digital-card-sdk-'));
  try{
    const emitted=spawnSync(process.execPath,[compiler,'--strict','--noUncheckedIndexedAccess','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--lib','ES2022,DOM','--declaration','--rootDir','src','--outDir',directory,'src/admin-client.ts','src/client.ts','src/wire-client.ts','src/trade-client.ts'],{stdio:'inherit',cwd:fileURLToPath(new URL('../',import.meta.url))});
    if(emitted.status!==0)throw new Error('SDK compilation failed');
    for(const filename of ['admin-client.js','admin-client.d.ts','client.js','client.d.ts','wire-client.js','wire-client.d.ts','trade-client.js','trade-client.d.ts'])if(readFileSync(join(directory,filename),'utf8')!==readFileSync(new URL('../src/'+filename,import.meta.url),'utf8'))throw new Error('Generated SDK drift: '+filename);
  }finally{rmSync(directory,{recursive:true,force:true});}
}
