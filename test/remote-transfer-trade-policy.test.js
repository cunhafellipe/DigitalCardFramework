import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {CardFramework} from '../src/core.js';
import {MemoryStore} from '../src/store.js';
import {SQLiteStore} from '../src/sqlite.js';
import {FrameworkWorkerService} from '../src/framework-worker-service.js';
import {createApiHandler} from '../src/http.js';
import {contentDigest} from '../src/importer.js';
import {validateTransferPolicyRequest,validateTransferPolicyResponse} from '../src/transfer-policy-contracts.js';
import {validateTradePolicyRequest,validateTradePolicyResponse} from '../src/trade-policy-contracts.js';
import {fixture,admin} from './helpers.js';

const token='synthetic-transfer-policy-credential',code=expected=>e=>e.code===expected;
const identity=data=>Object.fromEntries(Object.entries(data).filter(([key])=>key!=='context'));
const allowed=data=>({...identity(data),status:'allowed'});
const reply=(res,data)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const config=(url,hook,options={})=>({scope:hook==='canTransfer'?'transfer':'exchange',providerId:'example.'+hook,url,token,allowLoopbackHttp:true,...options});
async function withPolicy(handler,run){
  const calls=[],server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=JSON.parse(Buffer.concat(chunks));assert.equal(req.headers.authorization,'Bearer '+token);(data.operation==='canTransfer'?validateTransferPolicyRequest:validateTradePolicyRequest)(data);calls.push(data);await handler(req,res,data);}catch{res.destroy();}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));try{await run('http://127.0.0.1:'+server.address().port+'/policy',calls);}finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
}
function setup(url,{prepared=false,hooks=['canTransfer','canTrade'],policies={},options={},count=2}={}){
  const store=prepared?new SQLiteStore(':memory:'):new MemoryStore();let now='2026-10-01T00:00:00.000Z',factories=0,randoms=0;
  const clock=()=>now,bindings={'demo.code':()=>{factories++;return {code:'SYNTHETIC-PRIVATE-DATA'};}},random=()=>{randoms++;return 0;};
  const x=fixture({store,clock,bindings,random}),native=x.core,a=x.open('common',x.alice,count),b=x.open('common',x.bob,count),remotePolicies=Object.fromEntries(hooks.map(hook=>[hook,config(url,hook,options)]));
  x.core=new CardFramework({store,clock,bindings,random,policies,remotePolicies});if(prepared)store.prepareRecordTransactions();
  return {...x,store,native,clock,a,b,remotePolicies,counts:()=>({factories,randoms}),advance:()=>now='2026-10-03T00:00:00.000Z',input:{key:'proposal',toUserId:x.bob.userId,give:{copyIds:a.map(c=>c.id),currencies:[{currencyId:'credits',amount:25}]},receive:{copyIds:b.map(c=>c.id),currencies:[{currencyId:'credits',amount:10}]}}};
}
const stockDigest=x=>x.store.query(q=>contentDigest(Object.fromEntries(['copies','packs','trades','balances','ledger','events','listings','orders'].map(name=>[name,q.value(name)??{}]))));
const unchanged=(x,digest,counts)=>{assert.equal(stockDigest(x),digest);assert.deepEqual(x.counts(),counts);assert.equal(x.core.audit(admin).ok,true);};

