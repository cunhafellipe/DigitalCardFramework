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
import {validateStockAllocationStrategyRequest} from '../src/stock-allocation-strategy-contracts.js';
import {contentDigest} from '../src/importer.js';
import {fixture,admin} from './helpers.js';

const token='synthetic-stock-allocation-credential',selector={algorithm:'weighted-deck@1',version:1,deckScope:'purchase-slot'},code=name=>e=>e.code===name;
const config=(url,extra={})=>({scope:'commerce-stock',algorithm:'weighted-deck@1',providerId:'example.stock',url,token,allowLoopbackHttp:true,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const identity=data=>Object.fromEntries(Object.entries(data).filter(([key])=>key!=='context'));
const planned=data=>({...identity(data),status:'planned',allocations:planAllocation(data.context)});
const reply=(res,data)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));};
async function provider(handler,run){const calls=[],server=createServer(async(req,res)=>{try{const chunks=[];for await(const part of req)chunks.push(part);const data=JSON.parse(Buffer.concat(chunks));if(data.scope==='commerce-stock')validateStockAllocationStrategyRequest(data);assert.equal(req.headers.authorization,'Bearer '+token);calls.push(data);await handler(req,res,data);}catch{res.destroy();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await run('http://127.0.0.1:'+server.address().port,calls);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}}
function setup(url,{store=new MemoryStore(),policies={},remotePolicies={},change,clock=()=> '2026-09-30T12:00:00.000Z',options={},quote=true}={}){let draws=0,factories=0;const x=fixture({store,clock,change(c){for(const v of c.variants)v.bindings={};const p=c.products.find(p=>p.id==='common');p.allocationStrategy=selector;p.slots=[{id:'main',count:1,pool:[{variantId:'dawn.standard',weight:2},{variantId:'cloud.standard',weight:1}]}];change?.(c,p);}}),actor={...x.alice,role:'admin'},shop=x.core.createShop(actor,{key:'shop',kind:'admin',name:'Stock shop'}),native=x.core;
  x.core=new CardFramework({store,clock,random:()=>{draws++;return 0;},bindings:{'demo.code':()=>{factories++;return {}; }},policies,remotePolicies,remoteStockAllocation:config(url+'/stock',options)});store.prepareRecordTransactions();const terms=quote?x.core.quoteMintPackStock(actor,{shopId:shop.id,productId:'common',quantity:3}):{allocationDigest:'a'.repeat(64)},input={key:'stock',shopId:shop.id,title:'Minted stock',price:{currencyId:'credits',amount:20},items:{kind:'mint-pack',productId:'common',quantity:3},allocationDigest:terms.allocationDigest};return {...x,native,actor,shop,input,store,counts:()=>({draws,factories})};
}
const business=x=>x.store.query(q=>contentDigest(Object.fromEntries(['copies','packs','supply','balances','listings','requests','events'].map(name=>[name,q.value(name)??{}]))));
const unchanged=(x,before,counts)=>{assert.equal(business(x),before);assert.deepEqual(x.counts(),counts);assert.equal(x.core.audit(admin).ok,true);};

for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' stock plan, listing locks, receipt, reservations and shared cursor commit once',async()=>{
 await provider((_req,res,data)=>reply(res,planned(data)),async(url,calls)=>{let direct=0;const x=setup(url,{store:new Store(),policies:{canList:()=>{direct++;return true;}}});try{
  assert.throws(()=>x.core.createListing(x.actor,x.input),code('ALLOCATION_ASYNC_REQUIRED'));const before=x.counts(),[a,b]=await Promise.all([x.core.createListingAsync(x.actor,x.input),x.core.createListingAsync(x.actor,x.input)]);assert.deepEqual(a,b);assert.equal(calls.length,1);assert.equal(direct,1);assert.deepEqual(x.counts(),before);
  const state=x.store.read(s=>s),packs=Object.values(state.packs),copies=Object.values(state.copies),attempt=Object.values(state.allocationAttempts)[0],head=Object.values(state.allocationHeads)[0];assert.equal(packs.length,3);assert.equal(copies.length,3);assert.equal(copies.filter(c=>c.variantId==='dawn.standard').length,2);assert(packs.every(p=>p.lockedBy==='market:'+a.id));assert(copies.every(c=>c.lockedBy==='market:'+a.id));assert(state.completionObligations['listing:'+a.id]);assert(packs.every(p=>state.completionObligations['pack:'+p.id]));assert.equal(attempt.state,'completed');assert.deepEqual(attempt.result,a);assert.equal(state.requests[x.actor.userId+':stock'].allocationAttemptId,attempt.id);assert.equal(head.cursor,1);assert.equal(head.seed,null);assert.equal(x.core.audit(admin).ok,true);
  const status=x.core.stockAllocationStatus(x.actor,{shopId:x.shop.id,productId:'common'});assert.equal(status.command,'createListing');assert.equal(status.attemptShopId,x.shop.id);assert(!JSON.stringify(status).includes('seed'));x.core.setRemoteStockAllocationEnabled(x.actor,{enabled:false});assert.deepEqual(await x.core.createListingAsync(x.actor,x.input),a);assert.equal(calls.length,1);
  const quote=x.core.quoteListing(x.bob,{listingId:a.id,quantity:1}),order=await x.core.buyListingAsync(x.bob,{...quote,key:'buy'});assert.equal(order.quantity,1);x.core.cancelListing(x.actor,{listingId:a.id,key:'cancel'});assert.equal(x.core.packs(x.bob).length,1);assert.equal(x.core.audit(admin).ok,true);
 }finally{x.core.close();}});
});

for(const Store of [MemoryStore,SQLiteStore])test(Store.name+' abandoned stock intent fences the old key and retains entropy across shop, quantity and wallet changes',async()=>{
 let fail=true;await provider((_req,res,data)=>{if(fail)res.destroy();else reply(res,planned(data));},async(url,calls)=>{let core;const x=setup(url,{store:new Store()});core=x.core;try{
  await assert.rejects(core.createListingAsync(x.actor,x.input),code('POLICY_UNAVAILABLE'));const status=core.stockAllocationStatus(x.actor,{shopId:x.shop.id,productId:'common'}),intent=core.registerCommandIntent(x.actor,{command:'createListing',input:x.input}),quote=core.quote(x.actor,{productId:'common',quantity:3});
  const both=new CardFramework({store:x.store,remoteStockAllocation:config(url+'/stock'),remoteAllocation:{...config(url+'/wallet'),scope:'catalog-purchase'}});await assert.rejects(both.purchaseAsync(x.actor,{...quote,key:'wallet'}),code('ALLOCATION_PENDING'));
  core.acknowledgeAllocation(x.actor,{attemptId:status.attemptId});assert.equal(core.commandIntent(x.actor,{id:intent.id,command:'createListing'}).state,'failed');assert.equal(core.commandIntents(x.actor,{command:'createListing'}).items[0].error.code,'ALLOCATION_ACKNOWLEDGED');await assert.rejects(core.createListingAsync(x.actor,x.input),code('ALLOCATION_ACKNOWLEDGED'));core.acknowledgeCommandIntent(x.actor,{id:intent.id});
  const other=x.native.createShop(x.actor,{key:'shop-two',kind:'admin',name:'Second stock shop'}),terms=core.quoteMintPackStock(x.actor,{shopId:other.id,productId:'common',quantity:1}),changed={...x.input,key:'review',shopId:other.id,items:{...x.input.items,quantity:1},allocationDigest:terms.allocationDigest};await assert.rejects(core.createListingAsync(x.actor,changed),code('POLICY_UNAVAILABLE'));
  const shared=core.stockAllocationStatus(x.actor,{shopId:x.shop.id,productId:'common'});assert.equal(shared.attemptShopId,other.id);assert.equal(shared.command,'createListing');assert.equal(calls[1].context.entropy.seed,calls[0].context.entropy.seed);assert.deepEqual(planAllocation(calls[1].context)[0],planAllocation(calls[0].context)[0]);core.acknowledgeAllocation(x.actor,{attemptId:shared.attemptId});
  fail=false;const receipt=await both.purchaseAsync(x.actor,{...quote,key:'wallet-reviewed'});assert.equal(receipt.packs.length,3);assert.equal(calls[2].context.entropy.seed,calls[0].context.entropy.seed);const walletStatus=core.stockAllocationStatus(x.actor,{shopId:x.shop.id,productId:'common'});assert.equal(walletStatus.command,'purchase');assert.equal(walletStatus.attemptShopId,null);assert.equal(core.audit(admin).ok,true);
 }finally{core.close();}});
});

test('frozen default start time survives retries and encrypted restart; exact stock replay needs no provider',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'stock-allocation-')),path=join(dir,'state.sqlite'),encryptionKey=randomBytes(32);let core,fail=true,time='2026-09-30T12:00:00.000Z';
 try{await provider((_req,res,data)=>{if(fail)res.destroy();else reply(res,planned(data));},async(url,calls)=>{const x=setup(url,{store:new SQLiteStore(path,{encryptionKey}),clock:()=>time});core=x.core;await assert.rejects(core.createListingAsync(x.actor,x.input),code('POLICY_UNAVAILABLE'));const before=x.store.query(q=>Object.values(q.value('allocationHeads'))[0]);core.close();
  time='2026-09-30T12:30:00.000Z';core=new CardFramework({store:new SQLiteStore(path,{encryptionKey}),clock:()=>time,remoteStockAllocation:config(url+'/stock')});fail=false;const listing=await core.createListingAsync(x.actor,x.input);assert.equal(listing.startsAt,'2026-09-30T12:00:00.000Z');assert.equal(calls[1].context.entropy.seed,before.seed);assert.throws(()=>core.acknowledgeAllocation(x.actor,{attemptId:core.stockAllocationStatus(x.actor,{shopId:x.shop.id,productId:'common'}).attemptId}),code('ALLOCATION_COMPLETED'));core.close();core=new CardFramework({store:new SQLiteStore(path,{encryptionKey}),clock:()=>time});assert.deepEqual(await core.createListingAsync(x.actor,x.input),listing);assert.equal(calls.length,2);assert.equal(core.audit(admin).ok,true);
 });}finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});

