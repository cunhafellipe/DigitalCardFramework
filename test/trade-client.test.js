import test from 'node:test';import assert from 'node:assert/strict';import {createTradeDraft} from '../src/trade-client.js';
const card=(id,ownerId)=>({id,ownerId,version:3,tradable:true,definition:{name:id}});
const catalog={features:{cardTrading:true,currencyTrading:true},currencies:[{id:'credits',tradable:true},{id:'stamps',tradable:false}]};
function fixture(){const a=card('a','alice'),b=card('b','bob'),client={tradeInventory:async id=>({owner:{id,name:id},items:[id==='alice'?a:b],next:null})};return {a,b,client,catalog,userId:'alice'};}
test('currency-only hosts prevent card selection while allowing money offers',async()=>{const x=fixture(),draft=createTradeDraft({...x,catalog:{...catalog,features:{cardTrading:false,currencyTrading:true}}});await draft.load('bob');assert.throws(()=>draft.add('give','a'),/not available/);draft.setCurrency('give','credits',5);draft.review();assert.deepEqual(draft.buildOffer().give.currencies,[{currencyId:'credits',amount:5}]);});
test('trade draft selection carries copy versions, review resets on edits and nontradable currency fails',async()=>{
  const x=fixture(),draft=createTradeDraft(x);await draft.load('bob');draft.add('give','a');draft.add('receive','b');assert.throws(()=>draft.buildOffer(),/Review/);draft.review();assert.deepEqual(draft.buildOffer().versions,{a:3,b:3});draft.setCurrency('give','credits',10);assert(!draft.getState().reviewed);assert.throws(()=>draft.setCurrency('give','stamps',10),/not tradable/);draft.review();assert.equal(draft.buildOffer().give.currencies[0].amount,10);draft.remove('give','a');assert(!draft.getState().reviewed);
});
test('obsolete recipient inventory loads and disposed controllers cannot publish late results',async()=>{
  const x=fixture();let resolveOld;const client={tradeInventory:id=>id==='old'?new Promise(resolve=>resolveOld=resolve):x.client.tradeInventory(id)};const draft=createTradeDraft({...x,client});const old=draft.load('old');await draft.load('bob');resolveOld({owner:{id:'old'},items:[card('old','old')]});await old;assert.equal(draft.getState().partner.id,'bob');let calls=0;draft.subscribe(()=>calls++);draft.dispose();draft.review();assert.equal(calls,1);
});
test('draft restoration persists only IDs and intentions and never caches attached codes',async()=>{
  const x=fixture();x.a.bindings={secret:{data:{code:'TOP-SECRET'}}};const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};const first=createTradeDraft({...x,storage});await first.load('bob');first.add('give','a');first.setMessage('hello');assert(![...data.values()].join('').includes('TOP-SECRET'));first.dispose();const next=createTradeDraft({...x,storage});await next.load('bob');assert.deepEqual(next.getState().give,['a']);assert.equal(next.getState().message,'hello');assert(!next.getState().reviewed);
});