for(const prepared of [false,true])test((prepared?'prepared SQLite':'Memory')+' batches both trade legs, authenticates replay and settles once',async()=>{
  await withPolicy((_req,res,data)=>{assert(!JSON.stringify(data).includes('SYNTHETIC-PRIVATE-DATA'));reply(res,allowed(data));},async(url,calls)=>{
    let transfer=0,trade=0;const x=setup(url,{prepared,policies:{canTransfer:()=>{transfer++;return true;},canTrade:()=>{trade++;return true;}}});
    try{
      assert.throws(()=>x.core.proposeTrade(x.alice,x.input),code('POLICY_ASYNC_REQUIRED'));
      const before=prepared?x.store.diagnostics().compatibilityMaterializations:0;
      const [first,second]=await Promise.all([x.core.proposeTradeAsync(x.alice,x.input),x.core.proposeTradeAsync(x.alice,x.input)]);
      assert.deepEqual(first,second);assert.equal(calls.length,4);assert.equal(transfer,4);assert.equal(trade,1);
      assert.equal(calls[0].context.legs.length,2);assert.equal(calls[0].context.legs.flatMap(l=>l.copyIds).length,4);
      const reviewed=await x.core.reviewTransferAsync(x.bob,{toUserId:x.alice.userId,give:x.input.receive,receive:x.input.give,parentTradeId:first.id,expectedDigest:first.digest,message:'Counter preview'});
      assert.equal(reviewed.status,'allowed');assert.deepEqual(new Set(reviewed.copyIds),new Set([...x.input.give.copyIds,...x.input.receive.copyIds]));
      const receipt=x.store.query(q=>q.get('requests',x.alice.userId+':proposal'));assert.equal(receipt.policyAdmissions.length,2);
      const accepted=await x.core.acceptTradeAsync(x.bob,{key:'accept',tradeId:first.id,expectedDigest:first.digest});assert.equal(accepted.status,'accepted');
      for(const card of x.a)assert.equal(x.store.query(q=>q.get('copies',card.id)).ownerId,x.bob.userId);
      if(prepared)assert.equal(x.store.diagnostics().compatibilityMaterializations,before);
      const totalCalls=calls.length,digest=stockDigest(x);x.core.setRemotePolicyEnabled(admin,{hook:'canTrade',enabled:false});x.core.setRemotePolicyEnabled(admin,{hook:'canTransfer',enabled:false});
      assert.deepEqual(await x.core.proposeTradeAsync(x.alice,x.input),first);assert.deepEqual(x.core.proposeTrade(x.alice,x.input),first);assert.deepEqual(await x.core.acceptTradeAsync(x.bob,{key:'accept',tradeId:first.id,expectedDigest:first.digest}),accepted);
      assert.equal(calls.length,totalCalls);assert.equal(stockDigest(x),digest);await assert.rejects(x.core.proposeTradeAsync({...x.alice,disabled:true},x.input),code('UNAUTHENTICATED'));assert.equal(x.core.audit(admin).ok,true);
    }finally{x.core.close();}
  });
});

test('counter deny, stale, cancellation, generation and deadline never release parent escrow or consume entropy',async()=>{
  for(const mode of ['deny','stale','cancel','disable','generation','timeout']){
    const started=deferred(),release=deferred();
    await withPolicy(async(_req,res,data)=>{started.resolve();await release.promise;reply(res,mode==='deny'?{...identity(data),status:'denied',reasonCode:'restricted'}:allowed(data));},async url=>{
      const x=setup(url,{prepared:true,options:{timeoutMs:mode==='timeout'?70:1500}}),parent=x.native.proposeTrade(x.alice,x.input),controller=new AbortController(),input={key:'counter',tradeId:parent.id,expectedDigest:parent.digest,give:x.input.receive,receive:x.input.give};
      const before=stockDigest(x),counts=x.counts();
      try{
        const pending=assert.rejects(x.core.counterTradeAsync(x.bob,input,{signal:controller.signal}),code({deny:'POLICY_DENIED',stale:'POLICY_STALE',cancel:'POLICY_ABORTED',disable:'POLICY_DISABLED',generation:'POLICY_STALE',timeout:'POLICY_TIMEOUT'}[mode]));
        await started.promise;unchanged(x,before,counts);
        if(mode==='stale')x.native.setPreferences(x.bob,{key:'prefs',wishlistCardIds:['dawn']});
        if(mode==='cancel')controller.abort();
        if(['disable','generation'].includes(mode)){x.core.setRemotePolicyEnabled(admin,{hook:'canTransfer',enabled:false});if(mode==='generation')x.core.setRemotePolicyEnabled(admin,{hook:'canTransfer',enabled:true});}
        const expected=stockDigest(x);if(['deny','stale'].includes(mode))release.resolve();await pending;release.resolve();unchanged(x,expected,counts);
        assert.equal(x.store.query(q=>q.get('trades',parent.id)).status,'pending');assert.equal(x.store.query(q=>q.get('copies',x.a[0].id)).lockedBy,parent.id);
      }finally{release.resolve();x.core.close();}
    });
  }
});

