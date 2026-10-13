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
import {createRemoteBindingFactory,bindingFactoryProtocol,validateBindingFactoryResponse,bindingFactoryInputDigest} from '../src/remote-binding-factory.js';
import {bindingFactoryIdentity,matchBindingFactoryResults} from '../src/binding-factory-contracts.js';
import {contentDigest} from '../src/importer.js';

const token='synthetic-binding-factory-credential',providerId='example.binding';
const example=fileURLToPath(new URL('../examples/plugins/node-binding-factory.mjs',import.meta.url));
const processes=new WeakMap();
function entry(kind='provision',slotOrdinal=0){
  const copyId=randomUUID(),userId='collector',item={invocationId:randomUUID(),attemptId:randomUUID(),copyId,userId,namespace:'example.reward',factoryName:'example.reward',factoryRevision:1,kind,packIndex:0,slotId:'reward',slotOrdinal,input:{copy:{id:copyId,ownerId:userId,cardId:'reward',variantId:'reward.standard',lineId:'example',rarityId:'common',state:'sealed',serialNumber:null,editionTotal:null,createdAt:'2026-10-12T00:00:00.000Z',openedAt:null,openedBy:null,acquiredAt:'2026-10-12T00:00:00.000Z',source:{packIndex:0,slotId:'reward',slotOrdinal},version:1,definition:{title:'Synthetic reward'},variant:{id:'reward.standard'},bindings:{},metadata:{}},user:{id:userId},spec:{factory:'example.reward',visibility:'owner',transfer:'retain',data:{}}}};item.inputDigest=bindingFactoryInputDigest(item);return item;
}
const operation=kind=>({pure:'produce',provision:'provision',activation:'activate'})[kind];
const request=(remote,batchId,entries,op=operation(entries[0].kind))=>({protocol:bindingFactoryProtocol,operation:op,requestId:randomUUID(),...remote.grant(),batchId,inputDigest:contentDigest(entries.map(bindingFactoryIdentity)),deadline:Date.now()+10000,context:{entries}});
const refresh=item=>({...item,inputDigest:bindingFactoryInputDigest(item)});
async function temporary(t){const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'node-binding-factory-'));processes.set(t,new Set());t.after(async()=>{for(const child of processes.get(t))await stop(child);assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});});return join(directory,'issuer.sqlite');}
async function start(t,database,environment={}){
  const child=spawn(process.execPath,[example,database],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BINDING_FACTORY_TOKEN:token,BINDING_FACTORY_PROVIDER_ID:providerId,BINDING_FACTORY_PENDING_EVERY:'0',BINDING_FACTORY_DELAY_MS:'0',...environment}});child.stderr.resume();
  processes.get(t).add(child);
  t.after(()=>stop(child));
  const port=await new Promise((fulfill,reject)=>{let output='',settled=false;const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value);};const timer=setTimeout(()=>finish(reject,Error('Issuer startup timed out')),10000);child.once('error',error=>finish(reject,error));child.once('exit',()=>finish(reject,Error('Issuer exited before readiness')));child.stdout.on('data',data=>{output+=data;if(output.includes('\n')){const port=Number(output.trim());if(Number.isInteger(port)&&port>0&&port<=65535)finish(fulfill,port);else finish(reject,Error('Invalid issuer readiness'));}});});
  return {child,kind:environment.BINDING_FACTORY_KIND??'provision',providerId:environment.BINDING_FACTORY_PROVIDER_ID??providerId,url:`http://127.0.0.1:${port}/binding-factory`};
}
async function stop(child){if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}}
function remote(t,issuer,options={}){const value=createRemoteBindingFactory({kind:issuer.kind??'provision',revision:1,providerId:issuer.providerId??providerId,url:issuer.url,token,allowLoopbackHttp:true,...options});t.after(()=>value.close());return value;}
function rows(database){const db=new DatabaseSync(database,{readOnly:true});try{return db.prepare('SELECT * FROM factory_entries ORDER BY invocation_id').all();}finally{db.close();}}
async function post(issuer,value,status=200,options={}){
  const body=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value));
  const response=await new Promise((fulfill,reject)=>{
    const req=httpRequest(options.url??issuer.url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token,'content-length':String(body.length),...options.headers},signal:AbortSignal.timeout(10000)},res=>{const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>1048576){res.destroy(Error('Response limit'));return;}chunks.push(chunk);});res.on('error',reject);res.on('end',()=>fulfill({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks),complete:res.complete}));});req.on('error',reject);
    // The declared-size bound must reject before any oversized body is uploaded.
    req.end(body.length>1048576?undefined:body);
  });
  assert.equal(response.status,status);assert(response.complete);assert.equal(response.headers['cache-control'],'no-store');const result=JSON.parse(response.body);if(status===200||status===503)validateBindingFactoryResponse(result);else assert.deepEqual(result,{});return result;
}