test('late stock reply cannot commit after cross-instance acknowledgement or listing grant revocation',async()=>{
 for(const mode of ['ack','list-generation']){const started=deferred(),release=deferred();await provider(async(_req,res,data)=>{if(data.operation==='canList'){reply(res,{...identity(data),status:'allowed'});return;}started.resolve();await release.promise;reply(res,planned(data));},async url=>{const x=setup(url,{remotePolicies:{canList:{scope:'listing',providerId:'example.list',url:url+'/list',token,allowLoopbackHttp:true}}});try{
  const intent=mode==='ack'?x.core.registerCommandIntent(x.actor,{command:'createListing',input:x.input}):null,expected=mode==='ack'?'ALLOCATION_STALE':'POLICY_STALE',pending=assert.rejects(intent?x.core.executeCommandIntentAsync(x.actor,{id:intent.id}):x.core.createListingAsync(x.actor,x.input),code(expected));await started.promise;const before=business(x),counts=x.counts();if(mode==='ack'){const other=new CardFramework({store:x.store,remoteStockAllocation:config(url+'/stock')});other.acknowledgeAllocation(x.actor,{attemptId:x.core.stockAllocationStatus(x.actor,{shopId:x.shop.id,productId:'common'}).attemptId});}else{x.core.setRemotePolicyEnabled(x.actor,{hook:'canList',enabled:false});x.core.setRemotePolicyEnabled(x.actor,{hook:'canList',enabled:true});}release.resolve();await pending;unchanged(x,before,counts);if(intent)assert.equal(x.core.commandIntents(x.actor,{command:'createListing'}).items[0].error.code,'ALLOCATION_ACKNOWLEDGED');
 }finally{release.resolve();x.core.close();}});}
});

