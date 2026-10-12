import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {FrameworkWorkerService} from '../src/framework-worker-service.js';
import {FrameworkError} from '../src/catalog.js';
import {SessionStore,createAuthHost} from '../src/auth.js';
import {sampleCatalog} from '../examples/catalog.js';

const admin = {role:'admin'};
const extensionModule = fileURLToPath(new URL('./fixtures/framework-worker-extension.js',import.meta.url));
const code = expected => error => error instanceof FrameworkError && error.code === expected;
const services = new WeakMap();
function catalog() {
  const c = structuredClone(sampleCatalog);
  c.version = 1;
  c.products.push(...[['worker','dawn.standard'],['last','solstice.unique'],['binding','solstice.unique']].map(([id,variantId]) => ({
    id,lineId:'sky',name:id,revision:1,price:{currencyId:'credits',amount:10},slots:[{count:1,pool:[{variantId,weight:1}]}],
  })));
  return c;
}
function disk(t) {
  const dir = mkdtempSync(join(tmpdir(),'framework-worker-'));
  t.after(async () => {
    for (const service of services.get(t) ?? []) {
      if (service.status().state === 'failed') await service.terminate();
      else await service.close();
    }
    rmSync(dir,{recursive:true,force:true});
  });
  return {dir,filename:join(dir,'state.sqlite'),storeOptions:{encryptionKey:randomBytes(32)}};
}
async function start(t,options) {
  const service = new FrameworkWorkerService({extensionModule,...options});
  if (!services.has(t)) services.set(t,[]);
  services.get(t).push(service);
  t.after(async () => { if (!['closed','failed'].includes(service.status().state)) await service.close(); });
  await service.ready;
  return service;
}
async function initialize(service) {
  await service.publishCatalog(admin,catalog());
  const user = await service.registerUser(admin,{provider:'test',subject:'collector',displayName:'Collector'});
  const other = await service.registerUser(admin,{provider:'test',subject:'other',displayName:'Other'});
  for (const u of [user,other]) await service.grantCurrency(admin,{userId:u.id,currencyId:'credits',amount:1000,reason:'Test funding',key:'fund'});
  return {actor:{userId:user.id},other:{userId:other.id}};
}
async function input(service,actor,key = 'buy',productId = 'worker') {
  return {...await service.quote(actor,{productId}),key};
}
async function entered(path) {
  const until = Date.now() + 3000;
  while (!existsSync(path)) {
    if (Date.now() > until) assert.fail('Worker callback did not start');
    await delay(5);
  }
}

test('encrypted worker commands preserve receipts and exact replay after restart',async t => {
  const config = disk(t), first = await start(t,config),{actor} = await initialize(first);
  assert.equal(await first.storeIntegrity(),true);
  assert.deepEqual(await first.runtimeCapabilities(),{bindingFactories:['demo.code'],actionHandlers:true,codeVault:false});
  const request = await input(first,actor);
  const receipt = await first.purchase(actor,request);
  await first.prepareRecordTransactions();
  await first.close();
  assert.equal(first.status().state,'closed');
  assert(!readFileSync(config.filename).includes(Buffer.from('Collector')));
  const second = await start(t,config);
  assert.deepEqual(await second.purchase(actor,request),receipt);
  assert.equal((await second.packs(actor)).length,1);
  assert.equal((await second.wallet(actor)).credits,990);
  assert.equal((await second.audit(admin)).ok,true);
  await assert.rejects(second.purchase(actor,{...request,quantity:2}),code('IDEMPOTENCY_CONFLICT'));
});

test('HTTP heartbeat responds while a real worker purchase is busy',async t => {
  const config = disk(t),marker = join(config.dir,'busy');
  const service = await start(t,{...config,extensionOptions:{delayMs:400,marker}}),{actor} = await initialize(service);
  const server = createServer((req,res) => res.end('healthy'));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  let complete = false;
  const purchase = service.purchase(actor,await input(service,actor)).finally(() => { complete = true; });
  await entered(marker);
  const begun = performance.now();
  assert.equal(await (await fetch('http://127.0.0.1:'+server.address().port)).text(),'healthy');
  assert(performance.now() - begun < 300);
  assert.equal(complete,false);
  await purchase;
});