for(const kind of ['pure','provision','activation'])test(kind+' factory deduplicates exact identities across concurrent processes and restart',async t=>{
  const database=await temporary(t),env={BINDING_FACTORY_KIND:kind},first=await start(t,database,env),second=await start(t,database,env),one=remote(t,first),two=remote(t,second),batch=randomUUID(),item=entry(kind),initial=request(one,batch,[item]),snapshot=structuredClone(initial);
  const [a,b]=await Promise.all([one.evaluate(initial),two.evaluate(request(two,batch,[item]))]);assert.deepEqual(a.results,b.results);assert.equal(a.results[0].state,'ready');assert.equal(a.results[0].data.mode,kind);assert.deepEqual(initial,snapshot);assert(!Object.hasOwn(a.results[0],'input'));
  assert.deepEqual((await two.evaluate(request(two,batch,[item],'lookup'))).results,a.results);
  for(const changed of [refresh({...item,namespace:'example.other'}),refresh({...item,factoryRevision:2})]){
    if(changed.factoryRevision===2)await post(first,request(one,batch,[changed]),400);
    else assert.equal((await one.evaluate(request(one,batch,[changed]))).results[0].errorCode,'conflict');
  }
  const changed=structuredClone(item);changed.input.spec.data={changed:true};const conflict=await one.evaluate(request(one,batch,[refresh(changed)]));assert.equal(conflict.results[0].errorCode,'conflict');assert(!JSON.stringify(conflict).includes(a.results[0].data.value));
  assert.equal((await one.evaluate(request(one,randomUUID(),[item]))).results[0].errorCode,'conflict');
  await stop(first.child);await stop(second.child);const restarted=remote(t,await start(t,database,env));assert.deepEqual((await restarted.evaluate(request(restarted,batch,[item]))).results,a.results);assert.equal(rows(database).length,1);assert.equal(rows(database)[0].effect_count,kind==='pure'?0:1);
});

test('partial provision survives restart and cancellation fences running and never-started effects',async t=>{
  const database=await temporary(t),first=await start(t,database,{BINDING_FACTORY_PENDING_EVERY:'2'}),one=remote(t,first),batch=randomUUID(),items=[entry(),entry('provision',1)],initial=await one.evaluate(request(one,batch,items));assert.deepEqual(initial.results.map(row=>row.state),['ready','pending']);await stop(first.child);
  const issuer=await start(t,database,{BINDING_FACTORY_DELAY_MS:'200'}),two=remote(t,issuer),pending=two.evaluate(request(two,batch,items));
  const until=Date.now()+3000;while(rows(database).find(row=>row.invocation_id===items[1].invocationId).attempts<2){assert(Date.now()<until);await delay(5);}
  const cancelled=await two.evaluate(request(two,batch,items,'cancel'));assert(cancelled.results.every(row=>row.state==='cancelled'&&!Object.hasOwn(row,'data')));assert.equal((await pending).results.find(row=>row.invocationId===items[1].invocationId).state,'cancelled');assert.deepEqual(rows(database).map(row=>row.effect_count).sort(),[0,1]);
  const absent=entry('provision',2);assert.equal((await two.evaluate(request(two,batch,[absent],'lookup'))).results[0].state,'not-created');assert.equal(rows(database).length,2);assert.equal((await two.evaluate(request(two,batch,[absent],'cancel'))).results[0].state,'cancelled');assert.equal((await two.evaluate(request(two,batch,[absent]))).results[0].state,'cancelled');
  await stop(issuer.child);const restarted=remote(t,await start(t,database));assert((await restarted.evaluate(request(restarted,batch,items))).results.every(row=>row.state==='cancelled'));assert.equal(rows(database).find(row=>row.invocation_id===absent.invocationId).effect_count,0);
});

