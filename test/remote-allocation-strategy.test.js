import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {CardFramework} from '../src/core.js';
import {MemoryStore} from '../src/store.js';
import {SQLiteStore} from '../src/sqlite.js';
import {FrameworkWorkerService} from '../src/framework-worker-service.js';
import {createApiHandler} from '../src/http.js';
import {planAllocation} from '../src/allocation-planner.js';
import {validateAllocationStrategyRequest} from '../src/allocation-strategy-contracts.js';
import {contentDigest} from '../src/importer.js';
import {fixture,admin} from './helpers.js';

const selector={algorithm:'weighted-deck@1',version:1,deckScope:'purchase-slot'},token='synthetic-allocation-credential',code=expected=>e=>e.code===expected;
const config=(url,options={})=>({scope:'catalog-purchase',algorithm:'weighted-deck@1',providerId:'example.allocation',url,token,allowLoopbackHttp:true,...options});
const identity=data=>Object.fromEntries(Object.entries(data).filter(([key])=>key!=='context'));
const planned=data=>({...identity(data),status:'planned',allocations:planAllocation(data.context)});
const reply=(res,data)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function withProvider(handler,run){const calls=[],server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=JSON.parse(Buffer.concat(chunks));validateAllocationStrategyRequest(data);assert.equal(req.headers.authorization,'Bearer '+token);calls.push(data);await handler(req,res,data);}catch{res.destroy();}});await new Promise(done=>server.listen(0,'127.0.0.1',done));try{await run('http://127.0.0.1:'+server.address().port+'/allocate',calls);}finally{server.closeAllConnections();await new Promise(done=>server.close(done));}}
function setup(url,{store=new MemoryStore(),options={},change}={}){let random=0,factories=0;const x=fixture({store,random:()=>{random++;return 0;},bindings:{'demo.code':()=>{factories++;return {material:'SYNTHETIC-PRIVATE-DATA'};}},change(c){for(const v of c.variants)v.bindings={};const p=c.products.find(p=>p.id==='common');p.allocationStrategy=selector;p.slots=[{id:'main',count:1,pool:[{variantId:'dawn.standard',weight:2},{variantId:'cloud.standard',weight:1}]}];change?.(c,p);}}),native=x.core;
  x.core=new CardFramework({store,random:()=>{random++;return 0;},remoteAllocation:config(url,options)});store.prepareRecordTransactions();return {...x,native,store,counts:()=>({random,factories}),input:{key:'allocate',...x.core.quote(x.alice,{productId:'common',quantity:3})}};
}
const business=x=>x.store.query(q=>contentDigest(Object.fromEntries(['copies','packs','supply','balances','requests','ledger','events'].map(name=>[name,q.value(name)??{}]))));
const unchanged=(x,before,counts)=>{assert.equal(business(x),before);assert.deepEqual(x.counts(),counts);assert.equal(x.core.audit(admin).ok,true);};