test('advisory review rechecks earlier grant and deadline after a second provider waits',async()=>{
  for(const mode of ['generation','deadline']){
  const started=deferred(),release=deferred();await withPolicy(async(_req,res,data)=>{if(data.operation==='canTrade'){started.resolve();await release.promise;}reply(res,allowed(data));},async url=>{
    const x=setup(url,{hooks:mode==='deadline'?['canTrade']:['canTransfer','canTrade']});if(mode==='deadline'){x.core.close();x.core=new CardFramework({store:x.store,clock:x.clock,remotePolicies:{canTransfer:config(url,'canTransfer',{timeoutMs:40}),canTrade:config(url,'canTrade',{timeoutMs:1500})}});}try{
      const before=stockDigest(x),counts=x.counts(),pending=assert.rejects(x.core.reviewTransferAsync(x.alice,{...x.input,key:undefined}),code('INVALID_INPUT'));await pending;
      const {key,...input}=x.input,review=assert.rejects(x.core.reviewTransferAsync(x.alice,input),code(mode==='deadline'?'POLICY_TIMEOUT':'POLICY_STALE'));await started.promise;if(mode==='generation'){x.core.setRemotePolicyEnabled(admin,{hook:'canTransfer',enabled:false});x.core.setRemotePolicyEnabled(admin,{hook:'canTransfer',enabled:true});}else await new Promise(done=>setTimeout(done,70));release.resolve();await review;unchanged(x,before,counts);
    }finally{release.resolve();x.core.close();}
  });
  }
});

test('pre-provider ownership, privacy, native restrictions and supplied counter versions reject without effects',async()=>{
  await withPolicy((_req,res,data)=>reply(res,allowed(data)),async(url,calls)=>{
    const x=setup(url);try{
      const before=stockDigest(x),counts=x.counts();
      await assert.rejects(x.core.reviewTransferAsync(x.alice,{toUserId:x.bob.userId,give:x.input.receive,receive:x.input.give}),code('NOT_OWNED'));
      await assert.rejects(x.core.proposeTradeAsync({...x.alice,disabled:true},x.input),code('UNAUTHENTICATED'));
      x.native.setPreferences(x.bob,{key:'private',inventoryVisibility:'private'});
      await assert.rejects(x.core.proposeTradeAsync(x.alice,x.input),code('INVENTORY_PRIVATE'));assert.equal(calls.length,0);
      x.native.setPreferences(x.bob,{key:'public',inventoryVisibility:'public'});const parent=x.native.proposeTrade(x.alice,x.input),digest=stockDigest(x);
      await assert.rejects(x.core.counterTradeAsync(x.bob,{key:'counter',tradeId:parent.id,expectedDigest:parent.digest,give:x.input.receive,receive:x.input.give,versions:{[x.a[0].id]:999}}),code('STALE_INVENTORY'));assert.equal(calls.length,0);unchanged(x,digest,counts);
      const counter=x.native.counterTrade(x.bob,{key:'legacy-counter',tradeId:parent.id,expectedDigest:parent.digest,give:x.input.receive,receive:x.input.give});const after=stockDigest(x),n=calls.length;
      assert.deepEqual(await x.core.counterTradeAsync(x.bob,{key:'legacy-counter',tradeId:parent.id,expectedDigest:parent.digest,give:x.input.receive,receive:x.input.give}),counter);assert.equal(calls.length,n);
      await assert.rejects(x.core.counterTradeAsync(x.bob,{key:'legacy-counter',tradeId:parent.id,expectedDigest:parent.digest,give:x.input.receive,receive:x.input.give,versions:{}}),code('IDEMPOTENCY_CONFLICT'));assert.equal(stockDigest(x),after);assert.notEqual(before,digest);
    }finally{x.core.close();}
  });
});

test('inventory advisory flags retain native vetoes and direct callbacks run only at native commit',async()=>{
  await withPolicy((_req,res,data)=>reply(res,allowed(data)),async(url,calls)=>{
    let direct=0;const x=setup(url,{policies:{canTransfer:()=>{direct++;return false;}}});try{
      const view=x.core.inventory(x.alice)[0];assert.equal(view.tradable,false);assert.equal(view.remoteReviewRequired,undefined);
      direct=0;const before=stockDigest(x),counts=x.counts();await assert.rejects(x.core.proposeTradeAsync(x.alice,x.input),code('TRANSFER_BLOCKED'));assert.equal(direct,1);assert.equal(calls.length,2);unchanged(x,before,counts);
      direct=0;const {key,...review}=x.input;await assert.rejects(x.core.reviewTransferAsync(x.alice,review),code('TRANSFER_BLOCKED'));assert.equal(direct,1);unchanged(x,before,counts);
    }finally{x.core.close();}
    const y=setup(url,{hooks:['canTrade']});try{assert.equal(y.core.inventory(y.alice)[0].remoteReviewRequired,true);}finally{y.core.close();}
  });
});

