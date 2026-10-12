import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {request as httpRequest} from 'node:http';
import {createRemoteAllocationStrategy,allocationStrategyProtocol,validateAllocationStrategyResponse} from '../src/remote-allocation-strategy.js';
import {planAllocation} from '../src/allocation-planner.js';

const executable=fileURLToPath(new URL('../examples/plugins/node-allocation-provider.mjs',import.meta.url));
const token='synthetic-allocation-provider-credential',providerId='example.allocation';
const make=()=>({protocol:allocationStrategyProtocol,operation:'allocatePacks',scope:'catalog-purchase',phase:'allocate',requestId:randomUUID(),attemptId:randomUUID(),providerId,grantId:randomUUID(),generation:1,commandId:'a'.repeat(64),inputDigest:'b'.repeat(64),snapshotDigest:'c'.repeat(64),deadline:Date.now()+30000,context:{userId:'alice',product:{id:'starter',revision:1,strategy:{algorithm:'weighted-deck@1',version:1,deckScope:'purchase-slot'},slots:[{id:'card',role:'card',count:1,probability:{numerator:1,denominator:1},pool:[{variantId:'blue',weight:2},{variantId:'red',weight:2}]},{id:'insert',role:'insert',count:1,probability:{numerator:0,denominator:1},pool:[]}]},quantity:2,variants:[{id:'blue',remaining:2},{id:'red',remaining:null}],entropy:{seed:'d'.repeat(64),cursor:0}}});
const echo=request=>Object.fromEntries(Object.entries(request).filter(([key])=>key!=='context'));
async function start(environment={}){
  const child=spawn(process.execPath,[executable],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,ALLOCATION_PROVIDER_TOKEN:token,ALLOCATION_PROVIDER_ID:providerId,...environment}});child.stderr.resume();
  try{
    const port=await new Promise((fulfill,reject)=>{
      let text='',settled=false;const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value);};
      const timer=setTimeout(()=>finish(reject,Error('Provider startup timed out')),10000);
      child.once('error',error=>finish(reject,error));child.once('exit',()=>finish(reject,Error('Provider exited before readiness')));
      child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n')){const port=Number(text.trim());if(Number.isInteger(port)&&port>0&&port<=65535)finish(fulfill,port);else finish(reject,Error('Invalid provider readiness'));}});
    });
    return {child,url:`http://127.0.0.1:${port}/allocate-packs`};
  }catch(error){await stop({child});throw error;}
}
async function stop({child}){if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}}
async function post(receiver,value,status=200,options={}){
  const body=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value));
  let headers=options.headers??{'content-type':'application/json',authorization:'Bearer '+token,'content-length':String(body.length)};
  if(Array.isArray(headers))headers=['Host',new URL(receiver.url).host,...headers];
  const result=await new Promise((fulfill,reject)=>{
    const request=httpRequest(options.url??receiver.url,{method:'POST',headers,signal:AbortSignal.timeout(10000)},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);response.on('end',()=>fulfill({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));});request.on('error',reject);request.end(body);
  });
  assert.equal(result.status,status);assert.ok(result.body.length<=262144);assert.equal(result.headers['cache-control'],'no-store');const resultValue=JSON.parse(result.body);
  if(status===200||status===503)validateAllocationStrategyResponse(resultValue);else assert.deepEqual(resultValue,{});return resultValue;
}
test('Node allocation provider computes and replays actual plans through framework transport without effects',async()=>{
  const receiver=await start(),remote=createRemoteAllocationStrategy({algorithm:'weighted-deck@1',scope:'catalog-purchase',providerId,url:receiver.url,token,allowLoopbackHttp:true});
  try{
    const request={...make(),...remote.grant()},snapshot=structuredClone(request);
    const expected={...echo(request),status:'planned',allocations:planAllocation(request.context)};
    assert.deepEqual(await remote.evaluate(request),expected);assert.deepEqual(await remote.evaluate(request),expected);assert.deepEqual(request,snapshot);
    const direct=make();assert.deepEqual(await post(receiver,direct),{...echo(direct),status:'planned',allocations:planAllocation(direct.context)});
    const depleted=make();depleted.context.variants.forEach(variant=>{variant.remaining=0;});
    assert.deepEqual(await post(receiver,depleted,503),{...echo(depleted),status:'error',errorCode:'unavailable'});
    assert.deepEqual(await remote.evaluate(request),expected);
  }finally{remote.close();await stop(receiver);}
});
test('Node allocation endpoint enforces authentication, identity, strict JSON and request bounds',async()=>{
  const receiver=await start();
  try{
    const request=make(),body=JSON.stringify(request);
    for(const authorization of ['', 'Bearer revoked-fixture-credential'])await post(receiver,request,401,{headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(body)),...(authorization?{authorization}:{})}});
    for(const patch of [{providerId:'other.allocation'},{protocol:'digital-card-pack-allocation@2'},{operation:'settle'},{scope:'exchange'},{phase:'purchase'},{generation:0},{generation:true},{requestId:'invalid'},{attemptId:'invalid'},{grantId:'invalid'},{deadline:-1},{commandId:'z'.repeat(64)},{allocated:true},{context:null}])await post(receiver,{...request,...patch},400);
    for(const key of Object.keys(request)){const missing={...request};delete missing[key];await post(receiver,missing,400);}
    const variants=[null,[],{},'{','{"context":{},"cont\\u0065xt":{}}','{"providerId":"example.allocation",'+body.slice(1),body+' {}',body.replace('"alice"','"\\ud800"'),body.replace('"generation":1','"generation":9007199254740991.1'),body.replace('"generation":1','"generation":1e999999999'),Buffer.from([0xff,0xfe]),'x'.repeat(1048577)];
    for(const value of variants)await post(receiver,value,400);
    for(const mutate of [value=>{value.context.allocate=true;},value=>{value.context.quantity=101;},value=>{value.context.product.strategy.algorithm='unknown';},value=>{value.context.product.slots[0].pool[0].weight=0;},value=>{value.context.entropy.seed='hidden';}]){const value=make();mutate(value);await post(receiver,value,400);}
    await post(receiver,body,400,{url:receiver.url+'?unsupported=1'});
    await post(receiver,body,400,{headers:{'content-type':'text/plain',authorization:'Bearer '+token,'content-length':String(Buffer.byteLength(body))}});
    await post(receiver,body,400,{headers:{'content-type':'application/json',authorization:'Bearer '+token,'transfer-encoding':'chunked'}});
    await post(receiver,body,401,{headers:['Content-Type','application/json','Authorization','Bearer '+token,'Authorization','Bearer '+token,'Content-Length',String(Buffer.byteLength(body))]});
    await post(receiver,body,400,{headers:['Content-Type','application/json','Content-Type','application/json','Authorization','Bearer '+token,'Content-Length',String(Buffer.byteLength(body))]});
    const integral=body.replace('"generation":1','"generation":1.0').replace('"cursor":0','"cursor":0e999999999');assert.deepEqual(await post(receiver,integral),{...echo(request),status:'planned',allocations:planAllocation(request.context)});
    const longIntegral=body.replace('"generation":1','"generation":1'+'0'.repeat(1000)+'e-1000');assert.deepEqual(await post(receiver,longIntegral),{...echo(request),status:'planned',allocations:planAllocation(request.context)});
    const maximum=make();maximum.context.quantity=100;maximum.context.product.slots=[{...maximum.context.product.slots[0],count:20,pool:[{variantId:'red',weight:2000}]}];
    const plan=await post(receiver,maximum);assert.equal(plan.allocations.length,100);assert.equal(plan.allocations.flatMap(entry=>entry.variantIds).length,2000);
    maximum.context.product.slots[0].count=21;await post(receiver,maximum,400);
    const largeResponse=make(),variantId='v'.repeat(100);largeResponse.context.quantity=100;largeResponse.context.variants=[{id:variantId,remaining:null}];
    largeResponse.context.product.slots=Array.from({length:20},(_,index)=>({id:('slot'+index).padEnd(100,'x'),role:'card',count:1,probability:{numerator:1,denominator:1},pool:[{variantId,weight:100}]}));
    await post(receiver,largeResponse,500);
    assert.equal((await post(receiver,make())).status,'planned');
  }finally{await stop(receiver);}
});
test('Node allocation provider refuses absent or invalid startup authority',async()=>{
  for(const environment of [{ALLOCATION_PROVIDER_TOKEN:''},{ALLOCATION_PROVIDER_TOKEN:'short'},{ALLOCATION_PROVIDER_TOKEN:'invalid credential with spaces'},{ALLOCATION_PROVIDER_TOKEN:token+'\n'},{ALLOCATION_PROVIDER_ID:'constructor'},{ALLOCATION_PROVIDER_ID:'bad identity'},{ALLOCATION_PROVIDER_ID:providerId+'\n'}])await assert.rejects(start(environment),/Provider exited before readiness/);
});