for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' external weighted deck replaces independent draws and commits plan, receipt, cursor and outbox once',async()=>{
  await withProvider((_req,res,data)=>reply(res,planned(data)),async(url,calls)=>{
    const x=setup(url,{store:new Store(':memory:')});try{
      const before=x.counts(),materialized=Store===SQLiteStore?x.store.diagnostics().compatibilityMaterializations:0;assert.throws(()=>x.core.purchase(x.alice,x.input),code('ALLOCATION_ASYNC_REQUIRED'));
      const [a,b]=await Promise.all([x.core.purchaseAsync(x.alice,x.input),x.core.purchaseAsync(x.alice,x.input)]);assert.deepEqual(a,b);assert.equal(calls.length,1);assert.equal(a.packs.length,3);assert.deepEqual(x.counts(),before);
      const variants=x.store.query(q=>q.value('copies'));assert.equal(Object.values(variants).filter(c=>c.variantId==='dawn.standard').length,2);assert.equal(Object.values(variants).filter(c=>c.variantId==='cloud.standard').length,1);
      const journal=x.store.query(q=>Object.values(q.value('allocationAttempts'))[0]),head=x.store.query(q=>q.get('allocationHeads',journal.headId)),receipt=x.store.query(q=>q.get('requests',x.alice.userId+':allocate'));assert.deepEqual(journal.result,a);assert.equal(journal.plan.length,3);assert.equal(head.cursor,1);assert.equal(head.seed,null);assert.equal(receipt.allocationAttemptId,journal.id);assert.equal(x.core.events(admin).filter(e=>e.type==='packs.purchased').length,1);
      const status=x.core.allocationStatus(x.alice,{productId:'common'});assert.equal(status.state,'completed');assert.throws(()=>x.core.acknowledgeAllocation(x.alice,{attemptId:status.attemptId}),code('ALLOCATION_COMPLETED'));assert(!JSON.stringify(status).includes(calls[0].context.entropy.seed));assert(!JSON.stringify(a).includes('variantIds'));x.core.setRemoteAllocationEnabled(admin,{enabled:false});assert.deepEqual(await x.core.purchaseAsync(x.alice,x.input),a);assert.deepEqual(x.core.purchase(x.alice,x.input),a);assert.equal(calls.length,1);
      await assert.rejects(x.core.purchaseAsync({...x.alice,disabled:true},x.input),code('UNAUTHENTICATED'));assert.equal(x.core.audit(admin).ok,true);
    }finally{x.core.close();}
  });
});

test('timeout, disable, generation and cancellation retain the private seed and never debit or advance cursor',async()=>{
  for(const mode of ['timeout','disable','generation','cancel']){const started=deferred(),release=deferred();let block=true;
    await withProvider(async(_req,res,data)=>{if(block){started.resolve();await release.promise;}reply(res,planned(data));},async(url,calls)=>{
      const x=setup(url,{options:{timeoutMs:mode==='timeout'?70:1500}}),controller=new AbortController(),before=business(x),counts=x.counts();try{
        const failed=assert.rejects(x.core.purchaseAsync(x.alice,x.input,{signal:controller.signal}),code({timeout:'POLICY_TIMEOUT',disable:'POLICY_DISABLED',generation:'POLICY_STALE',cancel:'POLICY_ABORTED'}[mode]));await started.promise;
        if(mode==='cancel')controller.abort();if(['disable','generation'].includes(mode)){x.core.setRemoteAllocationEnabled(admin,{enabled:false});if(mode==='generation')x.core.setRemoteAllocationEnabled(admin,{enabled:true});}
        await failed;release.resolve();unchanged(x,before,counts);const row=x.store.query(q=>Object.values(q.value('allocationAttempts'))[0]),head=x.store.query(q=>q.get('allocationHeads',row.headId));assert.equal(head.cursor,0);assert.equal(head.seed,calls[0].context.entropy.seed);
        block=false;if(mode==='disable')x.core.setRemoteAllocationEnabled(admin,{enabled:true});await x.core.purchaseAsync(x.alice,x.input);assert.equal(calls.at(-1).context.entropy.seed,calls[0].context.entropy.seed);assert.equal(calls.at(-1).context.entropy.cursor,0);assert.equal(calls.at(-1).attemptId,calls[0].attemptId);
      }finally{release.resolve();x.core.close();}
    });
  }
});

