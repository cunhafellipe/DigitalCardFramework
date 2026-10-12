import test from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteStore} from '../src/sqlite.js';
import {CardFramework} from '../src/core.js';
import {fixture,admin,code} from './helpers.js';
import {summarizeRecords} from '../src/record-accounting.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createStateCodec} from '../src/encryption.js';
import {encodeRecordPayload} from '../src/indexed-storage.js';

function setup(t,options={}){
  const dir=mkdtempSync(join(tmpdir(),'record-raffles-')),path=join(dir,'state.sqlite'),encryptionKey=randomBytes(32);let store=new SQLiteStore(path,{encryptionKey}),now='2026-09-30T12:00:00.000Z';
  const x=fixture({store,clock:()=>now,raffleRandom:()=>0,...options}),seller={...x.alice,role:'admin'},shop=x.core.createShop(seller,{key:'shop',name:'Shop',kind:'admin'});
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  return {x,path,encryptionKey,get store(){return store;},setNow(value){now=value;},list(key='listing',extra={}){return x.core.createListing(seller,{key,shopId:shop.id,title:'Raffle stock',price:{currencyId:'credits',amount:5},items:{kind:'mint-card',variantId:'dawn.standard',quantity:2},raffle:{entryClosesAt:'2026-09-30T13:00:00.000Z',claimSeconds:60,winners:1},...extra});},restart(options={}){store.close();store=new SQLiteStore(path,{encryptionKey,...options});x.core=new CardFramework({store,clock:()=>now,raffleRandom:()=>0});}};
}
const entry=(z,l,key='entry')=>z.x.core.enterRaffle(z.x.bob,{key,listingId:l.id});
const draw=(z,l,key='draw')=>z.x.core.drawRaffle(admin,{key,listingId:l.id});
function accounting(store){const state=store.read(s=>s),actual=summarizeRecords(state);actual.usedBytes=store.measure(state).usedBytes;assert.deepEqual(JSON.parse(state._recordAccounting),actual);}

