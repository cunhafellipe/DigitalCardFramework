import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CardFramework} from '../src/core.js';
import {MemoryStore} from '../src/store.js';
import {SQLiteStore} from '../src/sqlite.js';
import {FrameworkWorkerService} from '../src/framework-worker-service.js';
import {createApiHandler} from '../src/http.js';
import {createRemotePurchasePolicy} from '../src/remote-purchase-policy.js';
import {PolicyProposalCoordinator} from '../src/policy-proposals.js';
import {purchasePolicyProtocol,validatePurchasePolicyRequest,validatePurchasePolicyResponse} from '../src/purchase-policy-contracts.js';
import {fixture,admin} from './helpers.js';

const token='synthetic-purchase-policy-credential';
const config=url=>({scope:'listing',providerId:'example.policy',url,token,allowLoopbackHttp:true});
const errorCode=expected=>error=>error.code===expected;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const identity=request=>Object.fromEntries(Object.entries(request).filter(([key])=>key!=='context'));
const allowed=request=>({...identity(request),status:'allowed'});
const reply=(response,value,status=200)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(value));};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function withPolicy(handler,run){
  const server=createServer(async(request,response)=>{
    try{const chunks=[];for await(const chunk of request)chunks.push(chunk);await handler(request,response,JSON.parse(Buffer.concat(chunks)));}catch{response.destroy();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run('http://127.0.0.1:'+server.address().port+'/purchase-policy');}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
function createFixture(url,{store=new MemoryStore(),prepared=false,policies={},options={}}={}){
  const x=fixture({store});
  const seller={...x.alice,role:'admin'},shop=x.core.createShop(seller,{key:'shop',name:'Fixture shop',kind:'admin'});
  const listing=x.core.createListing(seller,{key:'listing',shopId:shop.id,title:'Fixture stock',price:{currencyId:'credits',amount:20},items:{kind:'mint-card',variantId:'dawn.standard',quantity:2}});
  const quote=x.core.quoteListing(x.bob,{listingId:listing.id});
  x.core=new CardFramework({store,policies,remotePolicies:{canPurchase:{...config(url),...options}}});
  if(prepared)store.prepareRecordTransactions();
  return {...x,store,seller,shop,listing,quote,input:{listingId:quote.listingId,quantity:quote.quantity,unitIds:quote.unitIds,digest:quote.digest,key:'policy-buy'}};
}
function noPurchase(x,{buyer=10000,seller=10000,orders=0}={}){
  assert.equal(x.core.wallet(x.bob).credits,buyer);assert.equal(x.core.wallet(x.alice).credits,seller);
  assert.equal(x.core.orders(x.bob).total,orders);assert.equal(x.core.audit(admin).ok,true);
}
const material=()=>({phase:'purchase',userId:'user-fixture',key:'command-fixture',input:{listingId:randomUUID(),quantity:1},snapshotDigest:'a'.repeat(64),context:{user:{id:'user-fixture'},shop:{id:randomUUID(),ownerId:'seller-fixture',kind:'admin'},listing:{id:randomUUID(),kind:'mint-card',price:{currencyId:'credits',amount:20}},quantity:1,unitIds:[randomUUID()]}});

test('listing policy contract and configuration reject unknown scopes, forged identity and extra authority',async()=>{
  const provider=createRemotePurchasePolicy(config('https://example.com/policy')),coordinator=new PolicyProposalCoordinator(provider),proposal=coordinator.prepare(material());
  assert.equal(proposal.protocol,purchasePolicyProtocol);assert(Object.isFrozen(proposal.context.listing.price));validatePurchasePolicyRequest(proposal);validatePurchasePolicyResponse(allowed(proposal));
  await assert.rejects(provider.evaluate(proposal,{signal:{}}),errorCode('INVALID_POLICY_REQUEST'));
  for(const value of [{...proposal,scope:'all'},{...proposal,operation:'allocate'},{...proposal,requestId:proposal.requestId+'\n'},{...proposal,context:{...proposal.context,permissions:['commerce.manage']}},{...proposal,context:{...proposal.context,user:{...proposal.context.user,code:'SECRET'}}}])assert.throws(()=>validatePurchasePolicyRequest(value),errorCode('INVALID_POLICY_REQUEST'));
  for(const value of [{...allowed(proposal),message:'private detail'},{...allowed(proposal),amount:0},{...allowed(proposal),status:'allow'},{...identity(proposal),status:'denied',reasonCode:'arbitrary'}])assert.throws(()=>validatePurchasePolicyResponse(value),errorCode('INVALID_POLICY_RESPONSE'));
  for(const value of [{...config('https://example.com'),scope:'all'},{...config('https://example.com'),scope:'catalog'},{...config('https://example.com'),scope:undefined}])assert.throws(()=>createRemotePurchasePolicy(value),errorCode('POLICY_UNSUPPORTED'));
  for(const value of [config('http://example.com'),{...config('http://127.0.0.1'),allowLoopbackHttp:false},config('https://example.com/?hidden=1'),config('https://example.com/#hidden'),{...config('https://example.com'),token:'short'},{...config('https://example.com'),token:token+'\n'},{...config('https://example.com'),maxConcurrent:65},{...config('https://example.com'),timeoutMs:0},{...config('https://example.com'),providerId:'example.policy\n'}])assert.throws(()=>createRemotePurchasePolicy(value),errorCode('POLICY_CONFIG'));
  for(const remotePolicies of [{canTransfer:config('https://example.com')},new Date(),Object.create({canPurchase:config('https://example.com')})])assert.throws(()=>new CardFramework({remotePolicies}),errorCode('POLICY_UNSUPPORTED'));provider.close();
});

for(const prepared of [false,true])test((prepared?'prepared SQLite':'Memory')+' remote allow atomically commits stock, receipt and outbox and replays without provider',async()=>{
  let calls=0;
  await withPolicy((request,response,data)=>{
    calls++;assert.equal(request.headers.authorization,'Bearer '+token);assert.equal(request.method,'POST');assert.equal(request.headers['cache-control'],'no-store');validatePurchasePolicyRequest(data);
    assert.deepEqual(Object.keys(data.context).sort(),['listing','quantity','shop','unitIds','user']);assert(!JSON.stringify(data).includes('PRIVATE-DEMO-CODE'));reply(response,allowed(data));
  },async url=>{
    const x=createFixture(url,{store:prepared?new SQLiteStore(':memory:'):new MemoryStore(),prepared});
    try{
      const before=prepared?x.store.diagnostics():null;
      const quote=await x.core.quoteListingAsync(x.bob,{listingId:x.listing.id});assert.deepEqual(quote,x.quote);
      const order=await x.core.buyListingAsync(x.bob,x.input);assert.equal(calls,2);
      if(prepared)assert.equal(x.store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations);
      noPurchase(x,{buyer:9980,seller:10020,orders:1});
      const receipt=x.store.query(q=>q.get('requests',x.bob.userId+':'+x.input.key));assert.equal(receipt.policyAdmission.providerId,'example.policy');assert.equal(receipt.policyAdmission.generation,1);
      x.core.setRemotePolicyEnabled(admin,{hook:'canPurchase',enabled:false});
      assert.deepEqual(await x.core.buyListingAsync(x.bob,x.input),order);assert.deepEqual(x.core.buyListing(x.bob,x.input),order);assert.equal(calls,2);
      await assert.rejects(x.core.buyListingAsync({...x.bob,disabled:true},x.input),errorCode('UNAUTHENTICATED'));
      await assert.rejects(x.core.buyListingAsync(x.alice,x.input),errorCode('FORBIDDEN'));
      await assert.rejects(x.core.buyListingAsync(x.bob,{...x.input,quantity:2}),errorCode('IDEMPOTENCY_CONFLICT'));noPurchase(x,{buyer:9980,seller:10020,orders:1});
    }finally{x.core.close();}
  });
});

test('synchronous core and command-intent entrypoints cannot bypass the configured remote gate',async()=>{
  let calls=0;
  await withPolicy((_request,response,data)=>{calls++;reply(response,allowed(data));},async url=>{
    const x=createFixture(url);
    try{
      assert.throws(()=>x.core.quoteListing(x.bob,{listingId:x.listing.id}),errorCode('POLICY_ASYNC_REQUIRED'));
      assert.throws(()=>x.core.buyListing(x.bob,x.input),errorCode('POLICY_ASYNC_REQUIRED'));
      const intent=x.core.registerCommandIntent(x.bob,{command:'buyListing',input:x.input});
      assert.throws(()=>x.core.executeCommandIntent(x.bob,{id:intent.id}),errorCode('POLICY_ASYNC_REQUIRED'));assert.equal(calls,0);noPurchase(x);
      const result=await x.core.executeCommandIntentAsync(x.bob,{id:intent.id});assert.equal(result.intent.state,'completed');assert.equal(calls,1);
      x.core.setRemotePolicyEnabled(admin,{hook:'canPurchase',enabled:false});
      assert.deepEqual((await x.core.executeCommandIntentAsync(x.bob,{id:intent.id})).result,result.result);assert.equal(calls,1);noPurchase(x,{buyer:9980,seller:10020,orders:1});
    }finally{x.core.close();}
  });
});

test('native direct policy executes once and remote allow cannot override direct or native denial',async()=>{
  for(const decision of [true,false]){
    let directCalls=0;
    await withPolicy((_request,response,data)=>reply(response,allowed(data)),async url=>{
      const x=createFixture(url,{policies:{canPurchase:()=>{directCalls++;return decision;}}});
      try{
        if(decision){await x.core.buyListingAsync(x.bob,x.input);assert.equal(directCalls,1);noPurchase(x,{buyer:9980,seller:10020,orders:1});}
        else{await assert.rejects(x.core.buyListingAsync(x.bob,x.input),errorCode('FORBIDDEN'));assert.equal(directCalls,1);noPurchase(x);}
      }finally{x.core.close();}
    });
  }
  let calls=0;
  await withPolicy((_request,response,data)=>{calls++;reply(response,allowed(data));},async url=>{
    const x=createFixture(url);try{await assert.rejects(x.core.buyListingAsync(x.alice,{...x.input,key:'own-stock'}),errorCode('FORBIDDEN'));assert.equal(calls,0);noPurchase(x);}finally{x.core.close();}
  });
});

test('remote denial and identity/error/JSON tampering never debit or deliver stock',async()=>{
  const variants=[
    [data=>({...identity(data),status:'denied',reasonCode:'ineligible'}),'POLICY_DENIED',200],
    [data=>({...allowed(data),commandId:'b'.repeat(64)}),'INVALID_POLICY_RESPONSE',200],
    [data=>({...allowed(data),snapshotDigest:'b'.repeat(64)}),'INVALID_POLICY_RESPONSE',200],
    [data=>({...allowed(data),inputDigest:'b'.repeat(64)}),'INVALID_POLICY_RESPONSE',200],
    [data=>({...allowed(data),grantId:randomUUID()}),'INVALID_POLICY_RESPONSE',200],
    [data=>({...allowed(data),generation:2}),'INVALID_POLICY_RESPONSE',200],
    [data=>({...allowed(data),requestId:randomUUID()}),'INVALID_POLICY_RESPONSE',200],
    [data=>({...allowed(data),phase:'quote'}),'INVALID_POLICY_RESPONSE',200],
    [data=>({...allowed(data),providerId:'other.policy'}),'INVALID_POLICY_RESPONSE',200],
    [data=>({...allowed(data),deadline:data.deadline+1}),'INVALID_POLICY_RESPONSE',200],
    [data=>({...allowed(data),price:{amount:0}}),'INVALID_POLICY_RESPONSE',200],
    [data=>({...identity(data),status:'error',errorCode:'unavailable'}),'POLICY_UNAVAILABLE',503],
  ];
  for(const [change,expected,status]of variants)await withPolicy((_request,response,data)=>reply(response,change(data),status),async url=>{const x=createFixture(url);try{await assert.rejects(x.core.buyListingAsync(x.bob,x.input),errorCode(expected));noPurchase(x);}finally{x.core.close();}});
  for(const mode of ['duplicate','utf8','compressed','redirect','length','stream'])await withPolicy((_request,response,data)=>{
    const headers={'content-type':'application/json',...(mode==='compressed'?{'content-encoding':'gzip'}:{}),...(mode==='length'?{'content-length':'100000'}:{})};
    response.writeHead(mode==='redirect'?307:200,headers);
    if(mode==='duplicate')response.end(JSON.stringify(allowed(data)).replace('"status":"allowed"','"status":"denied","sta\\u0074us":"allowed"'));
    else if(mode==='utf8')response.end(Buffer.from([0xff,0xfe]));
    else if(mode==='stream')response.end('x'.repeat(9000));
    else response.end(JSON.stringify(allowed(data)));
  },async url=>{const x=createFixture(url);try{await assert.rejects(x.core.buyListingAsync(x.bob,x.input),errorCode(['length','stream'].includes(mode)?'POLICY_LIMIT':mode==='utf8'?'POLICY_UNAVAILABLE':'INVALID_POLICY_RESPONSE'));noPurchase(x);}finally{x.core.close();}});
});

test('immutable dependency conflicts recheck balance, stock, ownership and policy revisions at commit',async()=>{
  const changes=[
    [x=>x.core.grantCurrency(admin,{key:'changed-balance',userId:x.bob.userId,currencyId:'credits',amount:1,reason:'Fixture update'}),'POLICY_STALE',{buyer:10001}],
    [x=>x.core.configureCommerce(admin,{key:'changed-commerce',expectedRevision:0,settings:{enabled:true}}),'POLICY_STALE',{}],
    [x=>x.store.transact(s=>{s.copies[x.storeCopyId].version++;}),'POLICY_STALE',{}],
    [x=>x.core.cancelListing(x.seller,{key:'closed-stock',listingId:x.listing.id}),'LISTING_CLOSED',{}],
    [x=>x.store.transact(s=>{s.copies[x.storeCopyId].ownerId=x.bob.userId;}),'POLICY_STALE',{}],
  ];
  for(const [change,expected,balances]of changes){
    const started=deferred(),release=deferred();
    await withPolicy(async(_request,response,data)=>{started.resolve();await release.promise;reply(response,allowed(data));},async url=>{
      const x=createFixture(url,{store:new SQLiteStore(':memory:'),prepared:true});x.storeCopyId=x.store.query(q=>q.get('listings',x.listing.id).units[0].copyId);
      try{
        const rejected=assert.rejects(x.core.buyListingAsync(x.bob,x.input),errorCode(expected));await started.promise;change(x);release.resolve();await rejected;
        assert.equal(x.core.wallet(x.bob).credits,balances.buyer??10000);assert.equal(x.core.wallet(x.alice).credits,10000);assert.equal(x.core.orders(x.bob).total,0);
        if(expected!=='POLICY_STALE'||balances.buyer)assert.equal(x.core.audit(admin).ok,true);
      }finally{release.resolve();x.core.close();}
    });
  }
});

test('live account restrictions and provider grant revocation invalidate in-flight proposals',async()=>{
  for(const mode of ['account','removed-user','disable','generation','deadline','cancel']){
    const started=deferred(),release=deferred(),closed=deferred();
    await withPolicy(async(_request,response,data)=>{response.on('close',closed.resolve);started.resolve();await release.promise;reply(response,allowed(data));},async url=>{
      const x=createFixture(url,{options:{timeoutMs:mode==='deadline'?50:2000}}),controller=new AbortController();
      try{
        const rejected=assert.rejects(x.core.buyListingAsync(x.bob,x.input,{signal:controller.signal}),errorCode({account:'ACCOUNT_RESTRICTED','removed-user':'UNAUTHENTICATED',disable:'POLICY_DISABLED',generation:'POLICY_STALE',deadline:'POLICY_TIMEOUT',cancel:'POLICY_ABORTED'}[mode]));
        await started.promise;
        if(mode==='account')x.core.configureAdmin(admin,{key:'restrict',expectedRevision:0,scope:'user',targetId:x.bob.userId,changes:{buyingBlocked:true},reason:'Fixture restriction'});
        if(mode==='removed-user')x.store.transact(s=>{delete s.users[x.bob.userId];});
        if(mode==='disable'||mode==='generation'){x.core.setRemotePolicyEnabled(admin,{hook:'canPurchase',enabled:false});if(mode==='generation')x.core.setRemotePolicyEnabled(admin,{hook:'canPurchase',enabled:true});}
        if(mode==='cancel')controller.abort();
        if(!['deadline','disable','generation','cancel'].includes(mode))release.resolve();
        await rejected;if(['deadline','disable','generation','cancel'].includes(mode))await closed.promise;release.resolve();await tick();
        if(mode==='removed-user'){assert.equal(x.store.query(q=>q.get('balances',x.bob.userId)).credits,10000);assert.equal(x.core.orders(x.alice).total,0);}else noPurchase(x);
      }finally{release.resolve();x.core.close();}
    });
  }
});

test('untrusted proposals, cross-coordinator replay and repeated admission are rejected',async()=>{
  await withPolicy((_request,response,data)=>reply(response,allowed(data)),async url=>{
    const provider=createRemotePurchasePolicy(config(url)),coordinator=new PolicyProposalCoordinator(provider),other=new PolicyProposalCoordinator(provider);
    try{
      const proposal=coordinator.prepare(material());
      await assert.rejects(coordinator.evaluate({...proposal}),errorCode('POLICY_PROPOSAL'));
      await coordinator.evaluate(proposal);
      assert.throws(()=>other.admit(proposal,proposal.snapshotDigest),errorCode('POLICY_PROPOSAL'));
      assert.throws(()=>coordinator.admit(proposal,'b'.repeat(64)),errorCode('POLICY_STALE'));
      const admission=coordinator.admit(proposal,proposal.snapshotDigest);assert.equal(admission.commandId,proposal.commandId);
      assert.throws(()=>coordinator.admit(proposal,proposal.snapshotDigest),errorCode('POLICY_PROPOSAL'));
    }finally{provider.close();}
  });
});

test('concurrent identical commands evaluate independently but settle once and share the original receipt',async()=>{
  const started=deferred(),release=deferred();let calls=0;
  await withPolicy(async(_request,response,data)=>{calls++;if(calls===2)started.resolve();await release.promise;reply(response,allowed(data));},async url=>{
    const x=createFixture(url,{store:new SQLiteStore(':memory:'),prepared:true});
    try{const first=x.core.buyListingAsync(x.bob,x.input),second=x.core.buyListingAsync(x.bob,x.input);await started.promise;release.resolve();assert.deepEqual(await first,await second);noPurchase(x,{buyer:9980,seller:10020,orders:1});assert.equal(calls,2);}
    finally{release.resolve();x.core.close();}
  });
});

test('policy controls require operator authority and capacity limits reject without queuing',async()=>{
  const started=deferred(),release=deferred();let calls=0;
  await withPolicy(async(_request,response,data)=>{calls++;started.resolve();await release.promise;reply(response,allowed(data));},async url=>{
    const x=createFixture(url,{options:{maxConcurrent:1}});
    try{
      assert.throws(()=>x.core.setRemotePolicyEnabled(x.bob,{hook:'canPurchase',enabled:false}),errorCode('FORBIDDEN'));
      const first=x.core.buyListingAsync(x.bob,x.input);await started.promise;
      await assert.rejects(x.core.buyListingAsync(x.bob,{...x.input,key:'another'}),errorCode('POLICY_BUSY'));assert.equal(calls,1);release.resolve();await first;noPurchase(x,{buyer:9980,seller:10020,orders:1});
    }finally{release.resolve();x.core.close();}
  });
});

test('durable SQLite result and policy receipt survive reopen with the remote provider unavailable',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'dc-purchase-policy-'));let core;
  try{await withPolicy((_request,response,data)=>reply(response,allowed(data)),async url=>{
    const filename=join(directory,'state.sqlite'),x=createFixture(url,{store:new SQLiteStore(filename),prepared:true});core=x.core;
    const order=await core.buyListingAsync(x.bob,x.input);core.close();core=new CardFramework({store:new SQLiteStore(filename),remotePolicies:{canPurchase:config('https://unavailable.example.invalid/policy')}});
    core.setRemotePolicyEnabled(admin,{hook:'canPurchase',enabled:false});assert.deepEqual(await core.buyListingAsync(x.bob,x.input),order);assert.equal(core.wallet(x.bob).credits,9980);assert.equal(core.audit(admin).ok,true);
  });}finally{core?.close();await rm(directory,{recursive:true,force:true});}
});