test('uniform stock conflict hides selected outcomes; acknowledged reviews and alternate keys retain unused entropy',async()=>{
  const started=deferred(),release=deferred();let block=true;await withProvider(async(_req,res,data)=>{if(block){started.resolve();await release.promise;}reply(res,planned(data));},async(url,calls)=>{
    const x=setup(url,{change(c){c.variants.find(v=>v.id==='dawn.standard').supplyLimit=100;}});try{
      const failed=assert.rejects(x.core.purchaseAsync(x.alice,x.input),code('ALLOCATION_STALE'));await started.promise;await assert.rejects(x.core.purchaseAsync(x.alice,{...x.input,key:'alternate'}),code('ALLOCATION_PENDING'));assert.equal(calls.length,1);
      x.native.administerCards(admin,{key:'concurrent-stock',expectedRevision:0,reason:'Fixture stock update',userId:x.bob.userId,action:'give',variantId:'dawn.standard'});const before=business(x),counts=x.counts();release.resolve();await failed;unchanged(x,before,counts);const status=x.core.allocationStatus(x.alice,{productId:'common'});assert.equal(status.errorCode,'ALLOCATION_STALE');assert.deepEqual(Object.keys(status).sort(),['attemptId','errorCode','productId','state']);
      x.core.acknowledgeAllocation(x.alice,{attemptId:status.attemptId});block=false;await assert.rejects(x.core.purchaseAsync(x.alice,x.input),code('ALLOCATION_ACKNOWLEDGED'));await x.core.purchaseAsync(x.alice,{key:'reviewed',...x.core.quote(x.alice,{productId:'common',quantity:3})});assert.equal(calls.at(-1).context.entropy.seed,calls[0].context.entropy.seed);assert.equal(calls.at(-1).context.entropy.cursor,0);
    }finally{release.resolve();x.core.close();}
  });
});

test('cross-instance acknowledgement invalidates a late plan while preserving entropy',async()=>{
  const started=deferred(),release=deferred();let block=true;await withProvider(async(_req,res,data)=>{if(block){started.resolve();await release.promise;}reply(res,planned(data));},async(url,calls)=>{
    const x=setup(url,{store:new SQLiteStore(':memory:')}),other=new CardFramework({store:x.store,remoteAllocation:config(url)});try{
      const failed=assert.rejects(x.core.purchaseAsync(x.alice,x.input),code('ALLOCATION_STALE'));await started.promise;const {attemptId}=x.core.allocationStatus(x.alice,{productId:'common'});assert.throws(()=>x.core.acknowledgeAllocation(x.alice,{attemptId}),code('ALLOCATION_BUSY'));assert.throws(()=>other.acknowledgeAllocation(x.bob,{attemptId}),code('NOT_FOUND'));
      other.acknowledgeAllocation(x.alice,{attemptId});const before=business(x),counts=x.counts();release.resolve();await failed;unchanged(x,before,counts);block=false;await other.purchaseAsync(x.alice,{...x.input,key:'new-review'});assert.equal(calls.at(-1).context.entropy.seed,calls[0].context.entropy.seed);
    }finally{release.resolve();x.core.close();}
  });
});

test('tampered identity, selected variants and missing or extra slots never allocate',async()=>{
  for(const mode of ['identity','variant','missing','extra','amount','duplicate','surrogate','malformed'])await withProvider((_req,res,data)=>{
    const value=planned(data);if(mode==='identity')value.attemptId='00000000-0000-4000-8000-000000000000';if(mode==='variant')value.allocations[0].variantIds=['solstice.unique'];if(mode==='missing')value.allocations.pop();if(mode==='extra')value.allocations.push(value.allocations[0]);if(mode==='amount')value.amount=0;if(mode==='surrogate')value.allocations[0].slotId='\ud800';if(mode==='malformed'){res.writeHead(200,{'content-type':'application/json'});res.end('{');return;}
    if(mode==='duplicate'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value).replace('"slotId":"main"','"slotId":"main","slot\\u0049d":"main"'));}else reply(res,value);
  },async url=>{const x=setup(url),before=business(x),counts=x.counts();try{await assert.rejects(x.core.purchaseAsync(x.alice,x.input),e=>['INVALID_ALLOCATION_RESPONSE','INVALID_POLICY_RESPONSE','POLICY_UNAVAILABLE'].includes(e.code));unchanged(x,before,counts);}finally{x.core.close();}});
});