test('entries and draws remain selected, replay across restart, and preserve winner claims',t=>{
  const z=setup(t),l=z.list();z.store.prepareRecordTransactions();
  z.store.transact(s=>{for(let i=0;i<1500;i++){s.requests['history-'+i]={hash:'old',result:{}};s.listings['closed-'+i]={...s.listings[l.id],id:'closed-'+i,status:'canceled'};}});
  const before=z.store.diagnostics(),entered=entry(z,l);assert.equal(entry(z,l,'duplicate').entryCount,1);assert.deepEqual(entry(z,l),entered);assert.throws(()=>z.x.core.enterRaffle(z.x.bob,{key:'entry',listingId:'other'}),code('IDEMPOTENCY_CONFLICT'));
  assert.equal(z.store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations);assert(z.store.diagnostics().decodedQueryRecords-before.decodedQueryRecords<90);
  z.setNow('2026-09-30T13:00:00.000Z');const metrics=z.store.diagnostics(),result=draw(z,l);assert.equal(result.winners.length,1);assert.equal(result.winners[0].userId,z.x.bob.userId);assert.deepEqual(draw(z,l,'fresh-draw'),result);assert.equal(z.store.diagnostics().compatibilityMaterializations,metrics.compatibilityMaterializations);assert(z.store.diagnostics().decodedQueryRecords-metrics.decodedQueryRecords<70);accounting(z.store);
  assert.equal(z.x.core.notifications(z.x.bob).items.filter(row=>row.type==='raffle.won').length,1);z.restart();assert.deepEqual(entry(z,l),entered);assert.deepEqual(draw(z,l),result);
  z.x.core.configureCommerce(admin,{key:'pause',expectedRevision:0,settings:{enabled:false}});const quote=z.x.core.quoteListing(z.x.bob,{listingId:l.id}),order=z.x.core.buyListing(z.x.bob,{...quote,key:'claim'});assert.equal(z.store.query(q=>q.get('listings',l.id)).draw.winners[0].orderId,order.id);accounting(z.store);
});
test('permissions, eligibility, closed entries, and premature draws leave state unchanged',t=>{
  const z=setup(t),l=z.list();z.store.prepareRecordTransactions();const before=z.store.read(s=>s);
  assert.throws(()=>z.x.core.drawRaffle(z.x.bob,{key:'denied',listingId:l.id}),code('FORBIDDEN'));assert.throws(()=>draw(z,l),code('RAFFLE_CLOSED'));assert.throws(()=>z.x.core.enterRaffle(z.x.alice,{key:'seller',listingId:l.id}),code('FORBIDDEN'));assert.deepEqual(z.store.read(s=>s),before);
  z.setNow('2026-09-30T13:00:00.000Z');assert.throws(()=>entry(z,l),code('RAFFLE_CLOSED'));assert.deepEqual(z.store.read(s=>s),before);
});
test('host entry policies receive complete selected context once and failures roll back',t=>{
  let calls=0;const z=setup(t,{policies:{canPurchase({shop,listing,user}){calls++;assert.equal(shop.name,'Shop');assert.equal(listing.sellerName,'Alice');assert.equal(user.displayName,'Bob');return false;}}}),l=z.list();z.store.prepareRecordTransactions();const before=z.store.read(s=>s),metrics=z.store.diagnostics();assert.throws(()=>entry(z,l),code('FORBIDDEN'));assert.equal(calls,1);assert.equal(z.store.diagnostics().compatibilityMaterializations,metrics.compatibilityMaterializations);assert.deepEqual(z.store.read(s=>s),before);
});
for(const throwing of [false,true])test('invalid or throwing raffle randomness rolls back without compatibility retry '+throwing,t=>{
  let calls=0;const z=setup(t,{raffleRandom(){calls++;if(throwing)throw Error('Provider failure');return -1;}}),l=z.list();z.store.prepareRecordTransactions();entry(z,l);z.setNow('2026-09-30T13:00:00.000Z');const before=z.store.read(s=>s),metrics=z.store.diagnostics();assert.throws(()=>draw(z,l),throwing?/Provider failure/:code('INVALID_PROVIDER'));assert.equal(calls,1);assert.equal(z.store.diagnostics().compatibilityMaterializations,metrics.compatibilityMaterializations);assert.deepEqual(z.store.read(s=>s),before);
});
test('empty draw, deadline clipping, notification trimming, and outbox are atomic',t=>{
  const z=setup(t,{eventSubscriptions:[{id:'draw',handler:'record',events:['raffle.drawn']}]}),empty=z.list('empty'),l=z.list('limited',{endsAt:'2026-09-30T13:01:01.000Z'});z.store.prepareRecordTransactions();entry(z,l);z.store.transact(s=>{s.notifications??=[];for(let i=0;i<2000;i++)s.notifications.push({id:'old-'+i,userId:z.x.bob.userId,type:'old',data:{},at:'2026-09-30T12:00:00.000Z',read:false});});z.setNow('2026-09-30T13:00:30.000Z');assert.deepEqual(draw(z,empty,'empty-draw').winners,[]);assert.equal(draw(z,l).claimUntil,'2026-09-30T13:01:01.000Z');const state=z.store.read(s=>s);assert.equal(state.notifications.filter(row=>row.userId===z.x.bob.userId).length,2000);assert.equal(Object.values(state.actionJobs).filter(row=>row.source.type==='event').length,2);accounting(z.store);
});
test('entry and draw storage admission failures retain exact state and reservations',t=>{
  const z=setup(t),l=z.list();z.store.prepareRecordTransactions();const before=z.store.read(s=>s),cap=z.store.measure(before).totalBytes;z.restart({maxStateBytes:cap});assert.throws(()=>entry(z,l),code('STORAGE_CAPACITY'));assert.deepEqual(z.store.read(s=>s),before);z.restart();entry(z,l);z.setNow('2026-09-30T13:00:00.000Z');const entered=z.store.read(s=>s);z.restart({maxStateBytes:z.store.measure(entered).totalBytes});assert.throws(()=>draw(z,l),code('STORAGE_CAPACITY'));assert.deepEqual(z.store.read(s=>s),entered);
});
test('raffle status works through a read-only selected query',t=>{
  const z=setup(t),l=z.list();z.store.prepareRecordTransactions();entry(z,l);z.restart({readOnly:true});const before=z.store.diagnostics();assert.equal(z.x.core.raffleStatus(z.x.bob,{listingId:l.id}).entered,true);assert.equal(z.store.diagnostics().recordWrites,before.recordWrites);assert.equal(z.store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations);assert(z.store.diagnostics().decodedQueryRecords-before.decodedQueryRecords<=3);
});
test('automatic due selection observes ordering and exact close/end boundaries without unrelated decoding',t=>{
  const z=setup(t),late=z.list('late',{raffle:{entryClosesAt:'2026-09-30T13:00:00.000Z',claimSeconds:60,winners:1}}),early=z.list('early',{raffle:{entryClosesAt:'2026-09-30T12:30:00.000Z',claimSeconds:60,winners:1}}),ended=z.list('ended',{endsAt:'2026-09-30T13:00:00.000Z',raffle:{entryClosesAt:'2026-09-30T12:58:59.000Z',claimSeconds:60,winners:1}});z.store.prepareRecordTransactions();
  z.store.transact(s=>{for(let i=0;i<1600;i++)s.listings['future-'+i]={...s.listings[late.id],id:'future-'+i,status:'canceled',raffle:{...late.raffle,entryClosesAt:'2027-01-01T00:00:00.000Z'}};});
  z.setNow('2026-09-30T12:29:59.999Z');assert.deepEqual(z.x.core.drawDueRaffles(admin),[]);z.setNow('2026-09-30T13:00:00.000Z');const before=z.store.diagnostics();assert.deepEqual(z.store.selectDueRaffles('2026-09-30T13:00:00.000Z',3),[early.id,late.id]);assert.equal(z.x.core.drawDueRaffles(admin,{limit:3}).length,2);assert.equal(z.store.query(q=>q.get('listings',ended.id)).draw,null);assert.equal(z.store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations);assert(z.store.diagnostics().decodedQueryRecords-before.decodedQueryRecords<80);assert.deepEqual(z.x.core.drawDueRaffles(admin),[]);accounting(z.store);
});
test('a stale due projection falls back until preparation repairs the revision fence',t=>{
  const z=setup(t),l=z.list();z.store.prepareRecordTransactions();const revision=z.store.query(q=>q.value('revision'));entry(z,l);const db=new DatabaseSync(z.path);db.prepare("UPDATE framework_fields SET payload=? WHERE name='_raffleDueRevision'").run(encodeRecordPayload(createStateCodec(z.encryptionKey),'_raffleDueRevision',null,revision));db.close();const before=z.store.diagnostics();assert.deepEqual(z.store.selectDueRaffles('2026-09-30T13:00:00.000Z'),[l.id]);assert.equal(z.store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations+1);assert.deepEqual(z.store.prepareRecordTransactions(),{prepared:true});const repaired=z.store.diagnostics();assert.deepEqual(z.store.selectDueRaffles('2026-09-30T13:00:00.000Z'),[l.id]);assert.equal(z.store.diagnostics().compatibilityMaterializations,repaired.compatibilityMaterializations);accounting(z.store);
});
test('automatic sweeps finish healthy selected items after a provider failure and progress fairly',t=>{
  let calls=0;const z=setup(t,{raffleRandom(){calls++;throw Error('Provider failure');}}),failed=z.list('failed',{raffle:{entryClosesAt:'2026-09-30T12:30:00.000Z',claimSeconds:60,winners:1}}),healthy=z.list('healthy');z.store.prepareRecordTransactions();entry(z,failed);z.setNow('2026-09-30T13:00:00.000Z');assert.throws(()=>z.x.core.drawDueRaffles(admin,{limit:2}),/Provider failure/);assert.equal(calls,1);const committed=z.store.query(q=>q.get('listings',healthy.id)).draw;assert(committed);assert.deepEqual(draw(z,healthy,'automatic-draw:'+healthy.id),committed);assert.equal(calls,1);const next=z.list('next',{startsAt:'2026-09-30T12:00:00.000Z',raffle:{entryClosesAt:'2026-09-30T13:00:00.000Z',claimSeconds:60,winners:1}});for(let attempt=0;attempt<2&&!z.store.query(q=>q.get('listings',next.id)).draw;attempt++){try{assert.equal(z.x.core.drawDueRaffles(admin,{limit:1}).length,1);}catch(error){assert.match(error.message,/Provider failure/);}}assert(z.store.query(q=>q.get('listings',next.id)).draw);assert(calls>=1&&calls<=2);assert.deepEqual(draw(z,healthy,'automatic-draw:'+healthy.id),committed);
});
test('competing processes commit one draw with one winner notification',async t=>{
  const z=setup(t),l=z.list();z.store.prepareRecordTransactions();entry(z,l);z.setNow('2026-09-30T13:00:00.000Z');
  const script="import {SQLiteStore} from './src/sqlite.js';import {CardFramework} from './src/core.js';const s=new SQLiteStore(process.env.RAFFLE_PATH,{encryptionKey:Buffer.from(process.env.RAFFLE_KEY,'hex')});const c=new CardFramework({store:s,clock:()=> '2026-09-30T13:00:00.000Z',raffleRandom:()=>0});console.log(JSON.stringify(c.drawRaffle({role:'admin'},{key:process.env.RAFFLE_COMMAND,listingId:process.env.RAFFLE_ID})));s.close();";
  const run=key=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,RAFFLE_PATH:z.path,RAFFLE_KEY:z.encryptionKey.toString('hex'),RAFFLE_COMMAND:key,RAFFLE_ID:l.id}});let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('exit',status=>status===0?resolve(JSON.parse(stdout)):reject(Error(stderr)));});
  const results=await Promise.all([run('one'),run('two')]);assert.deepEqual(results[0],results[1]);assert.equal(z.store.read(s=>s.notifications.filter(row=>row.type==='raffle.won').length),1);accounting(z.store);
});
test('entry limits admit duplicate entries and reject new entrants atomically',t=>{
  const z=setup(t),l=z.list();z.x.core.configureCommerce(admin,{key:'limit',expectedRevision:0,settings:{maxRaffleEntries:1}});const third=z.x.core.registerUser(admin,{provider:'test',subject:'third',displayName:'Third'});z.store.prepareRecordTransactions();entry(z,l);assert.equal(entry(z,l,'duplicate').entryCount,1);const before=z.store.read(s=>s);assert.throws(()=>z.x.core.enterRaffle({userId:third.id},{key:'third',listingId:l.id}),code('INSTALLATION_CAPACITY'));assert.deepEqual(z.store.read(s=>s),before);
});
test('a write budget failure after randomness never reruns the provider',t=>{
  let calls=0;const z=setup(t,{raffleRandom(){calls++;return 0;}}),l=z.list();z.store.prepareRecordTransactions();entry(z,l);z.setNow('2026-09-30T13:00:00.000Z');const records=z.store.transactRecords.bind(z.store);z.store.transactRecords=(fn,options)=>records(tx=>{fn(tx);throw Object.assign(Error('Write budget exhausted'),{code:'TRANSACTION_BUDGET'});},options);const before=z.store.read(s=>s),metrics=z.store.diagnostics();assert.throws(()=>draw(z,l),code('TRANSACTION_BUDGET'));assert.equal(calls,1);assert.equal(z.store.diagnostics().compatibilityMaterializations,metrics.compatibilityMaterializations);assert.deepEqual(z.store.read(s=>s),before);
});
test('oversized configured raffles retain compatibility support before randomness',t=>{
  let calls=0;const z=setup(t,{raffleRandom(){calls++;return 0;}}),l=z.list();z.x.core.configureCommerce(admin,{key:'limit',expectedRevision:0,settings:{maxRaffleEntries:100000}});z.store.prepareRecordTransactions();z.store.transact(s=>{const entries=s.listings[l.id].entries;for(let i=0;i<15000;i++){const id='entrant-'+String(i).padStart(5,'0')+'x'.repeat(100);entries[id]={userId:id,at:'2026-09-30T12:00:00.000Z'};}});z.setNow('2026-09-30T13:00:00.000Z');const metrics=z.store.diagnostics(),result=draw(z,l);assert.equal(result.winners.length,1);assert.equal(calls,1);assert.equal(z.store.diagnostics().compatibilityMaterializations,metrics.compatibilityMaterializations+1);assert.deepEqual(draw(z,l),result);assert.equal(calls,1);accounting(z.store);
});
test('expired candidate windows advance without hiding later healthy due raffles',t=>{
  const z=setup(t),ended=z.list('ended',{endsAt:'2026-09-30T13:00:00.000Z',raffle:{entryClosesAt:'2026-09-30T12:30:00.000Z',claimSeconds:60,winners:1}}),healthy=z.list('healthy');z.store.prepareRecordTransactions();assert.deepEqual(z.store.selectDueRaffles('2026-09-30T13:00:00.000Z',1),[]);assert.deepEqual(z.store.selectDueRaffles('2026-09-30T13:00:00.000Z',1),[healthy.id]);assert.deepEqual(z.store.selectDueRaffles('2026-09-30T13:00:00.000Z',1),[]);assert.equal(z.store.query(q=>q.get('listings',ended.id)).draw,null);
});
