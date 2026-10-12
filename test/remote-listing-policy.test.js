import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {CardFramework} from '../src/core.js';
import {MemoryStore} from '../src/store.js';
import {SQLiteStore} from '../src/sqlite.js';
import {FrameworkWorkerService} from '../src/framework-worker-service.js';
import {createApiHandler} from '../src/http.js';
import {createRemoteListingPolicy} from '../src/remote-listing-policy.js';
import {listingPolicyProtocol,validateListingPolicyRequest,validateListingPolicyResponse} from '../src/listing-policy-contracts.js';
import {PolicyProposalCoordinator} from '../src/policy-proposals.js';
import {contentDigest} from '../src/importer.js';
import {fixture,admin} from './helpers.js';
import {codesFixture,vault} from './codes-fixtures.mjs';

const token='synthetic-listing-policy-credential';
const config=url=>({scope:'listing',providerId:'example.listing',url,token,allowLoopbackHttp:true});
const errorCode=expected=>error=>error.code===expected;
const identity=request=>Object.fromEntries(Object.entries(request).filter(([key])=>key!=='context'));
const allowed=request=>({...identity(request),status:'allowed'});
const reply=(response,value,status=200)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(value));};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function withPolicy(handler,run){
  const server=createServer(async(request,response)=>{try{const chunks=[];for await(const chunk of request)chunks.push(chunk);await handler(request,response,JSON.parse(Buffer.concat(chunks)));}catch{response.destroy();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run('http://127.0.0.1:'+server.address().port+'/listing-policy');}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
function makeFixture(url,{kind='mint-card',prepared=false,policies={},options={},codes=false}={}){
  const store=prepared?new SQLiteStore(':memory:'):new MemoryStore(),counts={random:0,factory:0,direct:0};let now='2026-10-01T00:00:00.000Z';
  const clock=()=>now,random=()=>{counts.random++;return 0;},bindings={'demo.code':()=>{counts.factory++;return {code:'SYNTHETIC-BINDING'};}};
  const x=(codes?codesFixture:fixture)({store,clock,random,bindings,change(c){c.variants.find(v=>v.id==='dawn.standard').bindings={'demo.code':{visibility:'owner',transfer:'retain',factory:'demo.code',data:{}}};}});const native=x.core,seller={...x.alice,role:'admin'};
  const shop=native.createShop(seller,{key:'fixture-shop',name:'Fixture shop',kind:'admin'});
  let items;
  if(kind==='copies')items={kind,ids:[x.open()[0].id]};
  else if(kind==='packs'){native.configureCommerce(admin,{key:'resale',expectedRevision:0,settings:{packResale:true}});items={kind,ids:[x.buy().packs[0].id]};}
  else if(kind==='mint-card')items={kind,variantId:codes?'reward.standard':'dawn.standard',quantity:2};
  else if(kind==='mint-pack')items={kind,productId:codes?'bundle':'common',quantity:2};
  else items={kind:'action',handler:'example.fulfill',quantity:2,params:{material:'SYNTHETIC-ACTION-DATA'}};
  x.core=new CardFramework({store,clock,random,bindings,codeVault:codes?vault():undefined,policies:{canList:context=>{counts.direct++;return policies.canList?policies.canList(context):true;},...policies},remotePolicies:{canList:{...config(url),...options}}});
  if(prepared)store.prepareRecordTransactions();
  const input={key:'remote-listing',shopId:shop.id,title:'Fixture listing',price:{currencyId:'credits',amount:20},items};
  return {...x,store,native,seller,shop,input,counts,clock,advance:()=>{now='2026-10-02T00:00:00.000Z';}};
}
function allocationDigest(x){return x.store.query(q=>contentDigest(Object.fromEntries(['supply','copies','packs','codes','listings'].map(field=>[field,q.value(field)??{}]))));}
function noEffects(x,before,counts){assert.equal(allocationDigest(x),before);assert.deepEqual(x.counts,counts);assert.equal(x.core.audit(admin).ok,true);}

test('listing contract exposes only requested stock summaries and rejects unsupported authority',async()=>{
  const provider=createRemoteListingPolicy(config('https://example.com/policy'));
  const coordinator=new PolicyProposalCoordinator(provider,{protocol:listingPolicyProtocol,operation:'canList',validateRequest:validateListingPolicyRequest});
  const proposal=coordinator.prepare({phase:'create',userId:'actor',key:'stable',input:{stock:'fixture'},snapshotDigest:'a'.repeat(64),context:{actor:{id:'actor'},shop:{id:randomUUID(),ownerId:'owner',kind:'admin'},price:{currencyId:'credits',amount:20},stock:{kind:'mint-card',variantId:'fixture.standard',quantity:2}}});
  validateListingPolicyRequest(proposal);validateListingPolicyResponse(allowed(proposal));
  for(const value of [{...proposal,operation:'canPurchase'},{...proposal,phase:'purchase'},{...proposal,context:{...proposal.context,stock:{...proposal.context.stock,code:'SYNTHETIC-CODE'}}},{...proposal,context:{...proposal.context,stock:{kind:'action',handler:'constructor',quantity:1}}}])assert.throws(()=>validateListingPolicyRequest(value),errorCode('INVALID_POLICY_REQUEST'));
  for(const value of [{...allowed(proposal),listingId:randomUUID()},{...allowed(proposal),status:'allowed',amount:0},{...allowed(proposal),protocol:'digital-card-listing-policy@2'}])assert.throws(()=>validateListingPolicyResponse(value),errorCode('INVALID_POLICY_RESPONSE'));
  await assert.rejects(provider.evaluate(proposal,{signal:{}}),errorCode('INVALID_POLICY_REQUEST'));provider.close();
});

for(const prepared of [false,true])test((prepared?'prepared SQLite':'Memory')+' evaluates all five listing kinds before one native allocation and replays stable keys',async()=>{
  for(const kind of ['copies','packs','mint-card','mint-pack','action']){
    let calls=0;
    await withPolicy((request,response,data)=>{
      calls++;assert.equal(request.headers.authorization,'Bearer '+token);assert.equal(request.method,'POST');validateListingPolicyRequest(data);
      assert.equal(data.operation,'canList');assert.equal(data.context.stock.kind,kind);assert(!JSON.stringify(data).includes('SYNTHETIC-BINDING'));assert(!JSON.stringify(data).includes('SYNTHETIC-ACTION-DATA'));reply(response,allowed(data));
    },async url=>{
      const x=makeFixture(url,{kind,prepared});const counts={...x.counts};
      try{
        const before=prepared?x.store.diagnostics().compatibilityMaterializations:0;
        const result=await x.core.createListingAsync(x.seller,x.input);
        if(prepared)assert.equal(x.store.diagnostics().compatibilityMaterializations,before);
        assert.equal(calls,1);assert.equal(x.counts.direct,1);
        if(kind==='mint-pack')assert(x.counts.random>counts.random);else assert.equal(x.counts.random,counts.random);
        if(['mint-card','mint-pack'].includes(kind))assert.equal(x.counts.factory-counts.factory,2);else assert.equal(x.counts.factory,counts.factory);
        const receipt=x.store.query(q=>q.get('requests',x.seller.userId+':'+x.input.key));assert.equal(receipt.policyAdmission.providerId,'example.listing');
        const after=allocationDigest(x),afterCounts={...x.counts};x.advance();x.core.setRemotePolicyEnabled(admin,{hook:'canList',enabled:false});
        assert.deepEqual(await x.core.createListingAsync(x.seller,x.input),result);assert.deepEqual(x.core.createListing(x.seller,x.input),result);assert.equal(calls,1);noEffects(x,after,afterCounts);
        await assert.rejects(x.core.createListingAsync({...x.seller,disabled:true},x.input),errorCode('UNAUTHENTICATED'));
        await assert.rejects(x.core.createListingAsync(x.seller,{...x.input,title:'Changed'}),errorCode('IDEMPOTENCY_CONFLICT'));
      }finally{x.core.close();}
    });
  }
});

test('denied, stale, cancelled and revoked proposals consume no entropy or binding factories',async()=>{
  for(const mode of ['deny','stale','cancel','disable','generation','timeout'])for(const kind of ['mint-card','mint-pack']){
    const started=deferred(),release=deferred(),closed=deferred();
    await withPolicy(async(_request,response,data)=>{response.on('close',closed.resolve);started.resolve();await release.promise;reply(response,mode==='deny'?{...identity(data),status:'denied',reasonCode:'restricted'}:allowed(data));},async url=>{
      const x=makeFixture(url,{kind,prepared:true,options:{timeoutMs:mode==='timeout'?100:2000}}),controller=new AbortController();
      const before=allocationDigest(x),counts={...x.counts};
      try{
        const rejected=assert.rejects(x.core.createListingAsync(x.seller,x.input,{signal:controller.signal}),errorCode({deny:'POLICY_DENIED',stale:'POLICY_STALE',cancel:'POLICY_ABORTED',disable:'POLICY_DISABLED',generation:'POLICY_STALE',timeout:'POLICY_TIMEOUT'}[mode]));
        await started.promise;assert.equal(allocationDigest(x),before);assert.deepEqual(x.counts,counts);
        if(mode==='stale')x.core.configureCommerce(admin,{key:'revision',expectedRevision:0,settings:{enabled:true}});
        if(mode==='cancel')controller.abort();
        if(['disable','generation'].includes(mode)){x.core.setRemotePolicyEnabled(admin,{hook:'canList',enabled:false});if(mode==='generation')x.core.setRemotePolicyEnabled(admin,{hook:'canList',enabled:true});}
        if(['deny','stale'].includes(mode))release.resolve();
        await rejected;if(['cancel','disable','generation','timeout'].includes(mode))await closed.promise;release.resolve();noEffects(x,before,counts);
      }finally{release.resolve();x.core.close();}
    });
  }
});

test('native direct canList executes exactly once at commit and keeps final veto authority',async()=>{
  await withPolicy((_request,response,data)=>reply(response,allowed(data)),async url=>{
    let direct=0;const x=makeFixture(url,{kind:'action',policies:{canList:()=>{direct++;return false;}}});const before=allocationDigest(x),counts={...x.counts};
    try{await assert.rejects(x.core.createListingAsync(x.seller,x.input),errorCode('FORBIDDEN'));assert.equal(direct,1);noEffects(x,before,counts);}finally{x.core.close();}
  });
});

test('owned stock, user authority and native controls are checked again before reservation',async()=>{
  for(const mode of ['version','lock','shop-disabled','selling-blocked','user-removed']){
    const started=deferred(),release=deferred();
    await withPolicy(async(_request,response,data)=>{started.resolve();await release.promise;reply(response,allowed(data));},async url=>{
      const x=makeFixture(url,{kind:'copies',prepared:true}),copyId=x.input.items.ids[0];const counts={...x.counts};
      try{
        const rejected=assert.rejects(x.core.createListingAsync(x.seller,x.input),errorCode({version:'POLICY_STALE',lock:'CARD_LOCKED','shop-disabled':'SHOP_DISABLED','selling-blocked':'ACCOUNT_RESTRICTED','user-removed':'UNAUTHENTICATED'}[mode]));
        await started.promise;
        if(mode==='version')x.store.transact(s=>{s.copies[copyId].version++;});
        if(mode==='lock')x.store.transact(s=>{s.copies[copyId].lockedBy='fixture-lock';});
        if(mode==='shop-disabled')x.core.setShopEnabled(x.seller,{key:'disable-shop',shopId:x.shop.id,enabled:false});
        if(mode==='selling-blocked')x.core.configureAdmin(admin,{key:'block-sales',expectedRevision:0,scope:'user',targetId:x.alice.userId,changes:{sellingBlocked:true},reason:'Fixture restriction'});
        if(mode==='user-removed')x.store.transact(s=>{delete s.users[x.seller.userId];});
        const after=allocationDigest(x);release.resolve();await rejected;assert.equal(allocationDigest(x),after);assert.deepEqual(x.counts,counts);
        if(!['lock','user-removed'].includes(mode))assert.equal(x.core.audit(admin).ok,true);
      }finally{release.resolve();x.core.close();}
    });
  }
});

test('bounded code-stock readiness reads never reveal or allocate code material before approval',async()=>{
  for(const mode of ['allow','deny','pool-disabled']){
    const started=deferred(),release=deferred();
    await withPolicy(async(_request,response,data)=>{assert(!JSON.stringify(data).includes('SECRET-REWARD'));assert.deepEqual(data.context.stock,{kind:'mint-card',variantId:'reward.standard',quantity:2});started.resolve();await release.promise;reply(response,mode==='deny'?{...identity(data),status:'denied',reasonCode:'ineligible'}:allowed(data));},async url=>{
      const x=makeFixture(url,{codes:true,prepared:true}),before=allocationDigest(x),counts={...x.counts};
      try{
        const pending=x.core.createListingAsync(x.seller,x.input),rejected=mode==='allow'?null:assert.rejects(pending,errorCode(mode==='deny'?'POLICY_DENIED':'CODE_STOCK'));
        await started.promise;assert.equal(allocationDigest(x),before);assert.deepEqual(x.counts,counts);
        if(mode==='pool-disabled')x.core.configureCodePool(admin,{key:'disabled-pool',pool:{id:'rewards',providerId:'example.game',name:'Game code',enabled:false}});
        release.resolve();if(rejected)await rejected;else{await pending;assert.equal(x.store.query(q=>q.availableCodeStock('rewards',100,x.clock())).length,6);}
        if(mode!=='allow')noEffects(x,before,counts);else assert.equal(x.core.audit(admin).ok,true);
      }finally{release.resolve();x.core.close();}
    });
  }
});

test('implicit start time is fixed during evaluation and old synchronous receipts retain fingerprint parity',async()=>{
  const started=deferred(),release=deferred();let calls=0;
  await withPolicy(async(_request,response,data)=>{calls++;started.resolve();await release.promise;reply(response,allowed(data));},async url=>{
    const x=makeFixture(url,{kind:'action'});
    try{
      const pending=x.core.createListingAsync(x.seller,x.input);await started.promise;x.advance();release.resolve();const result=await pending;assert.equal(result.startsAt,'2026-10-01T00:00:00.000Z');
      const legacyInput={...x.input,key:'legacy-listing'},legacy=x.native.createListing(x.seller,legacyInput);x.core.setRemotePolicyEnabled(admin,{hook:'canList',enabled:false});
      assert.deepEqual(await x.core.createListingAsync(x.seller,legacyInput),legacy);assert.equal(calls,1);
    }finally{release.resolve();x.core.close();}
  });
});

test('sync calls cannot bypass creation gate; HTTP and durable async intent evaluate it',async()=>{
  let calls=0;
  await withPolicy((_request,response,data)=>{calls++;reply(response,allowed(data));},async url=>{
    const x=makeFixture(url,{kind:'action'});let origin;
    const server=createServer((req,res)=>createApiHandler({framework:x.core,resolveIdentity:()=>x.seller,allowedOrigin:origin,requirePrincipal:true})(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
    const post=async(path,input)=>{const response=await fetch(origin+'/api/'+path,{method:'POST',headers:{origin,'content-type':'application/json','x-dc-principal':x.seller.userId},body:JSON.stringify(input)});assert.equal(response.status,200);return response.json();};
    try{
      assert.throws(()=>x.core.createListing(x.seller,x.input),errorCode('POLICY_ASYNC_REQUIRED'));
      const intent=x.core.registerCommandIntent(x.seller,{command:'createListing',input:x.input});assert.throws(()=>x.core.executeCommandIntent(x.seller,{id:intent.id}),errorCode('POLICY_ASYNC_REQUIRED'));assert.equal(calls,0);
      const result=await post('command-intents/execute',{id:intent.id});assert.equal(result.intent.state,'completed');assert.equal(calls,1);
      x.core.setRemotePolicyEnabled(admin,{hook:'canList',enabled:false});assert.deepEqual((await post('command-intents/execute',{id:intent.id})).result,result.result);assert.equal(calls,1);
      x.core.setRemotePolicyEnabled(admin,{hook:'canList',enabled:true});await post('listings',{...x.input,key:'via-http'});assert.equal(calls,2);assert.equal(x.core.audit(admin).ok,true);
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));x.core.close();}
  });
});

test('owning worker evaluates outside storage locks and forwards creation cancellation without side effects',async()=>{
  const started=deferred(),closed=deferred(),release=deferred();
  await withPolicy(async(_request,response,data)=>{response.on('close',closed.resolve);started.resolve();await release.promise;reply(response,allowed(data));},async url=>{
    const worker=new FrameworkWorkerService({frameworkOptions:{remotePolicies:{canList:config(url)}}});await worker.ready;
    try{
      const x=fixture(),catalog=structuredClone(x.c);x.core.close();for(const variant of catalog.variants)variant.bindings={};await worker.publishCatalog(admin,catalog);
      const user=await worker.registerUser(admin,{provider:'test',subject:'seller',displayName:'Seller'}),seller={userId:user.id,role:'admin'};
      await worker.grantCurrency(admin,{userId:user.id,currencyId:'credits',amount:10000,key:'fund',reason:'Fixture funding'});
      const shop=await worker.createShop(seller,{key:'shop',name:'Worker shop',kind:'admin'});await worker.prepareRecordTransactions();
      const input={key:'worker-listing',shopId:shop.id,title:'Worker stock',price:{currencyId:'credits',amount:20},items:{kind:'mint-card',variantId:'dawn.standard',quantity:2}};
      await assert.rejects(worker.createListing(seller,input),errorCode('POLICY_ASYNC_REQUIRED'));
      const controller=new AbortController(),rejected=assert.rejects(worker.createListingAsync(seller,input,{signal:controller.signal}),errorCode('POLICY_ABORTED'));await started.promise;
      await worker.grantCurrency(admin,{userId:user.id,currencyId:'gems',amount:1,key:'unrelated',reason:'Fixture update'});assert.equal((await worker.wallet(seller)).gems,1);
      await assert.rejects(worker.setRemotePolicyEnabled(seller.userId?{userId:user.id}:null,{hook:'canList',enabled:false}),errorCode('FORBIDDEN'));
      controller.abort();await rejected;await closed.promise;release.resolve();assert.equal((await worker.listings(seller)).total,0);assert.equal((await worker.audit(admin)).ok,true);
    }finally{release.resolve();await worker.close();assert.equal(worker.status().state,'closed');}
  });
});

test('malformed or mismatched remote decisions cannot allocate or reserve listing stock',async()=>{
  for(const change of [data=>({...allowed(data),operation:'canPurchase'}),data=>({...allowed(data),commandId:'b'.repeat(64)}),data=>({...allowed(data),snapshotDigest:'b'.repeat(64)}),data=>({...allowed(data),providerId:'other.listing'}),data=>({...allowed(data),generation:2}),data=>({...allowed(data),amount:0})])await withPolicy((_request,response,data)=>reply(response,change(data)),async url=>{
    const x=makeFixture(url,{kind:'mint-pack'}),before=allocationDigest(x),counts={...x.counts};try{await assert.rejects(x.core.createListingAsync(x.seller,x.input),errorCode('INVALID_POLICY_RESPONSE'));noEffects(x,before,counts);}finally{x.core.close();}
  });
});
