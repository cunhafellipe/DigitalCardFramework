import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {CardFramework} from '../src/core.js';
import {SQLiteStore} from '../src/sqlite.js';
import {createRemoteActionHandler} from '../src/remote-actions.js';
import {validateActionAcknowledgment,validateFrameworkEvent} from '../src/action-contracts.js';
import {fixture,admin} from './helpers.js';

const root=await mkdtemp(join(tmpdir(),'dc-node-receipts-')),journal=join(root,'receiver.sqlite'),processes=new Set(),checks=[];
const executable=fileURLToPath(new URL('./fixtures/node-action-receiver.mjs',import.meta.url)),token='synthetic-node-receipt-credential';
async function start(path=journal,extra={}){
  const child=spawn(process.execPath,[executable,path],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PLUGIN_TOKEN:token,...extra}});processes.add(child);let errors='';child.stderr.on('data',part=>{errors+=part;assert(errors.length<65536);});
  const port=await new Promise((resolve,reject)=>{let output='',settled=false;const timer=setTimeout(()=>finish(reject,Error('Node receiver readiness timed out')),10000);const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);fn(value);};child.once('error',error=>finish(reject,error));child.once('exit',()=>finish(reject,Error('Node receiver exited: '+errors)));child.stdout.on('data',part=>{output+=part;assert(output.length<1024);if(output.includes('\n')){const port=Number(output.trim());if(Number.isInteger(port)&&port>0&&port<65536)finish(resolve,port);else finish(reject,Error('Invalid receiver readiness'));}});});return {child,url:'http://127.0.0.1:'+port+'/actions'};
}
async function stop(child){if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}processes.delete(child);}
function receipts(path=journal){const db=new DatabaseSync(path,{readOnly:true});try{assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');return db.prepare('SELECT job_id,digest,payload FROM deliveries ORDER BY job_id').all();}finally{db.close();}}
async function post(service,value,status=200,headers={}){const body=typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value),key=typeof value==='object'&&!Buffer.isBuffer(value)?value.jobId:'golden-delivery';const response=await fetch(service.url,{method:'POST',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json',authorization:'Bearer '+token,'idempotency-key':key,...headers},body});assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');const result=await response.json();if(status===200){validateActionAcknowledgment(result);assert.equal(result.jobId,headers['idempotency-key']??key);}else assert.deepEqual(result,{});return result;}
async function events(){
  let service=await start(),core,store,lose=true,now=Date.parse('2026-10-01T00:00:00Z');const path=join(root,'framework.sqlite'),attempts=[],clock=()=>new Date(now).toISOString();
  const subscriptions=[{id:'opened-only',handler:'example.record',events:['card.opened']}],handler=job=>createRemoteActionHandler({url:service.url,pluginId:'example.receiver',handlerId:'example.record',token,fetchImpl:async(...args)=>{const delivery=JSON.parse(args[1].body);validateFrameworkEvent(delivery.params.event);attempts.push(delivery);const response=await fetch(...args);if(lose){lose=false;assert.equal(response.status,200);await response.arrayBuffer();throw Error('Committed acknowledgment lost');}return response;}})(job);
  const options={clock,eventSubscriptions:subscriptions,actionOptions:{retryMs:1000},actionHandlers:{'example.record':handler}};
  try{
    store=new SQLiteStore(path);const x=fixture({store,...options});core=x.core;const copy=x.open()[0],job=core.actionJobs(admin).items[0];assert.equal(core.actionJobs(admin).total,1);assert(core.events(admin,{limit:1000}).some(event=>event.type!=='card.opened'));assert.equal((await core.dispatchActions(admin,{limit:1}))[0].status,'pending');assert.equal(core.fulfillments(x.bob).total,0);core.close();core=null;await stop(service.child);
    const saved=receipts();assert.equal(saved.length,1);const original=JSON.parse(saved[0].payload);assert.equal(original.source.eventId,original.params.event.id);assert.equal(original.params.event.data.copyId,copy.id);assert.equal(original.beneficiaryId,x.alice.userId);assert.equal(original.jobId,job.id);
    service=await start();now+=2000;store=new SQLiteStore(path);core=new CardFramework({store,...options});assert.equal((await core.dispatchActions(admin,{limit:1}))[0].status,'succeeded');assert.deepEqual(attempts[1],attempts[0]);assert.equal(core.inventory(x.alice).length,1);assert.equal(core.inventory(x.bob).length,0);assert.equal(core.audit(admin).ok,true);await stop(service.child);assert.deepEqual(receipts(),saved);
    service=await start();const golden=JSON.parse(await readFile(new URL('./fixtures/action-delivery.json',import.meta.url)));await post(service,golden);await post(service,JSON.stringify(golden).replace('1.25','1.250'));await post(service,{...golden,params:{...golden.params,label:'changed'}},409);
    for(const patch of [{protocol:'wrong'},{pluginId:'wrong'},{handlerId:'wrong'},{actor:{role:'admin'}},{source:null},{params:[]}])await post(service,{...golden,...patch},400);
    await post(service,golden,403,{authorization:'Bearer revoked-fixture-credential'});await post(service,golden,400,{'idempotency-key':'forged-job'});await post(service,'{"protocol":1,"protocol":2}',400);await post(service,Buffer.from([0xff,0xfe]),400);await post(service,JSON.stringify(golden).replace('1.25','1e4000'),400);await post(service,JSON.stringify(golden).replace('1.25','"\\ud800"'),400);
    const boundary={...golden,jobId:'b'.repeat(128)},unicode={...golden,jobId:'unicode-beneficiary',beneficiaryId:'外部:account/自由 𝄞'},reserved={...golden,jobId:'__proto__'};await post(service,{...golden,jobId:'b'.repeat(129)},400);await post(service,{...golden,jobId:'𝄞'.repeat(65)},400,{'idempotency-key':'golden-delivery'});for(const item of [boundary,unicode,reserved])await post(service,item);
    const precision=JSON.stringify({...golden,jobId:'exact-number',params:{number:9007199254740992}});await post(service,precision,200,{'idempotency-key':'exact-number'});await post(service,precision.replace('9007199254740992','9007199254740993'),409,{'idempotency-key':'exact-number'});
    await stop(service.child);const final=receipts();assert.equal(final.length,6);service=await start(journal,{PLUGIN_MAX_RECEIPTS:'1'});for(const item of [golden,boundary,unicode,reserved])await post(service,item);await post(service,{...golden,jobId:'capacity-refused'},507);await stop(service.child);assert.deepEqual(receipts(),final);
    checks.push('Node actual filtered subscription, original event/job/beneficiary, consumed acknowledgment loss and framework/receiver restart; exact replay, one durable receipt, scoped inventory and clean audit');checks.push('Canonical action boundaries, Unicode/exact numeric terms, malformed and conflicting requests, strict acknowledgment and reduced-capacity original replay');
  }finally{core?.close();await stop(service.child);}
}
async function byteCapacity(){
  const path=join(root,'byte-capacity.sqlite'),known={protocol:'digital-card-action@1',pluginId:'example.receiver',handlerId:'example.record',jobId:'byte-known',beneficiaryId:null,source:{type:'fixture'},params:{blob:'x'.repeat(20000)}};let service=await start(path,{RECEIPT_MAX_BYTES:'32768'});
  try{await post(service,known);await stop(service.child);const saved=receipts(path);service=await start(path,{RECEIPT_MAX_BYTES:'32768'});await post(service,{...known,jobId:'byte-refused'},507);await post(service,known);await post(service,{...known,jobId:'byte-refused'},507);await stop(service.child);assert.deepEqual(receipts(path),saved);checks.push('Deterministic configured receipt-byte refusal507 preserves original replay200 and unchanged durable rows without poisoning');}finally{await stop(service.child);}
}
try{await events();await byteCapacity();console.log(JSON.stringify({language:'JavaScript',checks,status:'passed'},null,2));}finally{for(const child of processes)await stop(child);if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe receiver cleanup target');await rm(root,{recursive:true,force:true});}