test('failed resale decisions do not change funds, ownership, reservations or receipts',async()=>{
  for(const mode of ['deny','identity','amount','cancel','disable','stale','timeout']){
    const started=deferred(),release=deferred();
    await withPolicy(async(_req,res,data)=>{
      if(data.phase!=='purchase'){reply(res,allowed(data));return;}started.resolve();await release.promise;
      const value=mode==='deny'?{...identity(data),status:'denied',reasonCode:'restricted'}:mode==='identity'?{...allowed(data),snapshotDigest:'f'.repeat(64)}:mode==='amount'?{...allowed(data),amount:0}:allowed(data);reply(res,value);
    },async url=>{
      const x=setup(url,{prepared:true,count:1,options:{timeoutMs:mode==='timeout'?80:1500}}),seller={...x.alice,role:'admin'},controller=new AbortController();try{
        const shop=x.native.createShop(seller,{key:'shop',name:'Resale',kind:'admin'}),listing=await x.core.createListingAsync(seller,{key:'list',shopId:shop.id,title:'Stock',price:{currencyId:'credits',amount:20},items:{kind:'copies',ids:[x.a[0].id]}}),quote=await x.core.quoteListingAsync(x.bob,{listingId:listing.id}),counts=x.counts();
        const rejected=assert.rejects(x.core.buyListingAsync(x.bob,{key:'buy',...quote},{signal:controller.signal}),code({deny:'POLICY_DENIED',identity:'INVALID_POLICY_RESPONSE',amount:'INVALID_POLICY_RESPONSE',cancel:'POLICY_ABORTED',disable:'POLICY_DISABLED',stale:'POLICY_STALE',timeout:'POLICY_TIMEOUT'}[mode]));await started.promise;
        if(mode==='cancel')controller.abort();if(mode==='disable')x.core.setRemotePolicyEnabled(admin,{hook:'canTrade',enabled:false});if(mode==='stale')x.store.transact(s=>s.copies[x.a[0].id].version++);
        const before=stockDigest(x);if(['deny','identity','amount','stale'].includes(mode))release.resolve();await rejected;release.resolve();unchanged(x,before,counts);
        assert.equal(x.store.query(q=>q.get('requests',x.bob.userId+':buy')),undefined);assert.equal(x.store.query(q=>q.get('copies',x.a[0].id)).lockedBy,'market:'+listing.id);
      }finally{release.resolve();x.core.close();}
    });
  }
});

test('remote policy protocols reject extra fields, unsupported scopes and batch overflow before any external request',async()=>{
  await withPolicy((_req,res,data)=>reply(res,allowed(data)),async(url,calls)=>{
    const x=setup(url,{count:1});try{
      const {key,...reviewInput}=x.input;await x.core.reviewTransferAsync(x.alice,reviewInput);
      for(const request of calls){const validate=request.operation==='canTransfer'?validateTransferPolicyRequest:validateTradePolicyRequest,response=request.operation==='canTransfer'?validateTransferPolicyResponse:validateTradePolicyResponse;validate(request);response(allowed(request));assert.throws(()=>validate({...request,scope:'allocation'}),code('INVALID_POLICY_REQUEST'));assert.throws(()=>response({...allowed(request),context:{}}),code('INVALID_POLICY_RESPONSE'));assert.throws(()=>response({...allowed(request),status:'paid'}),code('INVALID_POLICY_RESPONSE'));}
      const bulk=new CardFramework({store:x.store,clock:x.clock,limits:{completionBytes:1073741824}}),c=structuredClone(x.c);c.version++;const product=c.products.find(p=>p.id==='common');product.revision++;product.maxQuantity=21;product.slots[0].count=100;bulk.publishCatalog(admin,c);bulk.configureCommerce(admin,{key:'packs-on',expectedRevision:0,settings:{packResale:true,maxStockPerListing:30}});
      const seller={...x.alice,role:'admin'},shop=bulk.createShop(seller,{key:'shop',name:'Batch shop',kind:'admin'}),packs=bulk.purchase(x.alice,{key:'bulk-stock',...bulk.quote(x.alice,{productId:'common',quantity:21})}).packs,input={key:'too-big',shopId:shop.id,title:'Pack stock',perBuyerLimit:30,price:{currencyId:'credits',amount:0},items:{kind:'packs',ids:packs.map(p=>p.id)}},before=stockDigest(x),counts=x.counts(),n=calls.length;
      await assert.rejects(x.core.createListingAsync(seller,input),code('POLICY_LIMIT'));assert.equal(calls.length,n);unchanged(x,before,counts);
      const listing=bulk.createListing(seller,{...input,key:'native-large'}),quote=bulk.quoteListing(x.bob,{listingId:listing.id,quantity:21}),onlyTrade=new CardFramework({store:x.store,clock:x.clock,remotePolicies:{canTrade:config(url,'canTrade')}}),listed=stockDigest(x);
      try{await assert.rejects(onlyTrade.quoteListingAsync(x.bob,{listingId:listing.id,quantity:21}),code('POLICY_LIMIT'));await assert.rejects(onlyTrade.buyListingAsync(x.bob,{key:'oversized-buy',...quote}),code('POLICY_LIMIT'));assert.equal(calls.length,n);unchanged(x,listed,counts);}finally{onlyTrade.close();}

    }finally{x.core.close();}
  });
});

