import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {SQLiteStore} from '../src/sqlite.js';
import {ActionService,enqueueAction} from '../src/actions.js';
import {completionPool,deliveryBytes} from '../src/completion.js';
import {createStateCodec} from '../src/encryption.js';
import {summarizeRecords} from '../src/record-accounting.js';
const admin={role:'admin'},at='2026-10-01T00:00:00.000Z';
function setup(t){
  const dir=mkdtempSync(join(tmpdir(),'record-actions-')),path=join(dir,'state.sqlite'),encryptionKey=randomBytes(32);
  let store=new SQLiteStore(path,{encryptionKey}),now=Date.parse(at);
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  return {path,encryptionKey,get store(){return store;},advance(ms){now+=ms;},clock:()=>new Date(now).toISOString(),
    restart(options={},alreadyClosed=false){if(!alreadyClosed)store.close();store=new SQLiteStore(path,{encryptionKey,...options});return store;},
    add(count=1){return store.transact(s=>Array.from({length:count},()=>enqueueAction(s,{handler:'deliver',source:{type:'test'},params:{}},at).id));},
    service(options={},handlers={}){return new ActionService({store,clock:()=>new Date(now).toISOString(),options,handlers});}};
}
function accounting(store){store.read(s=>{const actual=summarizeRecords(s),cached=JSON.parse(s._recordAccounting);assert.deepEqual(cached.completion,actual.completion);assert.deepEqual(cached.workers,actual.workers);});}
test('empty indexed cycles write and materialize nothing; unrelated lifetime records do not add decoded work',async t=>{
  const x=setup(t);x.store.prepareRecordTransactions();const before=x.store.diagnostics();assert.deepEqual(await x.service().dispatch(admin),[]);assert.deepEqual(x.store.diagnostics(),before);
  const exercise=()=>{x.add();const start=x.store.diagnostics(),service=x.service(),job=service.claim(admin);service.settle(admin,{jobId:job.id,leaseToken:job.leaseToken,succeeded:true});const end=x.store.diagnostics();assert.equal(end.compatibilityMaterializations,start.compatibilityMaterializations);return end.decodedQueryRecords-start.decodedQueryRecords;};
  const small=exercise();x.store.transact(s=>{s.events.push(...Array.from({length:3000},(_,i)=>({id:'event-'+i,sequence:s.events.length+i+1,type:'unrelated',data:{text:'x'.repeat(1024)},at})));});assert.equal(exercise(),small);accounting(x.store);
});
test('indexed ordering is stable; exhausted fixed windows drain without starving later jobs',t=>{
  const x=setup(t),ids=x.add(34);x.store.transact(s=>{for(const id of ids.slice(0,33))s.actionJobs[id].attempts=1;});x.store.prepareRecordTransactions();
  const service=x.service({maxAttempts:1});assert.equal(service.claim(admin),null);assert.equal(x.store.query(q=>q.get('actionJobs',ids[32])).status,'pending');assert.equal(service.claim(admin).id,ids[33]);accounting(x.store);
});
test('competing processes claim a single job once under the database lock',async t=>{
  const x=setup(t),[id]=x.add();x.store.prepareRecordTransactions();
  const source=`import {SQLiteStore} from './src/sqlite.js';import {ActionService} from './src/actions.js';const store=new SQLiteStore(process.argv[1],{encryptionKey:Buffer.from(process.argv[2],'hex')});try{const service=new ActionService({store,clock:()=>${JSON.stringify(at)}});console.log(JSON.stringify(service.claim({role:'admin'})?.id??null));}finally{store.close();}`;
  const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',source,x.path,x.encryptionKey.toString('hex')],{cwd:new URL('..',import.meta.url),windowsHide:true});let output='',error='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>error+=data);child.on('error',reject);child.on('close',status=>status===0?resolve(JSON.parse(output.trim())):reject(new Error(error)));});
  assert.deepEqual((await Promise.all([run(),run()])).filter(Boolean),[id]);accounting(x.store);
});
test('expired lease and restart retain delivery identity and reject stale completion',t=>{
  const x=setup(t),[id]=x.add();x.store.prepareRecordTransactions();const first=x.service().claim(admin);assert.equal(x.service().claim(admin),null);x.advance(60001);x.restart();const service=x.service(),next=service.claim(admin);assert.equal(next.id,id);assert.notEqual(next.leaseToken,first.leaseToken);
  const before=x.store.diagnostics();assert.throws(()=>service.settle(admin,{jobId:id,leaseToken:first.leaseToken,succeeded:true}),{code:'ACTION_LEASE'});assert.equal(x.store.diagnostics().recordWrites,before.recordWrites);assert.equal(service.settle(admin,{jobId:id,leaseToken:next.leaseToken,succeeded:true}).status,'succeeded');accounting(x.store);
});
test('stale due selection is an atomic no-op and malformed prepared accounting fails closed',t=>{
  const x=setup(t),[id]=x.add();x.store.prepareRecordTransactions();const service=x.service(),job=service.claim(admin),select=x.store.selectDueActions.bind(x.store);x.store.selectDueActions=()=>[id];
  const before=x.store.diagnostics();assert.equal(service.claim(admin),null);assert.equal(x.store.diagnostics().recordWrites,before.recordWrites);assert.equal(x.store.diagnostics().compatibilityMaterializations,before.compatibilityMaterializations);x.store.selectDueActions=select;
  const transact=x.store.transactRecords.bind(x.store);x.store.transactRecords=(fn,options)=>transact(tx=>fn({...tx,value(name){return name==='_recordAccounting'?JSON.stringify({version:3,revision:0}):tx.value(name);}}),options);
  assert.throws(()=>service.settle(admin,{jobId:id,leaseToken:job.leaseToken,succeeded:true}),{code:'INVALID_STATE'});assert.equal(x.store.diagnostics().recordWrites,before.recordWrites);x.store.transactRecords=transact;
});
for(const mode of ['deadline','revocation'])test('late callback cannot rewrite committed '+mode+' outcome',async t=>{
  const x=setup(t),[id]=x.add();x.store.prepareRecordTransactions();let resolve,started;const entered=new Promise(done=>started=done),abort=new AbortController();
  const service=x.service({timeoutMs:mode==='deadline'?5:1000},{deliver({idempotencyKey}){assert.equal(idempotencyKey,id);x.store.query(q=>q.get('actionJobs',id));started();return new Promise(done=>resolve=done);}}),start=x.store.diagnostics();
  const running=service.dispatch(admin,{limit:1,signal:abort.signal});await entered;if(mode==='revocation')abort.abort();assert.equal((await running)[0].status,'pending');const before=x.store.query(q=>q.get('actionJobs',id));resolve();await new Promise(done=>setImmediate(done));assert.deepEqual(x.store.query(q=>q.get('actionJobs',id)),before);assert.equal(x.store.diagnostics().compatibilityMaterializations,start.compatibilityMaterializations);accounting(x.store);
});
test('completed parent releases its unused allowance only after the last active sibling',t=>{
  const x=setup(t),ids=x.add(2);x.store.transact(s=>{for(const id of ids){delete s.completionObligations[s.actionJobs[id].deliveryCompletionId];delete s.actionJobs[id].deliveryCompletionId;s.actionJobs[id].completionId='pack:parent';}s.completionObligations['pack:parent']={id:'pack:parent',kind:'pack',entityId:'parent',status:'completed',events:0,jobs:2,bytes:2*deliveryBytes,usedBytes:0,subscriptions:[]};});x.store.prepareRecordTransactions();const service=x.service();
  for(const [index,id]of ids.entries()){const job=service.claim(admin);assert.equal(job.id,id);service.settle(admin,{jobId:id,leaseToken:job.leaseToken,succeeded:true});accounting(x.store);assert.equal(x.store.read(s=>completionPool(s).reservedBytes)>0,index===0);}
});
test('shared parent allowance remains until every sibling completes, including intent acknowledgement',t=>{
  const x=setup(t),ids=x.add(2);x.store.transact(s=>{for(const id of ids){delete s.completionObligations[s.actionJobs[id].deliveryCompletionId];delete s.actionJobs[id].deliveryCompletionId;s.actionJobs[id].completionId='intent:parent';}s.completionObligations['intent:parent']={id:'intent:parent',kind:'intent',entityId:'parent',status:'completed',events:0,jobs:2,bytes:2*deliveryBytes,usedBytes:0,subscriptions:[]};s.commandIntents={parent:{state:'committed'}};});x.store.prepareRecordTransactions();
  const service=x.service();for(const id of ids){const job=service.claim(admin);assert.equal(job.id,id);service.settle(admin,{jobId:id,leaseToken:job.leaseToken,succeeded:true});accounting(x.store);assert(x.store.read(s=>completionPool(s).reservedBytes)>0);}
  x.store.transact(s=>{s.commandIntents.parent.state='acknowledged';});accounting(x.store);assert.equal(x.store.read(s=>completionPool(s).reservedBytes),0);
});
test('admitted delivery completes at ordinary capacity; retry is fresh admission and replays after restart',t=>{
  const x=setup(t),[id]=x.add();x.store.prepareRecordTransactions();const cap=x.store.read(s=>x.store.measure(s).totalBytes);x.restart({maxStateBytes:cap});let service=x.service({maxAttempts:1}),job=service.claim(admin);assert.equal(service.settle(admin,{jobId:id,leaseToken:job.leaseToken,succeeded:false}).status,'dead');accounting(x.store);
  const before=x.store.read(s=>s);assert.throws(()=>service.retry(admin,{jobId:id,key:'retry'}),{code:'STORAGE_CAPACITY'});assert.deepEqual(x.store.read(s=>s),before);
  x.restart();service=x.service({maxAttempts:1});const retried=service.retry(admin,{jobId:id,key:'retry'});x.restart();service=x.service({maxAttempts:1});const start=x.store.diagnostics();assert.deepEqual(service.retry(admin,{jobId:id,key:'retry'}),retried);assert.equal(x.store.diagnostics().recordWrites,start.recordWrites);assert.throws(()=>service.retry(admin,{jobId:'other',key:'retry'}),{code:'IDEMPOTENCY_CONFLICT'});job=service.claim(admin);assert.equal(job.id,id);assert.equal(job.totalAttempts,2);service.settle(admin,{jobId:id,leaseToken:job.leaseToken,succeeded:true});accounting(x.store);
});
test('schema four upgrades pending and expired-running jobs atomically and preserves prepared accounting',t=>{
  const x=setup(t),ids=x.add(2);x.store.transact(s=>{Object.assign(s.actionJobs[ids[1]],{status:'running',attempts:1,totalAttempts:1,leaseToken:'old',leaseUntil:at});});x.store.prepareRecordTransactions();
  const cached=x.store.query(q=>q.value('_recordAccounting'));x.store.close();const db=new DatabaseSync(x.path);db.exec('DROP TABLE framework_expiration_work; DROP TABLE framework_action_work; PRAGMA user_version=4');db.prepare('UPDATE framework_meta SET schema_version=4,codec_check=? WHERE id=1').run(createStateCodec(x.encryptionKey).encode({format:'digital-card.indexed-state',version:4,recordKeys:'blind-v1'}));db.close();
  assert.throws(()=>new SQLiteStore(x.path,{encryptionKey:x.encryptionKey,onMigration({stage}){if(stage==='before-commit')throw new Error('Interrupted migration');}}),/Interrupted migration/);
  const probe=new DatabaseSync(x.path,{readOnly:true});assert.equal(probe.prepare('PRAGMA user_version').get().user_version,4);assert.equal(probe.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='framework_action_work'").get().n,0);probe.close();
  x.restart({},true);assert.equal(x.store.diagnostics().storageSchema,6);assert.equal(x.store.query(q=>q.value('_recordAccounting')),cached);const service=x.service();assert.equal(service.claim(admin).id,ids[0]);assert.equal(service.claim(admin).id,ids[1]);accounting(x.store);
});