test('HTTP listing quote/buy and durable intent dispatch execute the configured policy',async()=>{
  let calls=0;
  await withPolicy((_request,response,data)=>{calls++;reply(response,allowed(data));},async url=>{
    const x=createFixture(url);let origin;
    const server=createServer((req,res)=>createApiHandler({framework:x.core,resolveIdentity:()=>x.bob,allowedOrigin:origin,requirePrincipal:true})(req,res));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
    const post=async(path,input)=>{const response=await fetch(origin+'/api/'+path,{method:'POST',headers:{origin,'content-type':'application/json','x-dc-principal':x.bob.userId},body:JSON.stringify(input)});assert.equal(response.status,200);return response.json();};
    try{await post('listings/quote',{listingId:x.listing.id});await post('listings/buy',x.input);const intent=await post('command-intents',{command:'buyListing',input:x.input});await post('command-intents/execute',{id:intent.id});assert.equal(calls,2);noPurchase(x,{buyer:9980,seller:10020,orders:1});}
    finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));x.core.close();}
  });
});

test('worker policy wait holds no database transaction; independent writes, cancellation and close drain progress',async()=>{
  const started=deferred(),closed=deferred(),release=deferred();let block=true;
  await withPolicy(async(_request,response,data)=>{
    if(data.phase==='purchase'&&block){response.on('close',closed.resolve);started.resolve();await release.promise;}
    reply(response,allowed(data));
  },async url=>{
    const worker=new FrameworkWorkerService({frameworkOptions:{remotePolicies:{canPurchase:config(url)}}});await worker.ready;
    try{
      const x=fixture();const catalog=structuredClone(x.c);x.core.close();for(const variant of catalog.variants)variant.bindings={};
      await worker.publishCatalog(admin,catalog);
      const a=await worker.registerUser(admin,{provider:'test',subject:'seller',displayName:'Seller'}),b=await worker.registerUser(admin,{provider:'test',subject:'buyer',displayName:'Buyer'}),seller={userId:a.id,role:'admin'},buyer={userId:b.id};
      for(const user of [a,b])await worker.grantCurrency(admin,{userId:user.id,currencyId:'credits',amount:10000,key:'fund',reason:'Fixture funding'});
      const shop=await worker.createShop(seller,{key:'shop',name:'Worker shop',kind:'admin'}),listing=await worker.createListing(seller,{key:'listing',shopId:shop.id,title:'Worker stock',price:{currencyId:'credits',amount:20},items:{kind:'mint-card',variantId:'dawn.standard',quantity:2}});
      await worker.prepareRecordTransactions();const quote=await worker.quoteListingAsync(buyer,{listingId:listing.id}),controller=new AbortController();
      const rejected=assert.rejects(worker.buyListingAsync(buyer,{...quote,key:'worker-buy'},{signal:controller.signal}),errorCode('POLICY_ABORTED'));
      await started.promise;
      await worker.grantCurrency(admin,{userId:a.id,currencyId:'gems',amount:1,key:'independent',reason:'Fixture update'});
      assert.equal((await worker.wallet(seller)).gems,1);assert.equal((await worker.wallet(buyer)).credits,10000);
      controller.abort();await rejected;await closed.promise;release.resolve();block=false;
      await assert.rejects(worker.buyListingAsync(buyer,{...quote,key:'invalid-signal'},{signal:{}}),errorCode('WORKER_TRANSPORT'));
      const pending=worker.buyListingAsync(buyer,{...quote,key:'worker-buy'}),closing=worker.close();
      assert.equal((await pending).paid.amount,20);await closing;
    }finally{release.resolve();await worker.close();assert.equal(worker.status().state,'closed');}
  });
});