test('HTTP review, proposal, counter and acceptance and durable command intent use authoritative async gates',async()=>{
  await withPolicy((_req,res,data)=>reply(res,allowed(data)),async(url,calls)=>{
    const x=setup(url);let principal=x.alice,origin;const server=createServer((req,res)=>createApiHandler({framework:x.core,resolveIdentity:()=>principal,allowedOrigin:origin,requirePrincipal:true})(req,res));await new Promise(done=>server.listen(0,'127.0.0.1',done));origin='http://127.0.0.1:'+server.address().port;
    const post=async(path,input)=>{const res=await fetch(origin+'/api/'+path,{method:'POST',headers:{origin,'content-type':'application/json','x-dc-principal':principal.userId},body:JSON.stringify(input)}),value=await res.json();assert.equal(res.status,200,JSON.stringify(value));return value;};
    try{
      const {key,...review}=x.input;assert.equal((await post('trades/review-transfer',review)).status,'allowed');const parent=await post('trades',x.input);principal=x.bob;
      await post('trades/review-transfer',{toUserId:x.alice.userId,give:x.input.receive,receive:x.input.give,parentTradeId:parent.id,expectedDigest:parent.digest});
      const counterInput={key:'counter',tradeId:parent.id,expectedDigest:parent.digest,give:x.input.receive,receive:x.input.give},intent=x.core.registerCommandIntent(x.bob,{command:'counterTrade',input:counterInput});assert.throws(()=>x.core.executeCommandIntent(x.bob,{id:intent.id}),code('POLICY_ASYNC_REQUIRED'));
      const counter=(await post('command-intents/execute',{id:intent.id})).result;assert.equal(counter.parentTradeId,parent.id);principal=x.alice;assert.equal((await post('trades/accept',{key:'accept',tradeId:counter.id,expectedDigest:counter.digest})).status,'accepted');
      assert.equal(calls.length,10);assert.equal(x.core.audit(admin).ok,true);
    }finally{server.closeAllConnections();await new Promise(done=>server.close(done));x.core.close();}
  });
});

test('expired acceptance and cancellation drain escrow independently of disabled providers',async()=>{
  await withPolicy(()=>assert.fail('Recovery must not consult providers'),async url=>{
    const x=setup(url),parent=x.native.proposeTrade(x.alice,x.input);try{
      x.core.setRemotePolicyEnabled(admin,{hook:'canTransfer',enabled:false});x.core.setRemotePolicyEnabled(admin,{hook:'canTrade',enabled:false});x.advance();
      assert.equal((await x.core.acceptTradeAsync(x.bob,{key:'expired',tradeId:parent.id,expectedDigest:parent.digest})).status,'expired');
      const second=x.native.proposeTrade(x.alice,{...x.input,key:'second'});assert.equal(x.core.cancelTrade(x.alice,{key:'cancel',tradeId:second.id}).status,'cancelled');assert.equal(x.core.audit(admin).ok,true);
    }finally{x.core.close();}
  });
});