test('count and aggregate byte admission reject before unadmitted effects',async t => {
  const config = disk(t),service = await start(t,{...config,maxPendingRequests:1,extensionOptions:{delayMs:120}}),{actor} = await initialize(service);
  const request = await input(service,actor),pending = service.purchase(actor,request);
  assert.equal(service.status().saturated,true);
  await assert.rejects(service.purchase(actor,{...request,key:'unadmitted'}),code('WORKER_OVERLOADED'));
  await pending;
  assert.equal(service.status().pendingBytes,0);
  assert.equal((await service.packs(actor)).length,1);
  const bytes = await start(t,{maxPendingBytes:1000,maxPendingRequests:4,extensionOptions:{actions:true}});
  await assert.rejects(bytes.publishCatalog(admin,catalog()),code('WORKER_OVERLOADED'));
  await assert.rejects(bytes.catalog(),code('NO_CATALOG'));
  // A first admitted call consumes bytes even when the count limit still has room.
  const held = bytes.catalog('x'.repeat(650));
  await assert.rejects(bytes.catalog('x'.repeat(650)),code('WORKER_OVERLOADED'));
  await assert.rejects(held,code('NO_CATALOG'));
});

test('worker crash rejects every pending request without replay; committed loss reconciles by original key',async t => {
  const config = disk(t),service = await start(t,{...config,extensionOptions:{crashAfterPurchase:true}}),{actor} = await initialize(service);
  const request = await input(service,actor);
  const results = await Promise.allSettled([service.purchase(actor,request),service.wallet(actor)]);
  for (const result of results) { assert.equal(result.status,'rejected'); assert(code('WORKER_UNAVAILABLE')(result.reason)); }
  assert.equal(service.status().state,'failed');
  assert.equal(service.status().pendingRequests,0);
  const reopened = await start(t,config),receipt = await reopened.purchase(actor,request);
  assert.equal(receipt.packs.length,1);
  assert.equal((await reopened.wallet(actor)).credits,990);
  assert.equal((await reopened.packs(actor)).length,1);
});

test('close drains admitted commands, rejects new commands, and is idempotent',async t => {
  const config = disk(t),service = await start(t,{...config,extensionOptions:{delayMs:100}}),{actor} = await initialize(service);
  const purchase = service.purchase(actor,await input(service,actor));
  const closing = service.close();
  assert.equal(closing,service.close());
  await assert.rejects(service.wallet(actor),code('WORKER_UNAVAILABLE'));
  assert.equal((await purchase).packs.length,1);
  await closing;
  assert.equal(service.status().state,'closed');
  assert.equal(service.status().pendingRequests,0);
});

test('startup and deadline failures are bounded and sanitized',async t => {
  const config = disk(t),first = await start(t,config);
  await initialize(first); await first.close();
  const badKey = new FrameworkWorkerService({...config,storeOptions:{encryptionKey:randomBytes(32)}});
  await assert.rejects(badKey.ready,error => code('WORKER_FAILURE')(error) && !error.message.includes('authentication'));
  assert.equal(badKey.status().state,'failed');
  await badKey.terminate();
  const missing = new FrameworkWorkerService({extensionModule:join(config.dir,'missing.js')});
  await assert.rejects(missing.ready,code('WORKER_FAILURE'));
  await missing.terminate();
  const service = await start(t,{...config,closeTimeoutMs:25,extensionOptions:{delayMs:300}});
  const actor = {userId:(await service.userByIdentity(admin,{provider:'test',subject:'collector'})).id};
  const pending = service.purchase(actor,await input(service,actor));
  const closed = service.close();
  await Promise.all([assert.rejects(pending,code('WORKER_UNAVAILABLE')),assert.rejects(closed,code('WORKER_UNAVAILABLE'))]);
});

