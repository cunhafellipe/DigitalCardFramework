import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {FrameworkWorkerService} from '../src/framework-worker-service.js';
import {validateBindingFactoryRequest} from '../src/binding-factory-contracts.js';
import {sampleCatalog} from '../examples/catalog.js';

const admin={role:'admin'},token='synthetic-binding-host-credential';
async function stop(child){if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}}
async function child(script,args,env){
  const processChild=spawn(process.execPath,[fileURLToPath(new URL(script,import.meta.url)),...args],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,...env}});processChild.stderr.resume();
  try{const port=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Provider readiness timed out')),10000);processChild.once('error',error=>{clearTimeout(timer);reject(error);});processChild.once('exit',()=>{clearTimeout(timer);reject(Error('Provider exited before readiness'));});processChild.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n')){clearTimeout(timer);resolve(Number(output.trim()));}});});assert(Number.isInteger(port)&&port>0&&port<=65535);return {process:processChild,url:'http://127.0.0.1:'+port};}catch(error){await stop(processChild);throw error;}
}
async function harness(t,kind){
  const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'binding-factory-host-')),children=[],services=[],servers=[];
  t.after(async()=>{for(const server of servers){server.closeAllConnections();await new Promise(done=>server.close(done));}for(const service of services){if(service.status().state==='failed')await service.terminate();else await service.close();}for(const provider of children)await stop(provider.process);assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});});
  const allocation=await child('../examples/plugins/node-allocation-provider.mjs',[],{ALLOCATION_PROVIDER_TOKEN:token,ALLOCATION_PROVIDER_ID:'example.allocation'});children.push(allocation);
  const providerDatabase=join(directory,'factory.sqlite');let factory;
  const startFactory=async()=>{factory=await child('../examples/plugins/node-binding-factory.mjs',[providerDatabase],{BINDING_FACTORY_TOKEN:token,BINDING_FACTORY_PROVIDER_ID:'example.binding',BINDING_FACTORY_NAME:'example.reward',BINDING_FACTORY_KIND:kind,BINDING_FACTORY_USER_FIELDS:'["id","displayName"]'});children.push(factory);};await startFactory();
  const gateway={calls:[],allocations:[],dropEffect:true};
  const proxy=createServer(async(request,response)=>{
    try{assert.equal(request.headers.authorization,'Bearer '+token);const chunks=[];for await(const chunk of request)chunks.push(chunk);const body=Buffer.concat(chunks),value=JSON.parse(body);let upstreamUrl;
      if(request.url==='/binding-factory'){validateBindingFactoryRequest(value);gateway.calls.push(value);upstreamUrl=factory.url+'/binding-factory';}else{assert.equal(request.url,'/allocate-packs');gateway.allocations.push(value);upstreamUrl=allocation.url+'/allocate-packs';}
      const upstream=await fetch(upstreamUrl,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body,signal:AbortSignal.timeout(10000)}),result=Buffer.from(await upstream.arrayBuffer());
      if(['provision','activate'].includes(value.operation)&&gateway.dropEffect){gateway.dropEffect=false;assert.equal(upstream.status,200);response.destroy();return;}
      response.writeHead(upstream.status,{'content-type':'application/json','cache-control':'no-store'});response.end(result);
    }catch{response.destroy();}
  });await new Promise(done=>proxy.listen(0,'127.0.0.1',done));servers.push(proxy);
  const url='http://127.0.0.1:'+proxy.address().port;
  const filename=join(directory,'framework.sqlite'),options={filename,storeOptions:{encryptionKey:Buffer.alloc(32,71)},codeVaultOptions:{activeKeyId:'fixture',keys:{fixture:Buffer.alloc(32,73)},indexKey:Buffer.alloc(32,79)},frameworkOptions:{actionOptions:{retryMs:1},remoteAllocation:{scope:'catalog-purchase',algorithm:'weighted-deck@3',providerId:'example.allocation',url:url+'/allocate-packs',token,allowLoopbackHttp:true,timeoutMs:5000},allocationBindingFactories:{'example.reward':{kind,revision:1,userFields:['id','displayName'],providerId:'example.binding',url:url+'/binding-factory',token,allowLoopbackHttp:true,timeoutMs:5000}}}};
  const startWorker=async()=>{const service=new FrameworkWorkerService(options);services.push(service);await service.ready;return service;};
  const rows=()=>{const db=new DatabaseSync(providerDatabase,{readOnly:true});try{return db.prepare('SELECT invocation_id,batch_id,state,effect_count FROM factory_entries ORDER BY invocation_id').all().map(row=>({...row}));}finally{db.close();}};
  return {gateway,startWorker,rows,filename,restartFactory:async()=>{await stop(factory.process);await startFactory();}};
}
async function initialize(service){
  const catalog=structuredClone(sampleCatalog);catalog.version=1;for(const variant of catalog.variants){variant.bindings={};variant.codes=[];variant.onOpen=[];}
  catalog.variants.find(variant=>variant.id==='dawn.standard').bindings={'example.reward':{factory:'example.reward',visibility:'owner',transfer:'retain',data:{}}};
  catalog.products.push({id:'binding-host',lineId:'sky',name:'Binding reward pack',revision:1,price:{currencyId:'credits',amount:10},allocationStrategy:{algorithm:'weighted-deck@3',version:3,deckScope:'purchase-slot'},slots:[{id:'main',count:1,pool:[{variantId:'dawn.standard',weight:1}]}]});
  await service.publishCatalog(admin,catalog);const actor={userId:(await service.registerUser(admin,{provider:'test',subject:'SYNTHETIC-UNGRANTED-SUBJECT',displayName:'SYNTHETIC-GRANTED-NAME'})).id};await service.grantCurrency(admin,{key:'fund',userId:actor.userId,currencyId:'credits',amount:100,reason:'Fixture funding'});return actor;
}
function noPrivateInput(value){const text=JSON.stringify(value);for(const sentinel of ['SYNTHETIC-GRANTED-NAME','SYNTHETIC-UNGRANTED-SUBJECT'])assert(!text.includes(sentinel));}
function noReward(value){assert(!JSON.stringify(value).includes('SYNTHETIC-BINDING-'));}
function granted(request,actor){for(const entry of request.context.entries){assert.deepEqual(entry.input.user,{id:actor.userId,displayName:'SYNTHETIC-GRANTED-NAME'});assert.equal(entry.input.copy.ownerId,actor.userId);assert.equal(entry.copyId,entry.input.copy.id);assert(!JSON.stringify(entry.input).includes('SYNTHETIC-UNGRANTED-SUBJECT'));}}

