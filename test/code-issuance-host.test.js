import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {FrameworkWorkerService} from '../src/framework-worker-service.js';
import {validateCodeIssuanceRequest} from '../src/code-issuance-contracts.js';
import {sampleCatalog} from '../examples/catalog.js';

const admin={role:'admin'},token='synthetic-code-host-credential';
async function stop(child){if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}}
async function child(script,args,env){
  const processChild=spawn(process.execPath,[fileURLToPath(new URL(script,import.meta.url)),...args],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,...env}});processChild.stderr.resume();
  try{const port=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Provider readiness timed out')),10000);processChild.once('error',error=>{clearTimeout(timer);reject(error);});processChild.once('exit',()=>{clearTimeout(timer);reject(Error('Provider exited before readiness'));});processChild.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n')){clearTimeout(timer);resolve(Number(output.trim()));}});});assert(Number.isInteger(port)&&port>0&&port<=65535);return {process:processChild,url:'http://127.0.0.1:'+port};}catch(error){await stop(processChild);throw error;}
}
async function harness(t){
  const directory=await mkdtemp(join(tmpdir(),'code-issuance-host-')),children=[],services=[],servers=[];
  t.after(async()=>{for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}for(const service of services){if(service.status().state==='failed')await service.terminate();else await service.close();}for(const provider of children)await stop(provider.process);await rm(directory,{recursive:true,force:true});});
  const allocation=await child('../examples/plugins/node-allocation-provider.mjs',[],{ALLOCATION_PROVIDER_TOKEN:token,ALLOCATION_PROVIDER_ID:'example.allocation'});children.push(allocation);
  const issuerDatabase=join(directory,'issuer.sqlite');let issuer;
  const startIssuer=async()=>{issuer=await child('../examples/plugins/node-code-issuer.mjs',[issuerDatabase],{CODE_ISSUER_TOKEN:token,CODE_ISSUER_PROVIDER_ID:'example.issuer'});children.push(issuer);};await startIssuer();
  const gateway={calls:[],dropIssue:true};
  const proxy=createServer(async(request,response)=>{
    try{assert.equal(request.url,'/code-issuance');assert.equal(request.headers.authorization,'Bearer '+token);const chunks=[];for await(const chunk of request)chunks.push(chunk);const body=Buffer.concat(chunks),value=validateCodeIssuanceRequest(JSON.parse(body));gateway.calls.push(value);
      const upstream=await fetch(issuer.url+'/code-issuance',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body,signal:AbortSignal.timeout(10000)}),result=Buffer.from(await upstream.arrayBuffer());
      if(value.operation==='issue'&&gateway.dropIssue){gateway.dropIssue=false;assert.equal(upstream.status,200);response.destroy();return;}
      response.writeHead(upstream.status,{'content-type':'application/json'});response.end(result);
    }catch{response.destroy();}
  });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));servers.push(proxy);
  const filename=join(directory,'framework.sqlite'),options={filename,storeOptions:{encryptionKey:Buffer.alloc(32,71)},codeVaultOptions:{activeKeyId:'fixture',keys:{fixture:Buffer.alloc(32,73)},indexKey:Buffer.alloc(32,79)},frameworkOptions:{remoteAllocation:{scope:'catalog-purchase',algorithm:'weighted-deck@3',providerId:'example.allocation',url:allocation.url+'/allocate-packs',token,allowLoopbackHttp:true,timeoutMs:5000},allocationCodeIssuers:{'example.generate':{kind:'external',providerId:'example.issuer',url:'http://127.0.0.1:'+proxy.address().port+'/code-issuance',token,allowLoopbackHttp:true,timeoutMs:5000}}}};
  const startWorker=async()=>{const service=new FrameworkWorkerService(options);services.push(service);await service.ready;return service;};
  const rows=()=>{const db=new DatabaseSync(issuerDatabase,{readOnly:true});try{return db.prepare('SELECT issuance_id,batch_id,state,effect_count FROM issuer_entries ORDER BY issuance_id').all().map(row=>({...row}));}finally{db.close();}};
  return {gateway,startWorker,rows,filename,restartIssuer:async()=>{await stop(issuer.process);await startIssuer();}};
}
async function initialize(service){
  const catalog=structuredClone(sampleCatalog);catalog.version=1;for(const variant of catalog.variants)variant.bindings={};
  catalog.variants.find(variant=>variant.id==='dawn.standard').codes=['first','second'].map(id=>({id,poolId:'generated',transfer:'follow-unrevealed',reveal:'scratch'}));
  catalog.products.push({id:'generated-host',lineId:'sky',name:'Generated reward pack',revision:1,price:{currencyId:'credits',amount:10},allocationStrategy:{algorithm:'weighted-deck@3',version:3,deckScope:'purchase-slot'},slots:[{id:'main',count:1,pool:[{variantId:'dawn.standard',weight:1}]}]});
  await service.publishCatalog(admin,catalog);await service.configureCodePool(admin,{key:'pool',pool:{id:'generated',providerId:'example.issuer',name:'Generated reward',generator:'example.generate'}});
  const actor={userId:(await service.registerUser(admin,{provider:'test',subject:'generated-host',displayName:'Collector'})).id};await service.grantCurrency(admin,{key:'fund',userId:actor.userId,currencyId:'credits',amount:100,reason:'Fixture funding'});return actor;
}
function noMaterial(value){assert(!JSON.stringify(value).includes('SYNTHETIC-CODE-'));}

