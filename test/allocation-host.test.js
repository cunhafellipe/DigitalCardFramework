import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {FrameworkWorkerService} from '../src/framework-worker-service.js';
import {createApiHandler} from '../src/http.js';
import {allocationStrategyV2Protocol,validateAllocationStrategyRequest,validateAllocationStrategyV2Request} from '../src/allocation-strategy-contracts.js';
import {stockAllocationStrategyProtocol,stockAllocationStrategyV2Protocol,validateStockAllocationStrategyRequest,validateStockAllocationStrategyV2Request} from '../src/stock-allocation-strategy-contracts.js';
import {externalAllocationStrategyProtocol,validateExternalAllocationStrategyRequest,validateExternalAllocationStrategyV2Request} from '../src/external-allocation-strategy-contracts.js';
import {externalPurchaseDigest} from '../src/external-purchases.js';
import {sampleCatalog} from '../examples/catalog.js';

const admin={role:'admin'},token='synthetic-allocation-host-credential';
const selector={algorithm:'weighted-deck@1',version:1,deckScope:'purchase-slot'};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function listen(server){await new Promise(done=>server.listen(0,'127.0.0.1',done));return 'http://127.0.0.1:'+server.address().port;}
async function close(server){server.closeAllConnections();await new Promise(done=>server.close(done));}
async function harness(t,{operator=false,paid=false,v2=false}={}){
  const child=spawn(process.execPath,[fileURLToPath(new URL('../examples/plugins/node-allocation-provider.mjs',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,ALLOCATION_PROVIDER_TOKEN:token,ALLOCATION_PROVIDER_ID:'example.allocation'}});child.stderr.resume();
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}});
  const port=await new Promise((fulfill,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Provider readiness timed out')),10000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Provider exited before readiness'));});child.stdout.on('data',data=>{output+=data;if(output.includes('\n')){clearTimeout(timer);fulfill(Number(output.trim()));}});});
  assert(Number.isInteger(port)&&port>0&&port<=65535);
  const gateway={calls:[],hold:null,gates:[]};
  gateway.pause=()=>{const gate={arrived:deferred(),release:deferred()};gateway.hold=gate;gateway.gates.push(gate);return gate;};
  const proxy=createServer(async(request,response)=>{
    try{
      assert(['/allocate-packs','/allocate-stock','/allocate-external'].includes(request.url));assert.equal(request.headers.authorization,'Bearer '+token);
      const chunks=[];for await(const chunk of request)chunks.push(chunk);const body=Buffer.concat(chunks),parsed=JSON.parse(body),secondVersion=parsed.protocol.endsWith('@2');
      const validate=request.url==='/allocate-external'?(secondVersion?validateExternalAllocationStrategyV2Request:validateExternalAllocationStrategyRequest):request.url==='/allocate-stock'?(secondVersion?validateStockAllocationStrategyV2Request:validateStockAllocationStrategyRequest):(secondVersion?validateAllocationStrategyV2Request:validateAllocationStrategyRequest);
      const value=validate(parsed);gateway.calls.push(value);
      const hold=gateway.hold;if(hold){hold.arrived.resolve(value);await hold.release.promise;}if(response.destroyed)return;
      const planned=await fetch(`http://127.0.0.1:${port}${request.url}`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body,signal:AbortSignal.timeout(10000)});
      response.writeHead(planned.status,{'content-type':'application/json'});response.end(Buffer.from(await planned.arrayBuffer()));
    }catch{response.destroy();}
  });
  const remoteOrigin=await listen(proxy);t.after(async()=>{for(const gate of gateway.gates)gate.release.resolve();await close(proxy);});
  let extensionModule,directory;const temporaryBase=resolve(tmpdir());
  if(paid){
    directory=await mkdtemp(join(temporaryBase,'allocation-payment-worker-'));extensionModule=join(directory,'provider.mjs');
    const digestModule=new URL('../src/external-purchases.js',import.meta.url).href;
    await writeFile(extensionModule,`import {externalPurchaseDigest} from ${JSON.stringify(digestModule)};
export function createFrameworkOptions(){return {externalPurchaseProviders:{'test.payment':{
validateIntent:({intent})=>intent.providerId==='test.payment'&&intent.transactionId.startsWith('paid-')&&intent.externalCurrency==='points'&&intent.externalUnits===String(intent.quote.price.amount),
verifyProof:({proof})=>proof.providerId==='test.payment'&&proof.externalCurrency==='points'&&proof.reference===proof.kind+':'+externalPurchaseDigest({...proof,reference:null}),
}}};}
`);
  }
  const algorithm=v2?'weighted-deck@2':'weighted-deck@1';
  const service=new FrameworkWorkerService({...(extensionModule?{extensionModule}:{}),frameworkOptions:{remoteAllocation:{algorithm,scope:'catalog-purchase',providerId:'example.allocation',url:remoteOrigin+'/allocate-packs',token,allowLoopbackHttp:true,timeoutMs:5000},remoteStockAllocation:{algorithm,scope:'commerce-stock',providerId:'example.allocation',url:remoteOrigin+'/allocate-stock',token,allowLoopbackHttp:true,timeoutMs:5000},...(paid?{remoteExternalAllocation:{algorithm,scope:'external-fulfillment',providerId:'example.allocation',url:remoteOrigin+'/allocate-external',token,allowLoopbackHttp:true,timeoutMs:5000}}:{})}});
  t.after(async()=>{try{if(service.status().state==='failed')await service.terminate();else await service.close();}finally{if(directory){if(!resolve(directory).startsWith(temporaryBase+sep))throw Error('Unsafe fixture cleanup target');await rm(directory,{recursive:true,force:true});}}});await service.ready;
  const catalog=structuredClone(sampleCatalog);catalog.version=1;for(const variant of catalog.variants)variant.bindings={};
  catalog.products.push({id:'host',lineId:'sky',name:'Host pack',revision:1,price:{currencyId:'credits',amount:10},allocationStrategy:v2?{algorithm,version:2,deckScope:'purchase-slot'}:selector,...(v2?{duplicatePolicy:{scope:'inventory',fallback:'reject'},pity:{after:1,rarityId:'rare'}}:{}),slots:[{id:'main',count:1,pool:[{variantId:'dawn.standard',weight:2},{variantId:v2?'aurora.holo':'cloud.standard',weight:2}]}]});
  await service.publishCatalog(admin,catalog);
  const actor={userId:(await service.registerUser(admin,{provider:'test',subject:'allocation-host',displayName:'Collector'})).id,...(operator?{role:'admin'}:{})};
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
test('HTTP-backed worker mints reviewed shop stock through the actual stock provider and releases cancelled packs',async t=>{
  const x=await harness(t,{operator:true}),shop=await x.call('/shops',{body:{key:'admin-shop',name:'Pack shop',kind:'admin'}});
  const quote=await x.call('/allocations/stock/quote',{body:{shopId:shop.id,productId:'host',quantity:2}});
  assert.match(quote.allocationDigest,/^[a-f0-9]{64}$/);assert.equal(x.gateway.calls.length,0);
  const input={key:'reviewed-stock',shopId:shop.id,title:'Reviewed sealed packs',price:{currencyId:'credits',amount:20},items:{kind:'mint-pack',productId:'host',quantity:2},allocationDigest:quote.allocationDigest};
  const gate=x.gateway.pause(),pending=x.call('/listings',{body:input}),request=await gate.arrived.promise;
  assert.equal(request.protocol,stockAllocationStrategyProtocol);assert.equal(request.scope,'commerce-stock');assert.deepEqual(request.context.shop,{id:shop.id,ownerId:x.actor.userId});
  const walletStatus=await x.call('/allocations/status?productId=host'),stockStatus=await x.call('/allocations/stock/status?shopId='+shop.id+'&productId=host');
  assert.equal(walletStatus.attemptId,request.attemptId);assert.equal(stockStatus.attemptId,request.attemptId);assert.equal(stockStatus.command,'createListing');assert.equal(stockStatus.state,'prepared');privateFieldsAbsent(stockStatus,request.context.entropy.seed);
  const walletQuote=await x.call('/quote',{body:{productId:'host',quantity:2}}),blocked=await x.call('/purchase',{body:{...walletQuote,key:'competing-wallet'},status:409});assert.equal(blocked.code,'ALLOCATION_PENDING');assert.equal(x.gateway.calls.length,1);
  gate.release.resolve();x.gateway.hold=null;const listing=await pending;
  assert.deepEqual(await x.call('/listings',{body:input}),listing);assert.equal(x.gateway.calls.length,1);assert.equal((await x.call('/wallet')).credits,100);
  const packs=await x.call('/packs');assert.equal(packs.length,2);for(const pack of packs)assert.equal(pack.lockedBy,'market:'+listing.id);
  const locked=await x.call('/open',{body:{key:'open-listed-stock',packId:packs[0].id},status:409});assert.equal(locked.code,'PACK_LOCKED');
  const completed=await x.call('/allocations/stock/status?shopId='+shop.id+'&productId=host');assert.equal(completed.state,'completed');assert.equal(completed.command,'createListing');privateFieldsAbsent(completed,request.context.entropy.seed);privateFieldsAbsent(listing,request.context.entropy.seed);
  await x.call('/listings/cancel',{body:{key:'cancel-stock',listingId:listing.id}});for(const pack of await x.call('/packs'))assert(!pack.lockedBy);
  const opened=await x.call('/open',{body:{key:'open-cancelled-stock',packId:packs[0].id}});assert.equal(opened.cards.length,1);assert.equal(x.gateway.calls.length,1);assert.equal((await x.service.audit(admin)).ok,true);
});
test('paid worker fulfillment uses the actual external provider and abort records recoverable refund state',async t=>{
  const x=await harness(t,{paid:true}),provider={permissions:['currency.settle'],settlementProviderId:'test.payment'};
  const prepare=async transactionId=>{const quote=await x.service.quote(x.actor,{productId:'host',quantity:2});return x.service.prepareExternalPurchase(provider,{key:transactionId,providerId:'test.payment',transactionId,userId:x.actor.userId,externalCurrency:'points',externalUnits:String(quote.price.amount),quote});};
  const proof=(row,kind='debit')=>{
    const {providerId,transactionId,userId,externalCurrency,externalUnits}=row.terms;
    const value={kind,providerId,transactionId,userId,externalCurrency,externalUnits,fingerprint:row.fingerprint,reference:null};
    if(kind==='refund')Object.assign(value,{compensationId:row.compensationId,debitReference:row.debitReference});value.reference=kind+':'+externalPurchaseDigest(value);return value;
  };
  const prepared=await prepare('paid-fulfilled');assert.equal(prepared.state,'prepared');assert.equal(x.gateway.calls.length,0);
  const input={preparationId:prepared.preparationId,fingerprint:prepared.fingerprint,debitReceipt:proof(prepared)},fulfilled=await x.service.commitExternalPurchaseAsync(provider,input);
  assert.equal(fulfilled.state,'fulfilled');assert.equal(fulfilled.purchase.packs.length,2);assert.equal(x.gateway.calls.length,1);
  assert.equal(x.gateway.calls[0].protocol,externalAllocationStrategyProtocol);assert.equal(x.gateway.calls[0].context.preparationId,prepared.preparationId);
  for(const field of ['proof','debitReceipt','externalCurrency','externalUnits','credential'])assert(!JSON.stringify(x.gateway.calls[0]).includes('"'+field+'"'));
  assert.deepEqual(await x.service.commitExternalPurchaseAsync(provider,input),fulfilled);assert.equal(x.gateway.calls.length,1);assert.equal((await x.call('/packs')).length,2);assert.equal((await x.call('/wallet')).credits,100);
  const pending=await prepare('paid-aborted'),cancelInput={preparationId:pending.preparationId,fingerprint:pending.fingerprint,debitReceipt:proof(pending)},gate=x.gateway.pause(),controller=new AbortController();
  const settlement=x.service.commitExternalPurchaseAsync(provider,cancelInput,{signal:controller.signal}),request=await gate.arrived.promise;
  const waiting=await x.service.externalPurchaseStatus(x.actor,{preparationId:pending.preparationId});assert.equal(waiting.state,'allocation_pending');privateFieldsAbsent(waiting,request.context.entropy.seed);
  controller.abort();const failed=await settlement;assert.equal(failed.state,'refund_required');assert.equal(failed.failureCode,'POLICY_ABORTED');gate.release.resolve();x.gateway.hold=null;
  const status=await x.service.lookupExternalPurchase(provider,{providerId:'test.payment',transactionId:'paid-aborted'});assert.deepEqual(status,failed);privateFieldsAbsent(status,request.context.entropy.seed);
  assert.deepEqual(await x.service.commitExternalPurchaseAsync(provider,cancelInput),failed);assert.equal(x.gateway.calls.length,2);assert.equal((await x.call('/packs')).length,2);assert.equal((await x.call('/wallet')).credits,100);
  const compensated=await x.service.confirmExternalCompensation(provider,{preparationId:pending.preparationId,fingerprint:pending.fingerprint,refundReceipt:proof(failed,'refund')});assert.equal(compensated.state,'compensated');
  assert.deepEqual((await x.service.pendingExternalPurchases(provider,{providerId:'test.payment'})).items,[]);const audit=await x.service.audit(admin);assert.equal(audit.ok,true,JSON.stringify(audit));
});
test('v2 HTTP-backed worker applies personal eligibility while stock ignores owner inventory and pity',async t=>{
  const x=await harness(t,{operator:true,v2:true});
  await x.service.administerCards(admin,{key:'owned-before-review',expectedRevision:0,reason:'Fixture owned card',userId:x.actor.userId,action:'give',variantId:'dawn.standard'});
  const quote=await x.call('/quote',{body:{productId:'host',quantity:1}}),input={...quote,key:'v2-personalized'},receipt=await x.call('/purchase',{body:input});
  assert.equal(receipt.packs.length,1);assert.equal(x.gateway.calls.length,1);
  const personal=x.gateway.calls[0];assert.equal(personal.protocol,allocationStrategyV2Protocol);assert.equal(personal.context.mode,'personalized');assert.deepEqual(personal.context.ownedCards,[{cardId:'dawn',owned:true},{cardId:'aurora',owned:false}]);assert.equal(personal.context.pityCount,0);assert.equal(personal.context.product.pity.minimumRank,1);
  const opened=await x.call('/open',{body:{key:'open-v2-personalized',packId:receipt.packs[0].id}});assert.equal(opened.cards[0].variantId,'aurora.holo');
  assert.deepEqual(await x.call('/purchase',{body:input}),receipt);assert.equal(x.gateway.calls.length,1);assert.equal((await x.call('/wallet')).credits,90);
  const pityBefore=await x.call('/pity');assert.equal(pityBefore.host,0);
  const shop=await x.call('/shops',{body:{key:'v2-shop',name:'V2 stock shop',kind:'admin'}}),stockQuote=await x.call('/allocations/stock/quote',{body:{shopId:shop.id,productId:'host',quantity:1}});
  const listingInput={key:'v2-stock',shopId:shop.id,title:'V2 sealed stock',price:{currencyId:'credits',amount:20},items:{kind:'mint-pack',productId:'host',quantity:1},allocationDigest:stockQuote.allocationDigest},listing=await x.call('/listings',{body:listingInput});
  assert.equal(x.gateway.calls.length,2);const stock=x.gateway.calls[1];assert.equal(stock.protocol,stockAllocationStrategyV2Protocol);assert.equal(stock.context.mode,'stock');assert.deepEqual(stock.context.ownedCards,[]);assert.equal(stock.context.pityCount,0);assert.deepEqual(stock.context.product.pity,personal.context.product.pity);
  assert.deepEqual(await x.call('/pity'),pityBefore);assert.equal((await x.call('/wallet')).credits,90);assert.deepEqual(await x.call('/listings',{body:listingInput}),listing);assert.equal(x.gateway.calls.length,2);
  const stockPack=(await x.call('/packs')).find(pack=>pack.lockedBy==='market:'+listing.id);assert(stockPack);privateFieldsAbsent(listing,stock.context.entropy.seed);
  const audit=await x.service.audit(admin);assert.equal(audit.ok,true,JSON.stringify(audit));
});
