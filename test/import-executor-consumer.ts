import {createImportExecutor,type ImportIsolationOptions} from '@digital-card/framework/presentation/import-executor';
const options:ImportIsolationOptions={backend:'windows-job',memoryBytes:512*1024**2,aggregateMemoryBytes:1024*1024**2};
async function qualify(){
 const executor=await createImportExecutor(options);
 try{
  await executor.validate('input.dcard',{timeoutMs:30000,signal:new AbortController().signal});
  await executor.publish('input.dcard',{contentRoot:'published',expectedDigest:'sha256:example'});
 }finally{await executor.close();}
}
void qualify;
// @ts-expect-error A sampling watchdog is not an enforced execution backend.
const unsupported:ImportIsolationOptions={backend:'rss-poll'};
// @ts-expect-error Publication requires an explicit output root.
void createImportExecutor(options).then(executor=>executor.publish('input.dcard',{}));
void unsupported;