test('fixed dispatch rejects prototype methods and unsupported values before effects',async t => {
  const service = await start(t,disk(t)),{actor} = await initialize(service),request = await input(service,actor);
  for (const method of ['constructor','toString','__proto__','close','read','transact']) await assert.rejects(service.invoke(method),code('WORKER_METHOD'));
  for (const value of [() => {},new Date(),new AbortController().signal,new Map(),Symbol('value')]) {
    await assert.rejects(service.purchase(actor,{...request,key:'unsupported',extra:value}),code('WORKER_TRANSPORT'));
  }
  let called = false;
  await assert.rejects(service.purchase(actor,{...request,get extra() { called = true; return 1; }}),code('WORKER_TRANSPORT'));
  assert.equal(called,false);
  assert.equal((await service.packs(actor)).length,0);
  assert.throws(() => new FrameworkWorkerService({frameworkOptions:{bindings:{callback:() => {}}}}),code('WORKER_TRANSPORT'));
  assert.throws(() => new FrameworkWorkerService({frameworkOptions:{unknown:true}}),code('INVALID_INPUT'));
});

test('trusted binding and policy callbacks execute inside the worker and unexpected errors are sanitized',async t => {
  const service = await start(t,{...disk(t),extensionOptions:{blockTrades:true}}),{actor,other} = await initialize(service);
  const purchase = await service.purchase(actor,await input(service,actor,'binding-buy','binding'));
  const opened = await service.openPack(actor,{key:'open',packId:purchase.packs[0].id});
  assert.equal(opened.cards[0].bindings['demo.code'].data.code,'worker-binding');
  await assert.rejects(service.proposeTrade(actor,{key:'offer',toUserId:other.userId,give:{copyIds:[opened.cards[0].id],currencies:[]},receive:{copyIds:[],currencies:[]}}),error => code('TRANSFER_BLOCKED')(error) && error.status === 403);
  const broken = await start(t,{...disk(t),extensionOptions:{throwRandom:true}}),{actor:buyer} = await initialize(broken);
  await assert.rejects(broken.purchase(buyer,await input(broken,buyer)),error => code('WORKER_FAILURE')(error) && !error.message.includes('Private'));
  assert.equal((await broken.packs(buyer)).length,0);
});

test('concurrent last-unit purchases preserve inventory and one debit',async t => {
  const service = await start(t,disk(t)),{actor,other} = await initialize(service);
  const requests = await Promise.all([input(service,actor,'one','last'),input(service,other,'two','last')]);
  const results = await Promise.allSettled([service.purchase(actor,requests[0]),service.purchase(other,requests[1])]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1);
  assert(code('POOL_EXHAUSTED')(results.find(r => r.status === 'rejected').reason));
  assert.equal((await service.wallet(actor)).credits + (await service.wallet(other)).credits,1990);
  assert.equal((await service.audit(admin)).ok,true);
});

test('action cancellation crosses an explicit protocol and settles the claimed job',async t => {
  const config = disk(t),marker = join(config.dir,'action');
  const service = await start(t,{...config,extensionOptions:{actions:true,waitForAbort:true,actionMarker:marker}}),{actor} = await initialize(service);
  await service.purchase(actor,await input(service,actor));
  await assert.rejects(service.dispatchActions(admin,{signal:{aborted:false}}),code('WORKER_TRANSPORT'));
  const controller = new AbortController();
  const dispatch = service.dispatchActions(admin,{limit:1,signal:controller.signal});
  await entered(marker); controller.abort();
  const results = await dispatch;
  assert.equal(results.length,1);
  assert.equal(readFileSync(marker,'utf8'),'aborted');
  assert.equal(results[0].status,'pending');
  const already = new AbortController(); already.abort();
  assert.deepEqual(await service.dispatchActions(admin,{signal:already.signal}),[]);
});

test('close during startup completes after readiness and vault keys retain Buffer identity',async t => {
  const config = disk(t);
  const service = new FrameworkWorkerService({...config,codeVaultOptions:{activeKeyId:'current',keys:{current:randomBytes(32)},indexKey:randomBytes(32)}});
  await service.ready;
  assert.equal((await service.runtimeCapabilities()).codeVault,true);
  await service.close();
  const starting = new FrameworkWorkerService(config);
  const closing = starting.close();
  await starting.ready;
  await closing;
  assert.equal(starting.status().state,'closed');
});