test('invalid/aborted signals and unsupported product combinations reject before journaling or external evaluation',async()=>{
  await withProvider(()=>assert.fail('Unsupported input must not invoke provider'),async(url,calls)=>{
    for(const mode of ['signal','aborted','pity','duplicates','factory','overlap']){
      const x=setup(url,{change(c,p){if(mode==='pity')p.pity={after:2,rarityId:'common'};if(mode==='duplicates')p.duplicatePolicy={scope:'pack',fallback:'allow'};if(mode==='factory')c.variants.find(v=>v.id==='dawn.standard').bindings={'demo.code':{factory:'demo.code',visibility:'owner',transfer:'retain'}};if(mode==='overlap'){c.variants.find(v=>v.id==='dawn.standard').supplyLimit=100;p.slots.push({...p.slots[0],id:'second'});}}});try{
        const controller=new AbortController();controller.abort();const before=business(x),counts=x.counts();await assert.rejects(x.core.purchaseAsync(x.alice,x.input,{signal:mode==='signal'?{}:mode==='aborted'?controller.signal:undefined}),code(mode==='signal'?'INVALID_ALLOCATION_REQUEST':mode==='aborted'?'POLICY_ABORTED':'ALLOCATION_UNSUPPORTED'));assert.equal(x.store.query(q=>Object.keys(q.value('allocationAttempts')??{}).length),0);unchanged(x,before,counts);
      }finally{x.core.close();}
    }assert.equal(calls.length,0);
  });
});

test('optional-slot entropy labels and quantity changes after acknowledgement reuse the same draw prefix',async()=>{
  let fail=true;await withProvider((_req,res,data)=>{if(fail){res.destroy();return;}reply(res,planned(data));},async(url,calls)=>{
    const x=setup(url,{change(_c,p){p.slots[0].pool[0].weight=100;p.slots[0].pool[1].weight=100;p.slots.push({id:'optional',role:'insert',count:1,probability:{numerator:1,denominator:2},pool:[{variantId:'cloud.standard',weight:100}]});}});try{
      await assert.rejects(x.core.purchaseAsync(x.alice,x.input),code('POLICY_UNAVAILABLE'));const original=planAllocation(calls[0].context),status=x.core.allocationStatus(x.alice,{productId:'common'});x.core.acknowledgeAllocation(x.alice,{attemptId:status.attemptId});fail=false;
      const input={key:'smaller',...x.core.quote(x.alice,{productId:'common',quantity:1})};await x.core.purchaseAsync(x.alice,input);assert.equal(calls[0].context.entropy.seed,calls[1].context.entropy.seed);assert.deepEqual(planAllocation(calls[1].context),original.filter(r=>r.packIndex===0));
    }finally{x.core.close();}
  });
});

test('SQLite restart preserves pending entropy and committed replay without remote configuration',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'allocation-journal-')),path=join(directory,'state.db'),encryptionKey=randomBytes(32);let fail=true;
  await withProvider((_req,res,data)=>{if(fail){res.destroy();return;}reply(res,planned(data));},async(url,calls)=>{
    let x=setup(url,{store:new SQLiteStore(path,{encryptionKey})});const {alice,input}=x;try{
      await assert.rejects(x.core.purchaseAsync(alice,input),code('POLICY_UNAVAILABLE'));x.core.close();fail=false;const store=new SQLiteStore(path,{encryptionKey});x={...x,store,core:new CardFramework({store,remoteAllocation:config(url)})};const result=await x.core.purchaseAsync(alice,input);assert.equal(calls[1].context.entropy.seed,calls[0].context.entropy.seed);x.core.close();
      const reopened=new SQLiteStore(path,{encryptionKey}),core=new CardFramework({store:reopened});try{assert.deepEqual(await core.purchaseAsync(alice,input),result);assert.deepEqual(core.purchase(alice,input),result);assert.equal(calls.length,2);}finally{core.close();}
    }finally{try{x.core.close();}catch{}rmSync(directory,{recursive:true,force:true});}
  });
});