test('approved listing policy and failed allocation release transport capacity and retry the same attempt',async()=>{
 let fail=true;await provider((_req,res,data)=>{if(data.operation==='canList')reply(res,{...identity(data),status:'allowed'});else if(fail)res.destroy();else reply(res,planned(data));},async(url,calls)=>{const x=setup(url,{options:{maxConcurrent:1},remotePolicies:{canList:{scope:'listing',providerId:'example.list',url:url+'/list',token,allowLoopbackHttp:true,maxConcurrent:1}}});try{
  const before=business(x),counts=x.counts();await assert.rejects(x.core.createListingAsync(x.actor,x.input),code('POLICY_UNAVAILABLE'));unchanged(x,before,counts);fail=false;await x.core.createListingAsync(x.actor,x.input);const allocations=calls.filter(c=>c.operation==='allocatePacks');assert.equal(allocations.length,2);assert.equal(allocations[1].attemptId,allocations[0].attemptId);assert.deepEqual(allocations[1].context.entropy,allocations[0].context.entropy);assert.equal(calls.filter(c=>c.operation==='canList').length,2);assert.equal(x.core.audit(admin).ok,true);
 }finally{x.core.close();}});
});

test('ordinary SQLite byte capacity rolls back stock journal admission without exposing or replacing entropy',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'stock-capacity-')),path=join(dir,'state.sqlite');let core;
 try{await provider(()=>assert.fail('Capacity rejection must precede provider dispatch'),async url=>{const x=setup(url,{store:new SQLiteStore(path)});core=x.core;const cap=x.store.read(s=>x.store.measure(s).totalBytes);core.close();const store=new SQLiteStore(path,{maxStateBytes:cap+100});core=new CardFramework({store,remoteStockAllocation:config(url+'/stock')});const before=store.read(s=>s);await assert.rejects(core.createListingAsync(x.actor,x.input),code('STORAGE_CAPACITY'));assert.deepEqual(store.read(s=>s),before);assert.equal(core.stockAllocationStatus(x.actor,{shopId:x.shop.id,productId:'common'}).state,'idle');assert.equal(core.audit(admin).ok,true);});}finally{core?.close();rmSync(dir,{recursive:true,force:true});}
});