for(const prepared of [false,true])test((prepared?'prepared SQLite':'Memory')+' sale gates cover owned cards and sealed packs without purchase/listing configuration',async()=>{
  await withPolicy((_req,res,data)=>reply(res,allowed(data)),async(url,calls)=>{
    for(const kind of ['copies','packs']){
      const x=setup(url,{prepared,count:1}),seller={...x.alice,role:'admin'};try{
        const shop=x.native.createShop(seller,{key:'shop',name:'Resale',kind:'admin'});let ids;
        if(kind==='copies')ids=x.a.map(c=>c.id);else{x.native.configureCommerce(admin,{key:'packs-on',expectedRevision:0,settings:{packResale:true}});ids=[x.buy().packs[0].id];}
        if(prepared)x.store.prepareRecordTransactions();const input={key:'list',shopId:shop.id,title:'Resale stock',price:{currencyId:'credits',amount:20},items:{kind,ids}},n=calls.length;
        assert.throws(()=>x.core.createListing(seller,input),code('POLICY_ASYNC_REQUIRED'));
        const listing=await x.core.createListingAsync(seller,input);assert.equal(calls.length,n+1);assert.equal(calls.at(-1).context.legs[0].toUserId,null);
        assert.throws(()=>x.core.quoteListing(x.bob,{listingId:listing.id}),code('POLICY_ASYNC_REQUIRED'));
        const quote=await x.core.quoteListingAsync(x.bob,{listingId:listing.id});assert.equal(calls.length,n+3);
        const order=await x.core.buyListingAsync(x.bob,{key:'buy',...quote});assert.equal(calls.length,n+5);assert.equal(order.paid.amount,20);
        x.core.setRemotePolicyEnabled(admin,{hook:'canTransfer',enabled:false});x.core.setRemotePolicyEnabled(admin,{hook:'canTrade',enabled:false});assert.deepEqual(x.core.buyListing(x.bob,{key:'buy',...quote}),order);assert.equal(calls.length,n+5);assert.equal(x.core.audit(admin).ok,true);
      }finally{x.core.close();}
    }
  });
});

test('primary issuance retains its existing policy families and sends no transfer/trade request',async()=>{
  await withPolicy(()=>assert.fail('Primary issuance must not invoke resale gates'),async url=>{
    const x=setup(url),seller={...x.alice,role:'admin'};try{const shop=x.native.createShop(seller,{key:'shop',name:'Primary',kind:'admin'}),listing=await x.core.createListingAsync(seller,{key:'list',shopId:shop.id,title:'Primary card',price:{currencyId:'credits',amount:0},items:{kind:'mint-card',variantId:'dawn.standard',quantity:1}}),quote=await x.core.quoteListingAsync(x.bob,{listingId:listing.id});assert.equal((await x.core.buyListingAsync(x.bob,{key:'buy',...quote})).items.length,1);}finally{x.core.close();}
  });
});

test('worker keeps independent reads and writes live while policy hangs and forwards cancellation and revocation',async()=>{
  let latch=deferred(),release=deferred(),block=true;
  await withPolicy(async(_req,res,data)=>{if(block){latch.resolve();await release.promise;}reply(res,allowed(data));},async url=>{
    const worker=new FrameworkWorkerService({frameworkOptions:{remotePolicies:{canTrade:config(url,'canTrade')}}});await worker.ready;
    try{
      const x=fixture(),catalog=structuredClone(x.c);x.core.close();for(const variant of catalog.variants)variant.bindings={};await worker.publishCatalog(admin,catalog);
      const a=await worker.registerUser(admin,{provider:'test',subject:'alice',displayName:'Alice'}),b=await worker.registerUser(admin,{provider:'test',subject:'bob',displayName:'Bob'}),alice={userId:a.id};
      await worker.grantCurrency(admin,{userId:a.id,currencyId:'credits',amount:100,key:'fund',reason:'Fixture funding'});await worker.prepareRecordTransactions();
      const input={key:'worker-trade',toUserId:b.id,give:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[]}},controller=new AbortController();
      const rejected=assert.rejects(worker.proposeTradeAsync(alice,input,{signal:controller.signal}),code('POLICY_ABORTED'));await latch.promise;
      await worker.grantCurrency(admin,{userId:a.id,currencyId:'gems',amount:1,key:'unrelated',reason:'Fixture update'});assert.equal((await worker.wallet(alice)).gems,1);
      await assert.rejects(worker.setRemotePolicyEnabled(alice,{hook:'canTrade',enabled:false}),code('FORBIDDEN'));controller.abort();await rejected;release.resolve();assert.equal((await worker.wallet(alice)).credits,100);
      latch=deferred();release=deferred();const revoked=assert.rejects(worker.proposeTradeAsync(alice,input),code('POLICY_DISABLED'));await latch.promise;await worker.setRemotePolicyEnabled(admin,{hook:'canTrade',enabled:false});await revoked;release.resolve();
      await worker.setRemotePolicyEnabled(admin,{hook:'canTrade',enabled:true});block=false;const trade=await worker.proposeTradeAsync(alice,input);assert.equal(trade.status,'pending');assert.equal((await worker.wallet(alice)).credits,90);assert.equal((await worker.audit(admin)).ok,true);
    }finally{release.resolve();await worker.close();assert.equal(worker.status().state,'closed');}
  });
});