test('real provision fixture and encrypted worker recover the original input and result after response loss',async t=>{
  const x=await harness(t,'provision'),first=await x.startWorker(),actor=await initialize(first),input={key:'provision-purchase',...await first.quote(actor,{productId:'binding-host',quantity:1})};
  await assert.rejects(first.purchaseAsync(actor,input),error=>{assert.equal(error.code,'BINDING_FACTORY_PENDING');noPrivateInput(error);noReward(error);return true;});
  const original=x.gateway.calls.find(request=>request.operation==='provision');assert(original);assert.equal(original.context.entries.length,1);granted(original,actor);const entry=original.context.entries[0];assert.deepEqual(x.rows().map(row=>[row.state,row.effect_count]),[['ready',1]]);assert.equal((await first.wallet(actor)).credits,100);assert.deepEqual(await first.packs(actor),[]);
  const discovery=await first.allocationStatus(actor,{productId:'binding-host'});assert.equal(discovery.bindingFactoryBatchId,original.batchId);noPrivateInput(discovery);noReward(discovery);noPrivateInput(await first.bindingFactoryStatus(admin,{batchId:original.batchId}));
  await first.close();await x.restartFactory();const second=await x.startWorker(),recovered=await second.recoverBindingFactories(admin,{batchId:original.batchId});assert.equal(recovered.state,'ready');noPrivateInput(recovered);noReward(recovered);const lookup=x.gateway.calls.at(-1);assert.equal(lookup.operation,'lookup');assert.equal(lookup.batchId,original.batchId);assert.deepEqual(lookup.context.entries,original.context.entries);
  const receipt=await second.purchaseAsync(actor,input);assert.equal(receipt.packs.length,1);assert.equal((await second.wallet(actor)).credits,90);assert.deepEqual(await second.purchaseAsync(actor,input),receipt);assert.equal(x.gateway.calls.filter(request=>request.operation==='provision').length,1);assert.deepEqual(x.rows().map(row=>row.effect_count),[1]);
  await second.openPack(actor,{key:'open-provision',packId:receipt.packs[0].id});const bindings=await second.bindings(actor);assert.equal(bindings.length,1);assert.equal(bindings[0].copyId,entry.copyId);assert.equal(bindings[0].state,'active');assert.equal(bindings[0].data.value,'SYNTHETIC-BINDING-'+entry.invocationId);assert.equal((await second.bindingFactoryStatus(admin,{batchId:original.batchId})).counts.attached,1);
  for(const request of x.gateway.allocations){noPrivateInput(request);noReward(request);assert(!Object.hasOwn(request.context,'input'));}assert.equal((await second.audit(admin)).ok,true);await second.close();const bytes=await readFile(x.filename);for(const material of ['SYNTHETIC-GRANTED-NAME','SYNTHETIC-UNGRANTED-SUBJECT','SYNTHETIC-BINDING-'+entry.invocationId])assert(!bytes.includes(Buffer.from(material)));
});