test('real issuer and encrypted worker restart recover original occurrence identities after a lost issue response',async t=>{
  const x=await harness(t),first=await x.startWorker(),actor=await initialize(first),input={key:'generated-purchase',...await first.quote(actor,{productId:'generated-host',quantity:1})};
  await assert.rejects(first.purchaseAsync(actor,input),error=>{assert.equal(error.code,'CODE_ISSUANCE_PENDING');noMaterial(error);return true;});
  const issuedRequest=x.gateway.calls.find(request=>request.operation==='issue');assert(issuedRequest);const {entries}=issuedRequest.context;assert.equal(entries.length,2);assert.equal(new Set(entries.map(entry=>entry.issuanceId)).size,2);assert.equal(new Set(entries.map(entry=>entry.codeId)).size,2);assert.equal(entries[0].copyId,entries[1].copyId);assert.deepEqual(entries.map(entry=>entry.attachmentIndex),[0,1]);
  assert.deepEqual(x.rows().map(row=>[row.state,row.effect_count]),[['issued',1],['issued',1]]);assert.equal((await first.wallet(actor)).credits,100);assert.deepEqual(await first.packs(actor),[]);
  const pending=await first.codeIssuanceStatus(admin,{batchId:issuedRequest.batchId});assert.equal(pending.state,'pending');assert.equal(pending.counts.pending,2);noMaterial(pending);noMaterial(await first.allocationStatus(actor,{productId:'generated-host'}));
  await first.close();await x.restartIssuer();const second=await x.startWorker();
  const recovered=await second.recoverCodeIssuance(admin,{batchId:issuedRequest.batchId});assert.equal(recovered.state,'issued');assert.equal(recovered.counts.issued,2);noMaterial(recovered);
  const lookup=x.gateway.calls.at(-1);assert.equal(lookup.operation,'lookup');assert.equal(lookup.batchId,issuedRequest.batchId);assert.deepEqual(lookup.context.entries,entries);
  const receipt=await second.purchaseAsync(actor,input);assert.equal(receipt.packs.length,1);noMaterial(receipt);assert.equal((await second.wallet(actor)).credits,90);assert.equal((await second.packs(actor)).length,1);
  assert.deepEqual(await second.purchaseAsync(actor,input),receipt);assert.equal(x.gateway.calls.filter(request=>request.operation==='issue').length,1);assert.deepEqual(x.rows().map(row=>row.effect_count),[1,1]);assert.equal((await second.codeIssuanceStatus(admin,{batchId:issuedRequest.batchId})).state,'attached');
  const opened=await second.openPack(actor,{key:'open-generated',packId:receipt.packs[0].id});assert.equal(opened.cards.length,1);for(const entry of entries){const revealed=await second.revealCode(actor,{key:'reveal-'+entry.attachmentId,codeId:entry.codeId});assert.equal(revealed.code,'SYNTHETIC-CODE-'+entry.issuanceId);}
  assert.equal((await second.audit(admin)).ok,true);await second.close();const bytes=await readFile(x.filename);for(const entry of entries)assert(!bytes.includes(Buffer.from('SYNTHETIC-CODE-'+entry.issuanceId)));
});