for(const kind of ['pure','provision','activation'])test('lost '+kind+' reply is looked up after restart without another effect',async t=>{
  const database=await temporary(t),env={BINDING_FACTORY_KIND:kind},issuer=await start(t,database,env),batch=randomUUID(),item=entry(kind);
  const proxy=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const upstream=await fetch(issuer.url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:Buffer.concat(chunks)});assert.equal(upstream.status,200);await upstream.arrayBuffer();res.destroy();}catch{res.destroy();}});await new Promise(done=>proxy.listen(0,'127.0.0.1',done));t.after(async()=>{proxy.closeAllConnections();await new Promise(done=>proxy.close(done));});
  const losing=remote(t,{kind,url:`http://127.0.0.1:${proxy.address().port}/binding-factory`});await assert.rejects(losing.evaluate(request(losing,batch,[item])),error=>error.code==='POLICY_UNAVAILABLE'&&!error.message.includes('SYNTHETIC-BINDING'));
  assert.equal(rows(database)[0].effect_count,kind==='pure'?0:1);await stop(issuer.child);const restarted=await start(t,database,env),value=remote(t,restarted),looked=await value.evaluate(request(value,batch,[item],'lookup'));assert.equal(looked.results[0].state,'ready');assert.deepEqual((await value.evaluate(request(value,batch,[item]))).results,looked.results);
  if(kind==='activation'){await post(restarted,request(value,batch,[item],'cancel'),400);assert.equal(rows(database)[0].state,'ready');}else assert.equal((await value.evaluate(request(value,batch,[item],'cancel'))).results[0].state,'cancelled');assert.equal(rows(database)[0].effect_count,kind==='pure'?0:1);
});

test('separate activation identities have independent effects and original identities cannot change beneficiaries',async t=>{
  const database=await temporary(t),issuer=await start(t,database,{BINDING_FACTORY_KIND:'activation'}),value=remote(t,issuer),batch=randomUUID(),a=entry('activation'),b=entry('activation',1);b.userId='second';b.input.user.id='second';b.input.copy.ownerId='second';const items=[a,refresh(b)],result=await value.evaluate(request(value,batch,items));assert(result.results.every(row=>row.state==='ready'));assert.equal(new Set(result.results.map(row=>row.data.value)).size,2);assert(rows(database).every(row=>row.effect_count===1));
  const changed=structuredClone(a);changed.userId='second';changed.input.user.id='second';changed.input.copy.ownerId='second';const conflict=await value.evaluate(request(value,batch,[refresh(changed)]));assert.equal(conflict.results[0].errorCode,'conflict');assert(rows(database).every(row=>row.effect_count===1));
});