test('irreversible activation starts after encrypted purchase commit and recovers its original job result once',async t=>{
  const x=await harness(t,'activation'),first=await x.startWorker(),actor=await initialize(first),quote=await first.quote(actor,{productId:'binding-host',quantity:1});assert.deepEqual(quote.bindingActivation,{maximum:1});const input={key:'activation-purchase',...quote},receipt=await first.purchaseAsync(actor,input);
  assert.deepEqual(receipt.bindingActivation,{state:'pending',count:1});assert.equal(x.gateway.calls.filter(request=>request.operation==='activate').length,0);assert.equal(x.rows().length,0);assert.equal((await first.wallet(actor)).credits,90);assert.equal((await first.packs(actor)).length,1);noPrivateInput(receipt);noReward(receipt);
  const discovery=await first.allocationStatus(actor,{productId:'binding-host'});assert(discovery.bindingFactoryBatchId);await first.openPack(actor,{key:'open-activation',packId:receipt.packs[0].id});const [pending]=await first.bindings(actor);assert.equal(pending.state,'activation-pending');assert(!Object.hasOwn(pending,'data'));noReward(pending);await assert.rejects(first.consumeBinding(actor,{key:'premature-use',copyId:pending.copyId,namespace:pending.namespace}),{code:'BINDING_PENDING'});
  await first.dispatchActions(admin,{limit:1});const original=x.gateway.calls.find(request=>request.operation==='activate');assert(original);assert.equal(original.context.entries[0].copyId,pending.copyId);granted(original,actor);assert.deepEqual(x.rows().map(row=>[row.state,row.effect_count]),[['ready',1]]);assert.equal((await first.bindings(actor))[0].state,'activation-pending');
  await first.close();await x.restartFactory();const second=await x.startWorker(),recovered=await second.recoverBindingFactories(admin,{batchId:discovery.bindingFactoryBatchId});assert.equal(recovered.counts.attached,1);noPrivateInput(recovered);noReward(recovered);const lookup=x.gateway.calls.at(-1);assert.equal(lookup.operation,'lookup');assert.deepEqual(lookup.context.entries,original.context.entries);
  const [active]=await second.bindings(actor);assert.equal(active.state,'active');assert.equal(active.data.value,'SYNTHETIC-BINDING-'+original.context.entries[0].invocationId);assert.deepEqual(await second.purchaseAsync(actor,input),receipt);assert.equal((await second.wallet(actor)).credits,90);assert.equal(x.gateway.calls.filter(request=>request.operation==='activate').length,1);assert.deepEqual(x.rows().map(row=>row.effect_count),[1]);
  const use={key:'use-activated',copyId:active.copyId,namespace:active.namespace},used=await second.consumeBinding(actor,use);assert.equal(used.state,'used');assert.deepEqual(await second.consumeBinding(actor,use),used);await assert.rejects(second.consumeBinding(actor,{...use,key:'use-twice'}),{code:'ALREADY_USED'});
  for(const request of x.gateway.allocations){noPrivateInput(request);noReward(request);}assert.equal((await second.audit(admin)).ok,true);await second.close();const bytes=await readFile(x.filename);assert(!bytes.includes(Buffer.from(active.data.value)));assert(!bytes.includes(Buffer.from('SYNTHETIC-GRANTED-NAME')));
});