test('worker sessions preserve encrypted legacy rows, consume once, expire, revoke and survive restart',async t => {
  const config = disk(t),sessionOptions = {encryptionKey:config.storeOptions.encryptionKey,maxSessions:4};
  const legacy = new SessionStore(config.filename,sessionOptions),identity = {userId:'collector',issuer:'https://issuer.test',subject:'collector'};
  const secret = legacy.create('session',identity,60000);
  legacy.close();
  const first = await start(t,{...config,sessionOptions});
  assert.deepEqual(await first.sessions.get(secret,'session'),identity);
  const flow = await first.sessions.create('flow',{nonce:'single-use'},60000);
  const results = await Promise.all(Array.from({length:10},() => first.sessions.get(flow,'flow',{consume:true})));
  assert.equal(results.filter(Boolean).length,1);
  const expired = await first.sessions.create('session',identity,1);
  await delay(20);
  assert.equal(await first.sessions.get(expired,'session'),null);
  await first.close();
  assert(!readFileSync(config.filename).includes(Buffer.from(secret)));
  assert(!readFileSync(config.filename).includes(Buffer.from('https://issuer.test')));
  const second = await start(t,{...config,sessionOptions});
  assert.deepEqual(await second.sessions.get(secret,'session'),identity);
  assert.equal(await second.sessions.get(flow,'flow',{consume:true}),null);
  await second.sessions.revoke(secret);
  assert.equal(await second.sessions.get(secret,'session'),null);
  await second.close();
  const restored = new SessionStore(config.filename,sessionOptions);
  assert.equal(restored.get(secret,'session'),null);
  restored.close();
});

test('worker session capacity and admission reject before effects; options and wrong keys fail closed',async t => {
  const config = disk(t),sessionOptions = {encryptionKey:config.storeOptions.encryptionKey,maxSessions:1};
  const first = await start(t,{...config,sessionOptions});
  const attempts = await Promise.allSettled([first.sessions.create('session',{userId:'a'},60000),first.sessions.create('flow',{},60000)]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length,1);
  assert(code('WORKER_FAILURE')(attempts.find(result => result.status === 'rejected').reason));
  const secret = attempts.find(result => result.status === 'fulfilled').value;
  assert.deepEqual(await first.sessions.get(secret,'session'),{userId:'a'});
  await first.close();
  const wrong = await start(t,{...config,sessionOptions:{...sessionOptions,encryptionKey:randomBytes(32)}});
  const auth = createAuthHost({sessions:wrong.sessions,origin:'https://cards.test'});
  await assert.rejects(auth.resolveIdentity({headers:{cookie:'__Host-dc_session='+secret}}),code('WORKER_FAILURE'));
  await wrong.close();
  const bounded = await start(t,{...config,sessionOptions,maxPendingRequests:1,maxPendingBytes:1000});
  const read = bounded.sessions.get(secret,'session');
  await assert.rejects(bounded.sessions.revoke(secret),code('WORKER_OVERLOADED'));
  await read;
  await assert.rejects(bounded.sessions.create('flow',{data:'x'.repeat(2000)},60000),code('WORKER_OVERLOADED'));
  assert.deepEqual(await bounded.sessions.get(secret,'session'),{userId:'a'});
  assert.throws(() => new FrameworkWorkerService({sessionOptions:{maxSessions:0}}),code('INVALID_INPUT'));
  assert.throws(() => new FrameworkWorkerService({sessionOptions:{clock:Date.now}}),code('WORKER_TRANSPORT'));
  assert.throws(() => new FrameworkWorkerService({sessionOptions:{unknown:1}}),code('INVALID_INPUT'));
  let readGetter = false;
  assert.throws(() => new FrameworkWorkerService({sessionOptions:{get maxSessions(){readGetter = true;return 1;}}}),code('WORKER_TRANSPORT'));
  assert.equal(readGetter,false);
  assert.throws(() => new FrameworkWorkerService({storeOptions:{readOnly:true},sessionOptions:{}}),code('INVALID_INPUT'));
  const disabled = await start(t,{});
  assert.equal(disabled.sessions,undefined);
  await assert.rejects(disabled.sessionCreate('flow',{},60000),code('WORKER_METHOD'));
});

