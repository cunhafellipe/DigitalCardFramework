import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createWireTransport} from '../src/wire-client.js';
import {startService} from './fixtures/authoritative-service-host.mjs';
import {fixture as presentationFixture,build} from './presentation-fixtures.mjs';
import {importPackage} from '../src/presentation/package.js';

async function remote(config,observe){
  const child=fork(new URL('./fixtures/authoritative-service-host.mjs',import.meta.url),[],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']}),waiting=new Map();let next=0,stderr='';
  child.stderr.on('data',bytes=>stderr=(stderr+bytes).slice(-4096));
  child.on('message',message=>{if(message.type==='lostReply'){observe(message.value);return;}const request=waiting.get(message.id);if(!request)return;waiting.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Object.assign(Error(message.error.message),{code:message.error.code}));else request.resolve(message.result);});
  child.on('exit',()=>{for(const request of waiting.values()){clearTimeout(request.timer);request.reject(Error('Service exited before reply: '+stderr));}waiting.clear();});
  const call=(command,config)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{waiting.delete(id);child.kill();reject(Error('Service fixture timed out'));},10000);waiting.set(id,{resolve,reject,timer});child.send({id,command,config});});
  const info=await call('start',config);
  return {info,dispatch:()=>call('dispatch'),async close(){if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');await call('close');await ended;}}};
}
function client(info,identity,{truncate=false}={}){
  const actor=identity==='bob'?info.bob:info.alice;
  return createWireTransport({baseUrl:info.origin+'/api',principal:()=>actor.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,connection:'close',origin:info.origin,authorization:'fixture-'+identity,...(truncate?{'x-fixture-truncate':'1'}:{})}})});
}
for(const placement of ['local','independent'])test(placement+' authoritative service preserves acquisition, outbox and original receipts',{timeout:30000},async t=>{
  const root=mkdtempSync(join(tmpdir(),'authoritative-service-')),config={filename:join(root,'framework.sqlite'),encryptionKey:randomBytes(32).toString('hex'),initialize:true};let host,lostReply,observedReceipt;const observed=new Promise(resolve=>{observedReceipt=resolve;});
  const observe=value=>{lostReply=value;observedReceipt(value);};
  const start=()=>placement==='local'?startService(config,observe):remote(config,observe);
  t.after(async()=>{await host?.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe service fixture cleanup target');rmSync(root,{recursive:true,force:true});});host=await start();
  if(placement==='independent')assert.notEqual(host.info.pid,process.pid);
  let alice=client(host.info,'alice'),bob=client(host.info,'bob'),operator=client(host.info,'operator');
  const beforeA=await alice('wallet',undefined),beforeB=await bob('wallet',undefined),quote=await alice('quote',{productId:'common',quantity:1}),input={...quote,key:'original-purchase'};
  const purchase=await alice('purchase',input);assert.deepEqual(await alice('purchase',input),purchase);assert.equal(purchase.packs.length,1);
  const opening={key:'original-opening',packId:purchase.packs[0].id};await assert.rejects(client(host.info,'alice',{truncate:true})('openPack',opening));await observed;assert(lostReply);
  const jobs=await operator('actionJobs',undefined);assert.equal(jobs.total,2);assert(jobs.items.every(job=>job.status==='pending'));assert.deepEqual(jobs.items.map(job=>job.handler).sort(),['fixture.event','fixture.reward']);const originalJobIds=jobs.items.map(job=>job.id).sort();
  assert.equal((await bob('fulfillments',undefined)).total,0);
  const oldInfo=host.info;await host.close();host=null;Object.assign(config,{initialize:false,port:Number(new URL(oldInfo.origin).port),alice:oldInfo.alice,bob:oldInfo.bob});host=await start();alice=client(host.info,'alice');bob=client(host.info,'bob');operator=client(host.info,'operator');
  assert.deepEqual(await alice('purchase',input),purchase);const recovered=await alice('openPack',opening);assert.deepEqual(recovered,lostReply);assert.equal(recovered.cards.length,1);
  assert.deepEqual((await operator('actionJobs',undefined)).items.map(job=>job.id).sort(),originalJobIds);assert.deepEqual((await alice('inventory',undefined)).map(copy=>copy.id),recovered.cards.map(copy=>copy.id));
  await assert.rejects(bob('inspectCard',undefined,{path:{copyId:recovered.cards[0].id}}));await assert.rejects(alice('actionJobs',undefined),{code:'FORBIDDEN'});
  const [quoteA,quoteB]=await Promise.all([alice('quote',{productId:'unique',quantity:1}),bob('quote',{productId:'unique',quantity:1})]);
  const race=await Promise.allSettled([alice('purchase',{...quoteA,key:'last-unit-a'}),bob('purchase',{...quoteB,key:'last-unit-b'})]);assert.equal(race.filter(result=>result.status==='fulfilled').length,1);assert.equal(race.find(result=>result.status==='rejected').reason.code,'POOL_EXHAUSTED');
  const [afterA,afterB,packsA,packsB]=await Promise.all([alice('wallet',undefined),bob('wallet',undefined),alice('packs',undefined),bob('packs',undefined)]);assert.equal(afterA.credits+afterB.credits,beforeA.credits+beforeB.credits-quote.price.amount-quoteA.price.amount);assert.equal(packsA.length+packsB.length,2);
  assert.deepEqual((await operator('actionJobs',undefined)).items.map(job=>job.id).sort(),originalJobIds);assert.deepEqual((await host.dispatch()).sort(),originalJobIds);assert.deepEqual((await host.dispatch()).sort(),originalJobIds);
  assert((await operator('actionJobs',undefined)).items.every(job=>job.status==='succeeded'));assert.equal((await alice('fulfillments',undefined)).total,2);assert.equal((await operator('audit',undefined)).ok,true);
});

for(const placement of ['local','independent'])test(placement+' publication service preserves immutable assets and catalog-last recovery',{timeout:60000},async t=>{
  const root=mkdtempSync(join(tmpdir(),'publication-service-')),config={filename:join(root,'framework.sqlite'),presentationRoot:join(root,'presentations'),encryptionKey:randomBytes(32).toString('hex'),initialize:true};let host,observedPublish;const observed=new Promise(resolve=>{observedPublish=resolve;});
  const start=()=>placement==='local'?startService(config,observedPublish):remote(config,observedPublish);
  t.after(async()=>{await host?.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe publication fixture cleanup target');rmSync(root,{recursive:true,force:true});});host=await start();if(placement==='independent')assert.notEqual(host.info.pid,process.pid);
  let operator=client(host.info,'operator'),alice=client(host.info,'alice');
  const request=(path,{method='GET',bytes,key,identity='operator',truncate=false}={})=>fetch(host.info.origin+'/presentations'+path,{method,headers:{connection:'close',origin:host.info.origin,authorization:'fixture-'+identity,'x-dc-principal':(identity==='bob'?host.info.bob:host.info.alice).userId,...(key?{'idempotency-key':key}:{}),...(truncate?{'x-fixture-truncate':'1'}:{})},body:bytes});
  const upload=async(pkg,key)=>{const response=await request('/imports',{method:'POST',bytes:pkg.archive,key});assert.equal(response.status,200);return response.json();};
  const ready=async job=>{for(let count=0;count<200;count++){const response=await request('/imports/'+job.id);assert.equal(response.status,200);const state=await response.json();if(state.state==='ready'||state.state==='published')return state;if(state.state==='rejected')throw Error(state.error);await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Publication import did not settle');};
  const download=async digest=>{const response=await request('/'+digest+'/download');assert.equal(response.status,200);const bytes=new Uint8Array(await response.arrayBuffer());assert.equal((await importPackage(bytes)).digest,digest);return bytes;};
  const preview=async digest=>{const catalog=await operator('operatorCatalog',undefined),card={...catalog.cards.find(card=>card.id==='dawn'),presentation:{contract:'digital-card@0.1',digest,baseURL:host.info.origin+'/presentations/'+digest+'/files/'}};return operator('previewImport',{source:{cards:[card]},expectedVersion:catalog.version});};
  const first=await build(presentationFixture()),secondFixture=presentationFixture();secondFixture.manifest.title='Second immutable edition';secondFixture.manifest.revision=2;const second=await build(secondFixture);assert.notEqual(first.digest,second.digest);
  assert.equal((await request('/imports',{method:'POST',bytes:first.archive,key:'denied-upload',identity:'alice'})).status,403);
  const firstJob=await upload(first,'first-asset');await ready(firstJob);const firstPublicationResponse=await request('/imports/'+firstJob.id+'/publish',{method:'POST'});assert.equal(firstPublicationResponse.status,200);const firstPublication=await firstPublicationResponse.json(),firstBytes=await download(firstPublication.digest);
  const firstReview=await preview(firstPublication.digest);await operator('commitImport',{...firstReview,key:'first-catalog'});
  const originalQuote=await alice('quote',{productId:'common',quantity:1}),originalPurchase=await alice('purchase',{...originalQuote,key:'old-edition-purchase'}),oldOpening=await alice('openPack',{key:'old-edition-opening',packId:originalPurchase.packs[0].id});assert.equal(oldOpening.cards[0].definition.presentation.digest,firstPublication.digest);
  const secondJob=await upload(second,'second-asset');await ready(secondJob);assert.equal((await upload(second,'second-asset')).id,secondJob.id);
  const changedUpload=await request('/imports',{method:'POST',bytes:first.archive,key:'second-asset'});assert.equal(changedUpload.status,400);assert.equal((await changedUpload.json()).error,'IDEMPOTENCY');assert.equal((await request('/imports/'+secondJob.id,{identity:'bob'})).status,403);assert.equal((await request('/imports/'+secondJob.id+'/publish',{method:'POST',identity:'alice'})).status,403);
  await assert.rejects(async()=>{const response=await request('/imports/'+secondJob.id+'/publish',{method:'POST',truncate:true});assert.equal(response.status,200);await response.json();});const lostPublication=await observed;assert.equal(lostPublication.state,'published');const secondBytes=await download(lostPublication.digest);
  assert.equal((await operator('operatorCatalog',undefined)).cards.find(card=>card.id==='dawn').presentation.digest,firstPublication.digest);
  const oldInfo=host.info;await host.close();host=null;Object.assign(config,{initialize:false,port:Number(new URL(oldInfo.origin).port),alice:oldInfo.alice,bob:oldInfo.bob});host=await start();operator=client(host.info,'operator');alice=client(host.info,'alice');
  assert.equal((await upload(second,'second-asset')).id,secondJob.id);const resumedResponse=await request('/imports/'+secondJob.id+'/publish',{method:'POST'});assert.equal(resumedResponse.status,200);assert.deepEqual(await resumedResponse.json(),lostPublication);assert.deepEqual(await download(lostPublication.digest),secondBytes);assert.deepEqual(await download(firstPublication.digest),firstBytes);
  const review=await preview(lostPublication.digest),commit={...review,key:'second-catalog'};
  await assert.rejects(operator('commitImport',{...commit,expectedVersion:review.expectedVersion+1}),{code:'STALE_IMPORT'});assert.equal((await operator('operatorCatalog',undefined)).cards.find(card=>card.id==='dawn').presentation.digest,firstPublication.digest);assert.deepEqual(await download(lostPublication.digest),secondBytes);
  const committed=await operator('commitImport',commit);assert.deepEqual(await operator('commitImport',commit),committed);await assert.rejects(operator('commitImport',{...commit,digest:'0'.repeat(64)}),{code:'IDEMPOTENCY_CONFLICT'});
  assert.equal((await operator('operatorCatalog',undefined)).cards.find(card=>card.id==='dawn').presentation.digest,lostPublication.digest);assert.deepEqual(await alice('openPack',{key:'old-edition-opening',packId:originalPurchase.packs[0].id}),oldOpening);assert.equal((await alice('inventory',undefined)).find(copy=>copy.id===oldOpening.cards[0].id).definition.presentation.digest,firstPublication.digest);
  const nextQuote=await alice('quote',{productId:'common',quantity:1}),nextPurchase=await alice('purchase',{...nextQuote,key:'new-edition-purchase'}),nextOpening=await alice('openPack',{key:'new-edition-opening',packId:nextPurchase.packs[0].id});assert.equal(nextOpening.cards[0].definition.presentation.digest,lostPublication.digest);assert.equal((await operator('audit',undefined)).ok,true);
});