const allowed=(input,expiresAt=new Date(Date.now()+60000).toISOString())=>({status:'allowed',inputDigest:'a'.repeat(64),snapshotDigest:'b'.repeat(64),expiresAt,copyIds:[...new Set([...input.give.copyIds,...input.receive.copyIds])]});
test('remote-required selections need a batch review and cannot bypass native or currency restrictions',async()=>{
  const x=fixture();x.a.tradable=false;x.a.remoteReviewRequired=true;x.b.tradable=false;x.b.untradableReason='Binding blocks transfer';
  const unsupported=createTradeDraft(x);await unsupported.load('bob');unsupported.add('give','a');assert.throws(()=>unsupported.review(),/reviewAsync/);await unsupported.reviewAsync();assert.match(unsupported.getState().error,/unavailable/);assert.throws(()=>unsupported.buildOffer(),/Review/);unsupported.dispose();
  let resolve,request,signal;x.client.reviewTransfer=(input,options)=>{request=input;signal=options.signal;return new Promise(r=>resolve=r);};
  const draft=createTradeDraft(x);try{await draft.load('bob');draft.add('give','a');assert.throws(()=>draft.add('receive','b'),/Binding blocks/);assert.throws(()=>draft.setCurrency('give','stamps',1),/not tradable/);
    const pending=draft.reviewAsync();assert.equal(draft.getState().reviewPhase,'pending');assert(!draft.getState().reviewed);assert.throws(()=>draft.buildOffer(),/Review/);assert.deepEqual(request.versions,{a:3});assert(signal instanceof AbortSignal);resolve(allowed(request));await pending;assert.equal(draft.getState().reviewPhase,'allowed');assert.equal(draft.buildOffer().give.copyIds[0],'a');
  }finally{draft.dispose();}
  const disabled=createTradeDraft({...x,catalog:{...catalog,features:{cardTrading:false,currencyTrading:true}}});try{await disabled.load('bob');assert.throws(()=>disabled.add('give','a'),/not available/);}finally{disabled.dispose();}
});
test('remote review covers currency-only offers, preserves denial and supports deliberate re-review',async()=>{
  const x=fixture(),requests=[];let deny=true;x.client.reviewTransfer=async input=>{requests.push(input);if(deny)throw new Error('Exchange is not permitted');return allowed(input);};
  const draft=createTradeDraft(x);try{await draft.load('bob');draft.setCurrency('receive','credits',5);assert.throws(()=>draft.review(),/reviewAsync/);await draft.reviewAsync();assert.equal(draft.getState().reviewPhase,'error');assert.match(draft.getState().error,/not permitted/);assert(!draft.getState().reviewed);deny=false;await draft.reviewAsync();assert.deepEqual(draft.buildOffer().receive.currencies,[{currencyId:'credits',amount:5}]);draft.setCurrency('receive','credits',6);assert.equal(draft.getState().reviewExpiresAt,null);await draft.reviewAsync();assert.equal(requests.length,3);assert.equal(requests[2].receive.currencies[0].amount,6);}finally{draft.dispose();}
});
test('late remote reviews are aborted and ignored after edits, recipient changes, clear and disposal',async()=>{
  for(const change of ['edit','recipient','clear','dispose']){const x=fixture();let resolve,signal,input;x.client.reviewTransfer=(value,options)=>{input=value;signal=options.signal;return new Promise(r=>resolve=r);};
    const draft=createTradeDraft(x);await draft.load('bob');draft.add('give','a');const pending=draft.reviewAsync();let notifications=0;draft.subscribe(()=>notifications++);
    if(change==='edit')draft.setMessage('Changed');else if(change==='recipient')await draft.load('another');else if(change==='clear')draft.clear();else draft.dispose();const before=notifications;
    assert(signal.aborted);resolve(allowed(input));await pending;assert.equal(notifications,before);assert(!draft.getState().reviewed);draft.dispose();
  }
});
test('stale, mismatched and malformed advisory replies cannot confirm a draft',async()=>{
  const mutations=[result=>({...result,status:'denied'}),result=>({...result,inputDigest:'invalid'}),result=>({...result,copyIds:['other']}),result=>({...result,expiresAt:'invalid'}),result=>({...result,expiresAt:new Date(Date.now()-1).toISOString()})];
  for(const mutate of mutations){const x=fixture();x.client.reviewTransfer=async input=>mutate(allowed(input));const draft=createTradeDraft(x);try{await draft.load('bob');draft.add('give','a');await draft.reviewAsync();assert(!draft.getState().reviewed);assert.equal(draft.getState().reviewPhase,'error');assert.throws(()=>draft.buildOffer(),/Review/);}finally{draft.dispose();}}
});
test('a newer review wins over older replies and confirmation expires until reviewed again',async()=>{
  const x=fixture(),pending=[];x.client.reviewTransfer=input=>new Promise(resolve=>pending.push({input,resolve}));const draft=createTradeDraft(x);
  try{await draft.load('bob');draft.add('give','a');const first=draft.reviewAsync(),second=draft.reviewAsync();pending[1].resolve(allowed(pending[1].input));await second;pending[0].resolve(allowed(pending[0].input,new Date(Date.now()-1).toISOString()));await first;assert(draft.getState().reviewed);
    const original=Date.now,expired=Date.parse(draft.getState().reviewExpiresAt)+1;try{Date.now=()=>expired;assert.throws(()=>draft.buildOffer(),/expired/);assert(!draft.getState().reviewed);}finally{Date.now=original;}
    const third=draft.reviewAsync();pending[2].resolve(allowed(pending[2].input));await third;assert(draft.buildOffer());
  }finally{draft.dispose();}
});
test('counter draft reviews carry parent digest and copy versions without releasing reservations',async()=>{
  const x=fixture();x.b.tradable=false;x.b.lockedBy='parent';x.b.untradableReason='Reserved by another transaction';let request;x.client.reviewTransfer=async input=>{request=input;return allowed(input);};
  const draft=createTradeDraft({...x,parentTradeId:'parent',expectedDigest:'c'.repeat(64)});try{await draft.load('bob');draft.add('receive','b');await draft.reviewAsync();assert.equal(request.parentTradeId,'parent');assert.equal(request.expectedDigest,'c'.repeat(64));assert.deepEqual(request.versions,{b:3});assert.equal(draft.getState().selectedReceive[0].lockedBy,'parent');assert(draft.buildOffer());}finally{draft.dispose();}
  x.b.untradableReason='Host policy blocks transfer';const blocked=createTradeDraft({...x,parentTradeId:'parent'});try{await blocked.load('bob');assert.throws(()=>blocked.add('receive','b'),/Host policy/);}finally{blocked.dispose();}
});
test('a pending review subscriber can dispose or edit before remote dispatch',async()=>{
  for(const dispose of [true,false]){const x=fixture();let calls=0;x.client.reviewTransfer=async input=>{calls++;return allowed(input);};const draft=createTradeDraft(x);await draft.load('bob');draft.add('give','a');draft.subscribe(state=>{if(state.reviewPhase==='pending'){if(dispose)draft.dispose();else draft.setMessage('Changed before dispatch');}});await draft.reviewAsync();assert.equal(calls,0);assert(!draft.getState().reviewed);draft.dispose();}
});


test('trade failures retain diagnostic codes and clear them on a successful reload',async()=>{
  const failure=Object.assign(new Error('Raw inventory detail'),{code:'INVENTORY_PRIVATE',status:403});let fail=true;
  const draft=createTradeDraft({userId:'owner',catalog:{features:{cardTrading:true},currencies:[]},client:{tradeInventory:async()=>{if(fail)throw failure;return {owner:{id:'owner'},items:[],next:null};}}});
  await draft.load();assert.equal(draft.getState().error,'Raw inventory detail');assert.equal(draft.getState().diagnostic.code,'INVENTORY_PRIVATE');
  fail=false;await draft.load();assert.equal(draft.getState().error,null);assert.equal(draft.getState().diagnostic,null);assert.equal(failure.status,403);draft.dispose();
});