test('unsupported stock, invalid signals and bounded capacity reject without allocation or factories',async()=>{
 await provider(()=>assert.fail('Rejected stock must not contact provider'),async(url,calls)=>{
  for(const mode of ['missing-digest','signal','aborted','pity','duplicates','factory','overlap','batch']){const x=setup(url,{quote:!['pity','duplicates','factory','overlap','batch'].includes(mode),change(c,p){if(mode==='pity')p.pity={after:2,rarityId:'common'};if(mode==='duplicates')p.duplicatePolicy={scope:'pack',fallback:'allow'};if(mode==='factory')c.variants.find(v=>v.id==='dawn.standard').bindings={'demo.code':{factory:'demo.code',visibility:'owner',transfer:'retain'}};if(mode==='overlap'){c.variants.find(v=>v.id==='dawn.standard').supplyLimit=100;p.slots.push({...p.slots[0],id:'second'});}if(mode==='batch')p.slots[0].count=100;}});try{const before=business(x),counts=x.counts(),input={...x.input};if(mode==='missing-digest')delete input.allocationDigest;const controller=new AbortController();controller.abort();const expected=mode==='missing-digest'?'ALLOCATION_STALE':mode==='signal'?'INVALID_ALLOCATION_REQUEST':mode==='aborted'?'POLICY_ABORTED':mode==='batch'?'ALLOCATION_LIMIT':'ALLOCATION_UNSUPPORTED';
   if(['pity','duplicates','factory','overlap','batch'].includes(mode))assert.throws(()=>x.core.quoteMintPackStock(x.actor,{shopId:x.shop.id,productId:'common',quantity:3}),code(expected));else await assert.rejects(x.core.createListingAsync(x.actor,input,{signal:mode==='signal'?{}:mode==='aborted'?controller.signal:undefined}),code(expected));unchanged(x,before,counts);assert.equal(x.store.query(q=>Object.keys(q.value('allocationAttempts')??{}).length),0);
  }finally{x.core.close();}}assert.equal(calls.length,0);
 });
});

test('remote and direct listing veto, stale revisions, cancellation and disabled grants never issue stock',async()=>{
 for(const mode of ['remote-deny','direct-deny','stale','cancel','disable','tamper','timeout']){const started=deferred(),release=deferred();await provider(async(_req,res,data)=>{if(data.operation==='canList'){reply(res,{...identity(data),status:mode==='remote-deny'?'denied':'allowed',...(mode==='remote-deny'?{reasonCode:'ineligible'}:{})});return;}started.resolve();if(['stale','cancel','disable','timeout'].includes(mode))await release.promise;const response=planned(data);if(mode==='tamper')response.allocations.pop();reply(res,response);},async(url,calls)=>{
  const listing={scope:'listing',providerId:'example.list',url:url+'/list',token,allowLoopbackHttp:true,timeoutMs:200},x=setup(url,{options:{timeoutMs:mode==='timeout'?20:200},remotePolicies:{canList:listing},policies:{canList:()=>mode!=='direct-deny'}}),controller=new AbortController();try{let before=business(x);const counts=x.counts(),expected={'remote-deny':'POLICY_DENIED','direct-deny':'FORBIDDEN',stale:'ALLOCATION_STALE',cancel:'POLICY_ABORTED',disable:'POLICY_DISABLED',tamper:'INVALID_ALLOCATION_RESPONSE',timeout:'POLICY_TIMEOUT'}[mode],pending=assert.rejects(x.core.createListingAsync(x.actor,x.input,{signal:controller.signal}),code(expected));
   if(['stale','cancel','disable','timeout'].includes(mode)){await started.promise;if(mode==='stale')x.native.configureCommerce(x.actor,{key:'settings',expectedRevision:0,settings:{maxListingsPerShop:100}});if(mode==='stale')before=business(x);if(mode==='cancel')controller.abort();if(mode==='disable')x.core.setRemoteStockAllocationEnabled(x.actor,{enabled:false});if(mode!=='timeout')release.resolve();}await pending;release.resolve();unchanged(x,before,counts);assert.equal(calls.filter(c=>c.operation==='allocatePacks').length,mode==='remote-deny'?0:1);
  }finally{release.resolve();x.core.close();}});}
});