test('concurrent worker callbacks finish exactly one login and observe revocation',async t => {
  const config = disk(t),service = await start(t,{...config,sessionOptions:{encryptionKey:config.storeOptions.encryptionKey}});
  await initialize(service);
  let finishes = 0;
  const provider = {async finish(){finishes++;return {issuer:'https://issuer.test',subject:'signed-in',displayName:'Collector'};}};
  const host = createAuthHost({framework:service,sessions:service.sessions,provider,origin:'https://cards.test',adminSubjects:['signed-in']});
  const flow = await service.sessions.create('flow',{nonce:'once'},60000);
  const response = () => ({statusCode:200,headers:new Map(),setHeader(name,value){this.headers.set(name,value);},end(){}});
  const responses = [response(),response()];
  await Promise.all(responses.map(res => host.handle({url:'/auth/callback',method:'GET',headers:{cookie:'__Host-dc_flow='+flow}},res)));
  assert.deepEqual(responses.map(res => res.statusCode).sort(),[303,400]);
  assert.equal(finishes,1);
  const cookie = responses.find(res => res.statusCode === 303).headers.get('Set-Cookie').find(value => value.startsWith('__Host-dc_session=')).split(';')[0];
  const identity = await host.resolveIdentity({headers:{cookie}});
  assert.equal(identity.role,'admin');
  await service.sessions.revoke(cookie.split('=')[1]);
  assert.equal(await host.resolveIdentity({headers:{cookie}}),null);
});

test('HTTP health remains responsive while framework work delays session reads and writes',async t => {
  const config = disk(t),marker = join(config.dir,'session-busy');
  const service = await start(t,{...config,sessionOptions:{encryptionKey:config.storeOptions.encryptionKey},extensionOptions:{delayMs:400,marker}}),{actor} = await initialize(service);
  const secret = await service.sessions.create('session',{userId:actor.userId},60000);
  const server = createServer((req,res) => { const status = service.status();res.statusCode = status.ready && !status.saturated ? 200 : 503;res.end('healthy'); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const purchase = service.purchase(actor,await input(service,actor));
  await entered(marker);
  let readDone = false,writeDone = false;
  const read = service.sessions.get(secret,'session').finally(() => {readDone = true;});
  const write = service.sessions.create('flow',{nonce:'queued'},60000).finally(() => {writeDone = true;});
  const begun = performance.now();
  assert.equal((await fetch('http://127.0.0.1:'+server.address().port)).status,200);
  assert(performance.now() - begun < 300);
  assert.equal(readDone,false);assert.equal(writeDone,false);
  await Promise.all([purchase,read,write]);
});

test('worker close drains admitted session writes and rejects later session operations',async t => {
  const config = disk(t),sessionOptions = {encryptionKey:config.storeOptions.encryptionKey};
  const service = await start(t,{...config,sessionOptions});
  const creating = service.sessions.create('session',{userId:'collector'},60000),closing = service.close();
  await assert.rejects(service.sessions.create('flow',{},60000),code('WORKER_UNAVAILABLE'));
  const secret = await creating;
  await closing;
  assert.equal(service.status().pendingRequests,0);
  await assert.rejects(service.sessions.get(secret,'session'),code('WORKER_UNAVAILABLE'));
  const sessions = new SessionStore(config.filename,sessionOptions);
  assert.deepEqual(sessions.get(secret,'session'),{userId:'collector'});
  sessions.close();
});

test('uncertain session consume and revoke are never replayed after worker failure',async t => {
  for (const operation of ['consume','revoke']) {
    const config = disk(t),sessionOptions = {encryptionKey:config.storeOptions.encryptionKey};
    const service = await start(t,{...config,sessionOptions,extensionOptions:{crashAfterSession:operation}});
    const secret = await service.sessions.create(operation === 'consume' ? 'flow' : 'session',{nonce:'once'},60000);
    await assert.rejects(operation === 'consume' ? service.sessions.get(secret,'flow',{consume:true}) : service.sessions.revoke(secret),code('WORKER_UNAVAILABLE'));
    const restarted = await start(t,{...config,sessionOptions});
    assert.equal(await restarted.sessions.get(secret,operation === 'consume' ? 'flow' : 'session'),null);
  }
});