test('factory enforces scoped user fields, input identity and bounded native results without reflecting private text',async t=>{
  const database=await temporary(t),issuer=await start(t,database,{BINDING_FACTORY_USER_FIELDS:'["id","profile.level"]'}),value=remote(t,issuer,{userFields:['id','profile.level']}),batch=randomUUID(),item=entry();item.input.user.profile={level:1.25};const valid=request(value,batch,[refresh(item)]),ready=await value.evaluate(valid),secret=ready.results[0].data.value;
  for(const patch of [{providerId:'other.binding'},{inputDigest:'0'.repeat(64)},{operation:'produce'},{generation:true},{requestId:'invalid'},{context:{entries:[]}}])assert(!JSON.stringify(await post(issuer,{...valid,...patch},400)).includes(secret));
  for(const user of [{id:'collector',profile:{level:1,secret:'SYNTHETIC-PRIVATE'}},{id:'collector',private:{}},{id:'other',profile:{level:1}}]){const changed=structuredClone(item);changed.input.user=user;const invalid=request(value,batch,[refresh(changed)]);await assert.rejects(value.evaluate(invalid),error=>['BINDING_FACTORY_FIELD','INVALID_BINDING_FACTORY_REQUEST'].includes(error.code));await post(issuer,invalid,400);}
  const changed=structuredClone(item);changed.input.spec.data={value:'SYNTHETIC-PRIVATE-ERROR'};await post(issuer,request(value,batch,[changed]),400);
  for(const body of ['{','null','[]','{"context":{},"context":{}}',Buffer.from([0xff]),JSON.stringify(valid).replace('"generation":1','"generation":9007199254740991.1'),'x'.repeat(1048577)])await post(issuer,body,400);
  await post(issuer,valid,401,{headers:{authorization:'Bearer revoked-fixture-credential'}});await post(issuer,valid,400,{url:issuer.url+'?unexpected=1'});
  const tooLarge=structuredClone(item);tooLarge.input.copy.metadata={value:'x'.repeat(262144)};await post(issuer,request(value,batch,[refresh(tooLarge)]),400);
  const mismatch={...ready,results:[{...ready.results[0],copyId:randomUUID()}]};assert.throws(()=>matchBindingFactoryResults(valid,mismatch));
  assert.doesNotThrow(()=>validateBindingFactoryResponse({...ready,results:[{...ready.results[0],data:{value:'x'.repeat(32756)}}]}));
  assert.throws(()=>validateBindingFactoryResponse({...ready,results:[{...ready.results[0],data:{value:'x'.repeat(32768)}}]}));assert.throws(()=>validateBindingFactoryResponse({...ready,results:[{...ready.results[0],state:'not-activated',data:undefined}]}));
  assert.equal(rows(database).length,1);assert.equal(rows(database)[0].effect_count,1);
});

test('reusing a durable database under another provider cannot disclose or reproduce an old result',async t=>{
  const database=await temporary(t),first=await start(t,database),one=remote(t,first),batch=randomUUID(),item=entry(),ready=await one.evaluate(request(one,batch,[item]));await stop(first.child);
  const changed=remote(t,await start(t,database,{BINDING_FACTORY_PROVIDER_ID:'other.binding'}));for(const op of ['lookup','provision','cancel']){const conflict=await changed.evaluate(request(changed,batch,[item],op));assert.equal(conflict.results[0].errorCode,'conflict');assert(!JSON.stringify(conflict).includes(ready.results[0].data.value));}assert.equal(rows(database)[0].state,'ready');assert.equal(rows(database)[0].effect_count,1);
});

test('expired requests do nothing and terminal cancellation remains possible at full fixture capacity',async t=>{
  const database=await temporary(t),issuer=await start(t,database,{BINDING_FACTORY_MAX_ROWS:'1'}),value=remote(t,issuer),batch=randomUUID(),item=entry(),valid=request(value,batch,[item]),expired=await post(issuer,{...valid,deadline:1},503);assert.equal(expired.status,'error');assert.equal(expired.errorCode,'unavailable');assert.equal(rows(database).length,0);
  const ready=await value.evaluate(valid),overflow=await value.evaluate(request(value,batch,[entry()]));assert.equal(overflow.results[0].errorCode,'unavailable');assert(!JSON.stringify(overflow).includes(ready.results[0].data.value));assert.equal((await value.evaluate(request(value,batch,[item],'cancel'))).results[0].state,'cancelled');assert.equal(rows(database).length,1);assert.equal(rows(database)[0].effect_count,1);
});