test('bounded SQLite ordinary capacity rejects journal preparation without losing retry protection',async()=>{
  await withProvider(()=>assert.fail('Full storage must not dispatch allocation'),async url=>{
    const directory=mkdtempSync(join(tmpdir(),'allocation-capacity-')),path=join(directory,'state.db');let x=setup(url,{store:new SQLiteStore(path)});const used=x.store.measure(x.store.read(s=>s)).usedBytes;const {alice,input}=x;x.core.close();const store=new SQLiteStore(path,{maxStateBytes:used+100}),core=new CardFramework({store,remoteAllocation:config(url)});try{await assert.rejects(core.purchaseAsync(alice,input),code('STORAGE_CAPACITY'));assert.equal(store.query(q=>Object.keys(q.value('allocationAttempts')??{}).length),0);assert.equal(store.query(q=>Object.keys(q.value('allocationHeads')??{}).length),0);}finally{core.close();rmSync(directory,{recursive:true,force:true});}
  });
});

for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' explicit abandonment terminally fails only the matching pending purchase intent',async()=>{
  let fail=true;await withProvider((_req,res,data)=>{if(fail){res.destroy();return;}reply(res,planned(data));},async(url,calls)=>{
    const x=setup(url,{store:new Store(':memory:')});try{
      await assert.rejects(x.core.purchaseAsync(x.alice,x.input),code('POLICY_UNAVAILABLE'));
      const intent=x.core.registerCommandIntent(x.alice,{command:'purchase',input:x.input}),status=x.core.allocationStatus(x.alice,{productId:'common'});
      assert.equal(x.core.acknowledgeAllocation(x.alice,{attemptId:status.attemptId}).state,'acknowledged');assert.equal(x.core.commandIntent(x.alice,{id:intent.id,command:'purchase'}).state,'failed');assert.equal(x.core.commandIntents(x.alice).items[0].error.code,'ALLOCATION_ACKNOWLEDGED');
      const before=business(x),counts=x.counts();await assert.rejects(x.core.executeCommandIntentAsync(x.alice,{id:intent.id}),code('ALLOCATION_ACKNOWLEDGED'));await assert.rejects(x.core.purchaseAsync(x.alice,x.input),code('ALLOCATION_ACKNOWLEDGED'));assert.equal(calls.length,1);unchanged(x,before,counts);
      x.core.acknowledgeCommandIntent(x.alice,{id:intent.id});fail=false;const next={...x.input,key:'reviewed'},other=x.core.registerCommandIntent(x.alice,{command:'purchase',input:next});const result=await x.core.executeCommandIntentAsync(x.alice,{id:other.id});assert.equal(result.intent.state,'completed');assert.equal(calls[1].context.entropy.seed,calls[0].context.entropy.seed);assert.throws(()=>x.core.acknowledgeAllocation(x.alice,{attemptId:x.core.allocationStatus(x.alice,{productId:'common'}).attemptId}),code('ALLOCATION_COMPLETED'));assert.equal(x.core.commandIntent(x.alice,{id:other.id,command:'purchase'}).state,'completed');assert.equal(x.core.audit(admin).ok,true);
    }finally{x.core.close();}
  });
});

test('acknowledgement leaves different command inputs intact and invalidates concurrent old execution',async()=>{
  const started=deferred(),release=deferred();await withProvider(async(_req,res,data)=>{started.resolve();await release.promise;reply(res,planned(data));},async url=>{
    const x=setup(url,{store:new SQLiteStore(':memory:')}),other=new CardFramework({store:x.store,remoteAllocation:config(url)});try{
      const intent=x.core.registerCommandIntent(x.alice,{command:'purchase',input:x.input}),failed=assert.rejects(x.core.executeCommandIntentAsync(x.alice,{id:intent.id}),code('ALLOCATION_STALE'));await started.promise;const status=x.core.allocationStatus(x.alice,{productId:'common'}),before=business(x),counts=x.counts();other.acknowledgeAllocation(x.alice,{attemptId:status.attemptId});release.resolve();await failed;assert.equal(x.core.commandIntent(x.alice,{id:intent.id,command:'purchase'}).state,'failed');unchanged(x,before,counts);
    }finally{release.resolve();x.core.close();}
  });
  await withProvider((_req,res)=>res.destroy(),async url=>{const x=setup(url);try{await assert.rejects(x.core.purchaseAsync(x.alice,x.input),code('POLICY_UNAVAILABLE'));const wrong=x.core.registerCommandIntent(x.alice,{command:'purchase',input:{...x.input,quantity:1}}),other=x.core.registerCommandIntent(x.bob,{command:'purchase',input:{...x.input,key:'different'}}),status=x.core.allocationStatus(x.alice,{productId:'common'});x.core.acknowledgeAllocation(x.alice,{attemptId:status.attemptId});assert.equal(x.core.commandIntent(x.alice,{id:wrong.id,command:'purchase'}).state,'pending');assert.equal(x.core.commandIntent(x.bob,{id:other.id,command:'purchase'}).state,'pending');}finally{x.core.close();}});
});

