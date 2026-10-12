import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {FrameworkWorkerService} from '../src/framework-worker-service.js';
import {createApiHandler} from '../src/http.js';
import {validateAllocationStrategyRequest} from '../src/allocation-strategy-contracts.js';
import {sampleCatalog} from '../examples/catalog.js';

const admin={role:'admin'},token='synthetic-allocation-host-credential';
const selector={algorithm:'weighted-deck@1',version:1,deckScope:'purchase-slot'};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function listen(server){await new Promise(done=>server.listen(0,'127.0.0.1',done));return 'http://127.0.0.1:'+server.address().port;}
async function close(server){server.closeAllConnections();await new Promise(done=>server.close(done));}
async function harness(t){
  const child=spawn(process.execPath,[fileURLToPath(new URL('../examples/plugins/node-allocation-provider.mjs',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,ALLOCATION_PROVIDER_TOKEN:token,ALLOCATION_PROVIDER_ID:'example.allocation'}});child.stderr.resume();
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}});
  const port=await new Promise((fulfill,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Provider readiness timed out')),10000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Provider exited before readiness'));});child.stdout.on('data',data=>{output+=data;if(output.includes('\n')){clearTimeout(timer);fulfill(Number(output.trim()));}});});
  assert(Number.isInteger(port)&&port>0&&port<=65535);
  const gateway={calls:[],hold:null,gates:[]};
  gateway.pause=()=>{const gate={arrived:deferred(),release:deferred()};gateway.hold=gate;gateway.gates.push(gate);return gate;};
  const proxy=createServer(async(request,response)=>{
    try{
      assert.equal(request.url,'/allocate-packs');assert.equal(request.headers.authorization,'Bearer '+token);
      const chunks=[];for await(const chunk of request)chunks.push(chunk);const body=Buffer.concat(chunks),value=validateAllocationStrategyRequest(JSON.parse(body));gateway.calls.push(value);
      const hold=gateway.hold;if(hold){hold.arrived.resolve(value);await hold.release.promise;}if(response.destroyed)return;
      const planned=await fetch(`http://127.0.0.1:${port}/allocate-packs`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body,signal:AbortSignal.timeout(10000)});
      response.writeHead(planned.status,{'content-type':'application/json'});response.end(Buffer.from(await planned.arrayBuffer()));
    }catch{response.destroy();}
  });
  const remoteOrigin=await listen(proxy);t.after(async()=>{for(const gate of gateway.gates)gate.release.resolve();await close(proxy);});
  const service=new FrameworkWorkerService({frameworkOptions:{remoteAllocation:{algorithm:'weighted-deck@1',scope:'catalog-purchase',providerId:'example.allocation',url:remoteOrigin+'/allocate-packs',token,allowLoopbackHttp:true,timeoutMs:5000}}});
  t.after(async()=>{if(service.status().state==='failed')await service.terminate();else await service.close();});await service.ready;
  const catalog=structuredClone(sampleCatalog);catalog.version=1;for(const variant of catalog.variants)variant.bindings={};
  catalog.products.push({id:'host',lineId:'sky',name:'Host pack',revision:1,price:{currencyId:'credits',amount:10},allocationStrategy:selector,slots:[{id:'main',count:1,pool:[{variantId:'dawn.standard',weight:2},{variantId:'cloud.standard',weight:2}]}]});
  await service.publishCatalog(admin,catalog);
  const actor={userId:(await service.registerUser(admin,{provider:'test',subject:'allocation-host',displayName:'Collector'})).id};
  await service.grantCurrency(admin,{userId:actor.userId,currencyId:'credits',amount:100,reason:'Fixture funding',key:'fund'});
  let handler;const server=createServer((request,response)=>handler(request,response)),origin=await listen(server);t.after(()=>close(server));
  handler=createApiHandler({framework:service,resolveIdentity:request=>request.headers.authorization==='test-collector'?actor:null,allowedOrigin:origin});
  const call=async(path,{body,status=200,signal}={})=>{
    const response=await fetch(origin+'/api'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'test-collector',...(body===undefined?{}:{origin,'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:signal??AbortSignal.timeout(10000)});
    assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();
  };
  return {service,actor,gateway,call};
}
function privateFieldsAbsent(value,seed){const text=JSON.stringify(value);assert(!text.includes(seed));for(const field of ['entropy','seed','cursor','variantIds','allocations','plan'])assert(!new RegExp('"'+field+'"\\s*:').test(text));}
async function drained(service){const until=Date.now()+3000;while(service.status().pendingRequests!==0){assert(Date.now()<until,'Worker cancellation did not settle');await delay(5);}}

test('worker remote allocation configuration reaches HTTP quote, async purchase, replay and sanitized status',async t=>{
  const x=await harness(t),quote=await x.call('/quote',{body:{productId:'host',quantity:2}}),input={...quote,key:'host-purchase'};
  assert.equal(x.gateway.calls.length,0);
  const receipt=await x.call('/purchase',{body:input});assert.equal(receipt.packs.length,2);assert.equal(x.gateway.calls.length,1);
  assert.deepEqual(await x.call('/purchase',{body:input}),receipt);assert.equal(x.gateway.calls.length,1);
  assert.equal((await x.call('/wallet')).credits,80);assert.equal((await x.call('/packs')).length,2);
  const status=await x.call('/allocations/status?productId=host');assert.equal(status.state,'completed');assert.equal(status.attemptId,x.gateway.calls[0].attemptId);
  privateFieldsAbsent(quote,x.gateway.calls[0].context.entropy.seed);privateFieldsAbsent(receipt,x.gateway.calls[0].context.entropy.seed);privateFieldsAbsent(status,x.gateway.calls[0].context.entropy.seed);
  const error=await x.call('/allocations/acknowledge',{body:{attemptId:status.attemptId},status:409});assert.equal(error.code,'ALLOCATION_COMPLETED');
  assert.equal((await x.service.audit(admin)).ok,true);
});
test('worker and HTTP cancellation preserve funds and private entropy; acknowledgement requires fresh review',async t=>{
  const x=await harness(t),quote=await x.call('/quote',{body:{productId:'host',quantity:2}}),input={...quote,key:'cancelled-purchase'},first=x.gateway.pause(),controller=new AbortController();
  const cancelled=assert.rejects(x.service.purchaseAsync(x.actor,input,{signal:controller.signal}),error=>error.code==='POLICY_ABORTED');
  const request=await first.arrived.promise;controller.abort();await cancelled;first.release.resolve();x.gateway.hold=null;
  assert.equal((await x.call('/wallet')).credits,100);assert.deepEqual(await x.call('/packs'),[]);
  const initialStatus=await x.call('/allocations/status?productId=host');assert.equal(initialStatus.state,'prepared');assert.equal(initialStatus.attemptId,request.attemptId);privateFieldsAbsent(initialStatus,request.context.entropy.seed);
  const second=x.gateway.pause(),httpController=new AbortController(),httpCancelled=assert.rejects(x.call('/purchase',{body:input,signal:httpController.signal}),error=>error.name==='AbortError');
  const retry=await second.arrived.promise;httpController.abort();await httpCancelled;await drained(x.service);second.release.resolve();x.gateway.hold=null;
  assert.equal(retry.attemptId,request.attemptId);assert.deepEqual(retry.context.entropy,request.context.entropy);
  assert.equal((await x.call('/wallet')).credits,100);assert.deepEqual(await x.call('/packs'),[]);
  const status=await x.call('/allocations/status?productId=host');assert.equal(status.state,'prepared');privateFieldsAbsent(status,request.context.entropy.seed);
  assert.deepEqual(await x.call('/allocations/acknowledge',{body:{attemptId:status.attemptId}}),{attemptId:status.attemptId,state:'acknowledged'});
  const old=await x.call('/purchase',{body:input,status:409});assert.equal(old.code,'ALLOCATION_ACKNOWLEDGED');privateFieldsAbsent(old,request.context.entropy.seed);
  const fresh={...await x.call('/quote',{body:{productId:'host',quantity:2}}),key:'reviewed-purchase'},receipt=await x.call('/purchase',{body:fresh});assert.equal(receipt.packs.length,2);
  const latest=x.gateway.calls.at(-1);assert.notEqual(latest.attemptId,request.attemptId);assert.deepEqual(latest.context.entropy,request.context.entropy);
  assert.equal((await x.call('/wallet')).credits,80);assert.equal(x.gateway.calls.length,3);assert.equal((await x.service.audit(admin)).ok,true);
});
