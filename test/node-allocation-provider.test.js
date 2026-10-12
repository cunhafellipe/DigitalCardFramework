import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {request as httpRequest} from 'node:http';
import {createRemoteAllocationStrategy,allocationStrategyProtocol,validateAllocationStrategyResponse} from '../src/remote-allocation-strategy.js';
import {createRemoteStockAllocationStrategy,stockAllocationStrategyProtocol,validateStockAllocationStrategyResponse} from '../src/remote-stock-allocation-strategy.js';
import {createRemoteExternalAllocationStrategy,externalAllocationStrategyProtocol,validateExternalAllocationStrategyResponse} from '../src/remote-external-allocation-strategy.js';
import {allocationStrategyV2Protocol,validateAllocationStrategyV2Response} from '../src/allocation-strategy-contracts.js';
import {stockAllocationStrategyV2Protocol,validateStockAllocationStrategyV2Response} from '../src/stock-allocation-strategy-contracts.js';
import {externalAllocationStrategyV2Protocol,validateExternalAllocationStrategyV2Response} from '../src/external-allocation-strategy-contracts.js';
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
    let responseStarted=false,writeFailure;
    const request=httpRequest(options.url??receiver.url,{method:'POST',headers,signal:AbortSignal.timeout(10000)},response=>{
      responseStarted=true;const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>262144){response.destroy(Error('Provider response exceeds limit'));return;}chunks.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>{if(!response.complete){reject(Error('Incomplete provider response'));return;}fulfill({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)});});
    });
    request.on('error',error=>{
      // An early HTTP rejection can close the connection while its body is still uploading.
      // Accept only a complete response whose status and JSON are checked below.
      if(error.code==='EPIPE'&&status>=400){writeFailure=error;return;}reject(error);
    });
    request.on('close',()=>{if(!responseStarted)reject(writeFailure??Error('Provider closed without a response'));});
    // Oversized Content-Length must be rejected before reading an uploaded body.
    // Withhold that body so an early connection close cannot race a large write.
    // A missing or incomplete rejection still fails through the handlers above.
    request.end(body.length>1048576?undefined:body);
  });
  assert.equal(result.status,status);assert.ok(result.body.length<=262144);assert.equal(result.headers['cache-control'],'no-store');const resultValue=JSON.parse(result.body);
  if(status===200||status===503)new Map([[allocationStrategyProtocol,validateAllocationStrategyResponse],[stockAllocationStrategyProtocol,validateStockAllocationStrategyResponse],[externalAllocationStrategyProtocol,validateExternalAllocationStrategyResponse],[allocationStrategyV2Protocol,validateAllocationStrategyV2Response],[stockAllocationStrategyV2Protocol,validateStockAllocationStrategyV2Response],[externalAllocationStrategyV2Protocol,validateExternalAllocationStrategyV2Response]]).get(resultValue.protocol)(resultValue);else assert.deepEqual(resultValue,{});return resultValue;
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
test('Node stock allocation provider plans and replays through its commerce transport and isolates protocols',async()=>{
  const wallet=await start(),stock={...wallet,url:wallet.url.replace('/allocate-packs','/allocate-stock')};
  const remote=createRemoteStockAllocationStrategy({algorithm:'weighted-deck@1',scope:'commerce-stock',providerId,url:stock.url,token,allowLoopbackHttp:true});
  const makeStock=()=>{const request=make();request.protocol=stockAllocationStrategyProtocol;request.scope='commerce-stock';request.context.shop={id:randomUUID(),ownerId:'merchant'};return request;};
  try{
    const request={...makeStock(),...remote.grant()},snapshot=structuredClone(request),expected={...echo(request),status:'planned',allocations:planAllocation(request.context)};
    assert.deepEqual(await remote.evaluate(request),expected);assert.deepEqual(await remote.evaluate(request),expected);assert.deepEqual(request,snapshot);
    assert.deepEqual(await post(stock,request),expected);
    await post(wallet,request,400);await post(stock,make(),400);
    const walletProtocol=structuredClone(request);walletProtocol.protocol=allocationStrategyProtocol;await post(stock,walletProtocol,400);
    const walletScope=structuredClone(request);walletScope.scope='catalog-purchase';await post(stock,walletScope,400);
    for(const shop of [undefined,null,{id:'invalid',ownerId:'merchant'},{id:request.context.shop.id},{...request.context.shop,allocated:true}]){
      const invalid=structuredClone(request);if(shop===undefined)delete invalid.context.shop;else invalid.context.shop=shop;await post(stock,invalid,400);
    }
    await post(stock,{...request,providerId:'other.allocation'},400);
    const body=JSON.stringify(request);
    await post(stock,body,401,{headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(body)),authorization:'Bearer revoked-fixture-credential'}});
    await post(stock,body.replace('"ownerId":"merchant"','"ownerId":"merchant","owner\\u0049d":"merchant"'),400);
    await post(stock,body.replace('"ownerId":"merchant"','"ownerId":"\\ud800"'),400);
    await post(stock,Buffer.from([0xff,0xfe]),400);await post(stock,'x'.repeat(1048577),400);
    const depleted=structuredClone(request);depleted.context.variants.forEach(variant=>{variant.remaining=0;});assert.deepEqual(await post(stock,depleted,503),{...echo(depleted),status:'error',errorCode:'unavailable'});
    const walletRequest=make();assert.deepEqual(await post(wallet,walletRequest),{...echo(walletRequest),status:'planned',allocations:planAllocation(walletRequest.context)});
    assert.deepEqual(await remote.evaluate(request),expected);
  }finally{remote.close();await stop(wallet);}
});
test('Node external fulfillment provider binds preparation identity and accepts only allocation material',async()=>{
  const wallet=await start(),external={...wallet,url:wallet.url.replace('/allocate-packs','/allocate-external')},stock={...wallet,url:wallet.url.replace('/allocate-packs','/allocate-stock')};
  const remote=createRemoteExternalAllocationStrategy({algorithm:'weighted-deck@1',scope:'external-fulfillment',providerId,url:external.url,token,allowLoopbackHttp:true});
  try{
    const request={...make(),...remote.grant(),protocol:externalAllocationStrategyProtocol,scope:'external-fulfillment'};request.context.preparationId='ep_'+'e'.repeat(64);
    const snapshot=structuredClone(request),expected={...echo(request),status:'planned',allocations:planAllocation(request.context)};
    assert.deepEqual(await remote.evaluate(request),expected);assert.deepEqual(await remote.evaluate(request),expected);assert.deepEqual(request,snapshot);
    assert.deepEqual(await post(external,request),expected);
    await post(wallet,request,400);await post(stock,request,400);await post(external,make(),400);
    for(const patch of [{protocol:allocationStrategyProtocol},{protocol:stockAllocationStrategyProtocol},{scope:'catalog-purchase'},{scope:'commerce-stock'},{providerId:'other.allocation'}])await post(external,{...request,...patch},400);
    for(const preparationId of [undefined,null,'ep_invalid','ep_'+'E'.repeat(64),request.context.preparationId+'\n']){
      const invalid=structuredClone(request);if(preparationId===undefined)delete invalid.context.preparationId;else invalid.context.preparationId=preparationId;await post(external,invalid,400);
    }
    for(const field of ['payment','proof','debitReceipt','credential']){
      await post(external,{...request,[field]:{reference:'synthetic-reference'}},400);
      await post(external,{...request,context:{...request.context,[field]:{reference:'synthetic-reference'}}},400);
    }
    const body=JSON.stringify(request);await post(external,body.replace('"preparationId":','"preparationId":"ep_'+'f'.repeat(64)+'","preparationId":'),400);
    await post(external,body,401,{headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(body)),authorization:'Bearer revoked-fixture-credential'}});
    const depleted=structuredClone(request);depleted.context.variants.forEach(variant=>{variant.remaining=0;});assert.deepEqual(await post(external,depleted,503),{...echo(depleted),status:'error',errorCode:'unavailable'});
    assert.deepEqual(await remote.evaluate(request),expected);
  }finally{remote.close();await stop(wallet);}
});
test('Node v2 allocation endpoints preserve deterministic pity and duplicate plans without authoritative counters',async()=>{
  const wallet=await start(),stock={...wallet,url:wallet.url.replace('/allocate-packs','/allocate-stock')},external={...wallet,url:wallet.url.replace('/allocate-packs','/allocate-external')};
  const makeV2=()=>{
    const request=make();request.protocol=allocationStrategyV2Protocol;
    Object.assign(request.context,{mode:'personalized',quantity:1,ownedCards:[{cardId:'blue-card',owned:true},{cardId:'red-card',owned:false}],pityCount:1});
    Object.assign(request.context.product,{strategy:{algorithm:'weighted-deck@2',version:2,deckScope:'purchase-slot'},duplicatePolicy:{scope:'inventory',fallback:'reject'},pity:{after:2,rarityId:'rare',minimumRank:3}});
    request.context.variants=request.context.variants.map((variant,index)=>({...variant,cardId:index?'red-card':'blue-card',rarityRank:index?3:1}));return request;
  };
  const checkPlan=async(receiver,request)=>{
    const snapshot=structuredClone(request),expected={...echo(request),status:'planned',allocations:planAllocation(request.context)};
    const result=await post(receiver,request);assert.deepEqual(result,expected);assert.deepEqual(await post(receiver,request),result);assert.deepEqual(request,snapshot);
    const factory=request.scope==='commerce-stock'?createRemoteStockAllocationStrategy:request.scope==='external-fulfillment'?createRemoteExternalAllocationStrategy:createRemoteAllocationStrategy;
    const remote=factory({algorithm:'weighted-deck@2',scope:request.scope,providerId,url:receiver.url,token,allowLoopbackHttp:true});
    try{const transported={...request,...remote.grant()},original=structuredClone(transported);assert.deepEqual(await remote.evaluate(transported),{...echo(transported),status:'planned',allocations:expected.allocations});assert.deepEqual(transported,original);}finally{remote.close();}
    assert(!Object.hasOwn(result,'pityCount'));assert(!Object.hasOwn(result,'ownedCards'));return result;
  };
  try{
    const pity=makeV2(),result=await checkPlan(wallet,pity);assert.deepEqual(result.allocations[0].variantIds,['red']);
    const duplicate=makeV2();duplicate.context.product.pity=null;duplicate.context.pityCount=0;duplicate.context.product.duplicatePolicy.scope='pack';duplicate.context.product.slots[0].count=2;duplicate.context.ownedCards=[];
    const distinct=await checkPlan(wallet,duplicate);assert.equal(new Set(distinct.allocations[0].variantIds).size,2);
    const stocked=structuredClone(duplicate);stocked.protocol=stockAllocationStrategyV2Protocol;stocked.scope='commerce-stock';stocked.context.mode='stock';stocked.context.ownedCards=[];stocked.context.pityCount=0;stocked.context.shop={id:randomUUID(),ownerId:'merchant'};await checkPlan(stock,stocked);
    const paid=makeV2();paid.protocol=externalAllocationStrategyV2Protocol;paid.scope='external-fulfillment';paid.context.preparationId='ep_'+'e'.repeat(64);await checkPlan(external,paid);
    for(const [receiver,request] of [[stock,pity],[external,pity],[wallet,stocked],[wallet,paid]])await post(receiver,request,400);
    await post(wallet,{...pity,protocol:allocationStrategyProtocol},400);await post(wallet,{...make(),protocol:allocationStrategyV2Protocol},400);
    for(const mutate of [value=>{delete value.context.mode;},value=>{value.context.mode='unknown';},value=>{delete value.context.ownedCards;},value=>{value.context.pityCount=-1;},value=>{value.context.product.strategy.version=1;},value=>{value.context.product.duplicatePolicy.fallback='unknown';},value=>{delete value.context.variants[0].cardId;},value=>{value.context.authoritativePityCount=0;}]){const invalid=makeV2();mutate(invalid);await post(wallet,invalid,400);}
    const forbiddenCounter={...result,pityCount:0};assert.throws(()=>validateAllocationStrategyV2Response(forbiddenCounter));
    await checkPlan(wallet,pity);
  }finally{await stop(wallet);}
});
