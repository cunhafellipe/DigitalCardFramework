import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer,request as httpRequest} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {createRemoteCodeIssuer,codeIssuanceProtocol,validateCodeIssuanceResponse} from '../src/remote-code-issuer.js';
import {matchCodeIssuanceResults} from '../src/code-issuance-contracts.js';

const token='synthetic-code-issuer-credential',providerId='example.issuer';
const example=fileURLToPath(new URL('../examples/plugins/node-code-issuer.mjs',import.meta.url));
const processes=new WeakMap();
const entry=(attachmentIndex=0)=>({issuanceId:randomUUID(),inputDigest:'b'.repeat(64),attemptId:randomUUID(),codeId:randomUUID(),copyId:randomUUID(),userId:'collector',poolId:'rewards',variantId:'reward.standard',packIndex:0,slotId:'reward',slotOrdinal:0,attachmentId:'game',attachmentIndex});
const request=(remote,batchId,entries,operation='issue')=>({protocol:codeIssuanceProtocol,operation,requestId:randomUUID(),providerId,...remote.grant(),batchId,inputDigest:'a'.repeat(64),deadline:Date.now()+10000,context:{entries}});
async function temporary(t){const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'node-code-issuer-'));processes.set(t,new Set());t.after(async()=>{for(const child of processes.get(t))await stop(child);assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});});return join(directory,'issuer.sqlite');}
async function start(t,database,environment={}){
  const child=spawn(process.execPath,[example,database],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CODE_ISSUER_TOKEN:token,CODE_ISSUER_PROVIDER_ID:providerId,CODE_ISSUER_PENDING_EVERY:'0',CODE_ISSUER_DELAY_MS:'0',...environment}});child.stderr.resume();
  processes.get(t).add(child);
  t.after(()=>stop(child));
  const port=await new Promise((fulfill,reject)=>{let output='',settled=false;const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value);};const timer=setTimeout(()=>finish(reject,Error('Issuer startup timed out')),10000);child.once('error',error=>finish(reject,error));child.once('exit',()=>finish(reject,Error('Issuer exited before readiness')));child.stdout.on('data',data=>{output+=data;if(output.includes('\n')){const port=Number(output.trim());if(Number.isInteger(port)&&port>0&&port<=65535)finish(fulfill,port);else finish(reject,Error('Invalid issuer readiness'));}});});
  return {child,url:`http://127.0.0.1:${port}/code-issuance`};
}
async function stop(child){if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}}
function remote(t,issuer){const value=createRemoteCodeIssuer({providerId,url:issuer.url,token,allowLoopbackHttp:true});t.after(()=>value.close());return value;}
function rows(database){const db=new DatabaseSync(database,{readOnly:true});try{return db.prepare('SELECT * FROM issuer_entries ORDER BY issuance_id').all();}finally{db.close();}}
async function post(issuer,value,status=200,options={}){
  const body=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value));
  const response=await new Promise((fulfill,reject)=>{
    const req=httpRequest(options.url??issuer.url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token,'content-length':String(body.length),...options.headers},signal:AbortSignal.timeout(10000)},res=>{const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>1048576){res.destroy(Error('Response limit'));return;}chunks.push(chunk);});res.on('error',reject);res.on('end',()=>fulfill({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks),complete:res.complete}));});req.on('error',reject);
    // The declared-size bound must reject before any oversized body is uploaded.
    req.end(body.length>1048576?undefined:body);
  });
  assert.equal(response.status,status);assert(response.complete);assert.equal(response.headers['cache-control'],'no-store');const result=JSON.parse(response.body);if(status===200||status===503)validateCodeIssuanceResponse(result);else assert.deepEqual(result,{});return result;
}
test('actual issuer transport deduplicates occurrence identities across requests and concurrent processes',async t=>{
  const database=await temporary(t),first=await start(t,database),second=await start(t,database),one=remote(t,first),two=remote(t,second),batch=randomUUID(),item=entry();
  const initial=request(one,batch,[item]),snapshot=structuredClone(initial),[a,b]=await Promise.all([one.evaluate(initial),two.evaluate(request(two,batch,[item]))]);
  assert.deepEqual(a.results,b.results);assert.equal(a.results[0].state,'issued');assert.deepEqual(initial,snapshot);
  const replay=await one.evaluate(request(one,batch,[item]));assert.deepEqual(replay.results,a.results);assert.deepEqual((await two.evaluate(request(two,batch,[item],'lookup'))).results,a.results);
  const conflict=await one.evaluate(request(one,batch,[{...item,userId:'other'}]));assert.equal(conflict.results[0].state,'error');assert.equal(conflict.results[0].errorCode,'conflict');assert(!JSON.stringify(conflict).includes(a.results[0].result.code));
  const changedDigest=await one.evaluate(request(one,batch,[{...item,inputDigest:'c'.repeat(64)}]));assert.equal(changedDigest.results[0].errorCode,'conflict');
  const changedBatch=await one.evaluate(request(one,randomUUID(),[item]));assert.equal(changedBatch.results[0].errorCode,'conflict');
  assert.equal(rows(database).length,1);assert.equal(rows(database)[0].effect_count,1);
});
test('partial pending results survive restart and terminal cancellation prevents every later issue',async t=>{
  const database=await temporary(t),first=await start(t,database,{CODE_ISSUER_PENDING_EVERY:'2'}),one=remote(t,first),batch=randomUUID(),items=[entry(),entry(1)],firstResult=await one.evaluate(request(one,batch,items));
  assert.deepEqual(firstResult.results.map(result=>result.state),['issued','pending']);assert.deepEqual((await one.evaluate(request(one,batch,items,'lookup'))).results,firstResult.results);await stop(first.child);
  const restarted=await start(t,database),two=remote(t,restarted),resumed=await two.evaluate(request(two,batch,items));assert.deepEqual(resumed.results.map(result=>result.state),['issued','issued']);assert.deepEqual(resumed.results[0],firstResult.results[0]);assert(rows(database).every(row=>row.effect_count===1));
  const cancelled=await two.evaluate(request(two,batch,items,'cancel'));assert(cancelled.results.every(result=>result.state==='cancelled'&&!Object.hasOwn(result,'result')));
  assert.deepEqual((await two.evaluate(request(two,batch,items))).results,cancelled.results);assert.deepEqual((await two.evaluate(request(two,batch,items,'lookup'))).results,cancelled.results);
  const absent=entry(2);assert.equal((await two.evaluate(request(two,batch,[absent],'lookup'))).results[0].state,'not-issued');assert.equal(rows(database).length,2);
  assert.equal((await two.evaluate(request(two,batch,[absent],'cancel'))).results[0].state,'cancelled');assert.equal((await two.evaluate(request(two,batch,[absent]))).results[0].state,'cancelled');assert.equal(rows(database).find(row=>row.issuance_id===absent.issuanceId).effect_count,0);
  await stop(restarted.child);const last=remote(t,await start(t,database));assert((await last.evaluate(request(last,batch,items))).results.every(result=>result.state==='cancelled'));
});
test('issued response loss is recovered by original identity after durable issuer restart',async t=>{
  const database=await temporary(t),issuer=await start(t,database),batch=randomUUID(),item=entry();
  const proxy=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const upstream=await fetch(issuer.url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:Buffer.concat(chunks)});assert.equal(upstream.status,200);await upstream.arrayBuffer();res.destroy();}catch{res.destroy();}});
  await new Promise(done=>proxy.listen(0,'127.0.0.1',done));t.after(async()=>{proxy.closeAllConnections();await new Promise(done=>proxy.close(done));});
  const losing=remote(t,{url:`http://127.0.0.1:${proxy.address().port}/code-issuance`});await assert.rejects(losing.evaluate(request(losing,batch,[item])),error=>error.code==='POLICY_UNAVAILABLE'&&!error.message.includes('SYNTHETIC-CODE'));
  assert.equal(rows(database)[0].effect_count,1);await stop(issuer.child);const recovered=remote(t,await start(t,database)),lookup=await recovered.evaluate(request(recovered,batch,[item],'lookup'));assert.equal(lookup.results[0].state,'issued');
  assert.deepEqual((await recovered.evaluate(request(recovered,batch,[item]))).results,lookup.results);assert.equal(rows(database)[0].effect_count,1);
});
test('terminal cancel fences an already-running issue and remains valid at full row capacity',async t=>{
  const database=await temporary(t),issuer=await start(t,database,{CODE_ISSUER_DELAY_MS:'250',CODE_ISSUER_MAX_ROWS:'1'}),value=remote(t,issuer),batch=randomUUID(),item=entry(),pending=value.evaluate(request(value,batch,[item]));
  const until=Date.now()+3000;while(rows(database).length===0){assert(Date.now()<until);await delay(5);}assert.equal(rows(database)[0].state,'pending');
  const cancelled=await value.evaluate(request(value,batch,[item],'cancel'));assert.equal(cancelled.results[0].state,'cancelled');assert.equal((await pending).results[0].state,'cancelled');assert.equal(rows(database)[0].effect_count,0);
  assert.equal((await value.evaluate(request(value,batch,[item]))).results[0].state,'cancelled');assert.equal((await value.evaluate(request(value,batch,[entry(1)]))).results[0].errorCode,'unavailable');assert.equal(rows(database).length,1);
});
test('issuer rejects malformed batches and authority without disclosing issued material',async t=>{
  const database=await temporary(t),issuer=await start(t,database),value=remote(t,issuer),batch=randomUUID(),item=entry(),valid=request(value,batch,[item]);
  const expired={...valid,deadline:1},refused=await post(issuer,expired,503);assert.deepEqual(refused,{...Object.fromEntries(Object.entries(expired).filter(([key])=>key!=='context')),status:'error',errorCode:'unavailable'});assert.equal(rows(database).length,0);
  const issued=await value.evaluate(valid),secret=issued.results[0].result.code;
  for(const patch of [{providerId:'other.issuer'},{operation:'pay'},{protocol:'digital-card-code-issuance@2'},{generation:0},{generation:true},{requestId:'invalid'},{requestId:valid.requestId+'\n'},{inputDigest:'a'.repeat(64)+'\n'},{material:'synthetic-private-material'},{context:{entries:[]}}]){const result=await post(issuer,{...valid,...patch},400);assert(!JSON.stringify(result).includes(secret));}
  for(const entries of [[item,item],[{...item,material:'synthetic-private-material'}],Array(129).fill(item)])await post(issuer,{...valid,context:{entries}},400);
  for(const body of ['{','null','[]','{"context":{},"context":{}}',Buffer.from([0xff]),JSON.stringify(valid).replace('"generation":1','"generation":9007199254740991.1'),'x'.repeat(1048577)])await post(issuer,body,400);
  await post(issuer,valid,401,{headers:{authorization:'Bearer revoked-fixture-credential'}});await post(issuer,valid,400,{url:issuer.url+'?unexpected=1'});
  const mismatch={...issued,results:[{...issued.results[0],copyId:randomUUID()}]};assert.throws(()=>matchCodeIssuanceResults(valid,mismatch));
  assert.equal(rows(database).length,1);assert.equal(rows(database)[0].effect_count,1);
});