test('HTTP purchase, status and acknowledgement and intent execution use the allocation journal',async()=>{
  let fail=true;await withProvider((_req,res,data)=>{if(fail){res.destroy();return;}reply(res,planned(data));},async(url,calls)=>{
    const x=setup(url);let origin;const server=createServer((req,res)=>createApiHandler({framework:x.core,resolveIdentity:()=>x.alice,allowedOrigin:origin,requirePrincipal:true})(req,res));await new Promise(done=>server.listen(0,'127.0.0.1',done));origin='http://127.0.0.1:'+server.address().port;
    const post=async(path,input)=>{const res=await fetch(origin+'/api/'+path,{method:'POST',headers:{origin,'content-type':'application/json','x-dc-principal':x.alice.userId},body:JSON.stringify(input)});return {status:res.status,value:await res.json()};};
    try{assert.equal((await post('purchase',x.input)).status,503);const res=await fetch(origin+'/api/allocations/status?productId=common',{headers:{'x-dc-principal':x.alice.userId}});assert.equal(res.status,200);const status=await res.json();assert.equal((await post('allocations/acknowledge',{attemptId:status.attemptId})).status,200);assert.equal((await post('purchase',x.input)).status,409);fail=false;const intent=x.core.registerCommandIntent(x.alice,{command:'purchase',input:{...x.input,key:'http-reviewed'}}),result=await post('command-intents/execute',{id:intent.id});assert.equal(result.status,200);assert.equal(result.value.intent.state,'completed');assert.equal(calls.length,2);}finally{server.closeAllConnections();await new Promise(done=>server.close(done));x.core.close();}
  });
});

test('owning worker forwards purchase cancellation and keeps independent storage work live during allocation wait',async()=>{
  const started=deferred(),release=deferred();let block=true;await withProvider(async(_req,res,data)=>{if(block){started.resolve();await release.promise;}reply(res,planned(data));},async url=>{
    const seed=setup(url),catalog=seed.c;seed.core.close();const worker=new FrameworkWorkerService({frameworkOptions:{remoteAllocation:config(url)}});await worker.ready;try{
      await worker.publishCatalog(admin,catalog);const user=await worker.registerUser(admin,{provider:'test',subject:'worker',displayName:'Worker'}),actor={userId:user.id};await worker.grantCurrency(admin,{userId:user.id,currencyId:'credits',amount:1000,key:'fund',reason:'Fixture funding'});const input={key:'worker-allocation',...await worker.quote(actor,{productId:'common',quantity:3})},controller=new AbortController(),failed=assert.rejects(worker.purchaseAsync(actor,input,{signal:controller.signal}),code('POLICY_ABORTED'));await started.promise;
      await worker.grantCurrency(admin,{userId:user.id,currencyId:'gems',amount:1,key:'independent',reason:'Fixture update'});assert.equal((await worker.wallet(actor)).gems,1);await assert.rejects(worker.setRemoteAllocationEnabled(actor,{enabled:false}),code('FORBIDDEN'));controller.abort();await failed;release.resolve();assert.equal((await worker.wallet(actor)).credits,1000);block=false;const result=await worker.purchaseAsync(actor,input);assert.equal(result.packs.length,3);assert.equal((await worker.audit(admin)).ok,true);
    }finally{release.resolve();await worker.close();assert.equal(worker.status().state,'closed');}
  });
});
