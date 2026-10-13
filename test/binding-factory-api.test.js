import Ajv2020 from 'ajv/dist/2020.js';
import {externalPurchaseSchema} from '../src/external-purchase-contracts.js';
import Ajv from 'ajv';
import {readModelDefinitions} from '../src/read-model-contracts.js';
import {fixture} from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApiHandler} from '../src/http.js';
import {validateWireRequest,validateWireResponse,WireContractError} from '../src/wire-contracts.js';
const batchId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const status={batchId,state:'pending',counts:{total:2,pending:2,ready:0,attached:0,cancelled:0,activationPending:0,activationFailed:0},errorCode:null};
test('factory wire contracts reject extra material and invalid recovery identities',()=>{
  validateWireRequest('recoverBindingFactories',{batchId});
  validateWireResponse('bindingFactoryStatus',200,status);
  for(const input of [{},{batchId:'invalid'},{batchId,code:'secret'}])assert.throws(()=>validateWireRequest('recoverBindingFactories',input),WireContractError);
  for(const value of [{...status,code:'secret'},{...status,counts:{...status.counts,total:1001}},{...status,errorCode:'upstream private text'}])assert.throws(()=>validateWireResponse('bindingFactoryStatus',200,value),WireContractError);
});
test('factory operator routes enforce exposure, authority and origin and forward cancellation',async t=>{
  let actor={userId:'operator',permissions:['bindings.manage']},expose=true,reads=0,recoveries=0,signal;
  const framework={bindingFactoryStatus(principal,input){assert.equal(principal,actor);assert.deepEqual(input,{batchId});reads++;return status;},async recoverBindingFactories(principal,input,options){assert.equal(principal,actor);assert.deepEqual(input,{batchId});signal=options.signal;recoveries++;return status;}};
  let origin;const server=createServer((req,res)=>createApiHandler({framework,resolveIdentity:()=>actor,exposeOperators:expose,allowedOrigin:origin})(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const read=()=>fetch(origin+'/api/operator/binding-factories/status?batchId='+batchId);
  const recover=(requestOrigin=origin)=>fetch(origin+'/api/operator/binding-factories/recover',{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json'},body:JSON.stringify({batchId})});
  assert.deepEqual(await (await read()).json(),status);assert.equal(reads,1);assert.equal(recoveries,0);
  const response=await recover();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),status);assert.ok(signal instanceof AbortSignal);assert.equal(signal.aborted,false);
  assert.equal((await recover('https://invalid.example')).status,403);
  actor={userId:'collector',permissions:['codes.manage']};assert.equal((await read()).status,403);assert.equal((await recover()).status,403);
  actor={userId:'operator',permissions:['bindings.manage']};expose=false;assert.equal((await read()).status,403);assert.equal((await recover()).status,403);
  assert.equal(reads,1);assert.equal(recoveries,1);
});

test('disconnect aborts operator factory recovery without starting another operation',async t=>{
  let enter,finish,calls=0;const entered=new Promise(resolve=>{enter=resolve;}),aborted=new Promise(resolve=>{finish=resolve;});
  const framework={async recoverBindingFactories(actor,input,{signal}){calls++;enter();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));finish();return status;}};
  let origin;const server=createServer((req,res)=>createApiHandler({framework,resolveIdentity:()=>({userId:'operator',permissions:['bindings.manage']}),exposeOperators:true,allowedOrigin:origin})(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const controller=new AbortController(),request=fetch(origin+'/api/operator/binding-factories/recover',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({batchId}),signal:controller.signal});
  await entered;controller.abort();await assert.rejects(request,{name:'AbortError'});
  let timer;try{await Promise.race([aborted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Recovery cancellation was not forwarded')),3000);})]);}finally{clearTimeout(timer);}
  assert.equal(calls,1);
});

test('allocation status discovery accepts an optional factory batch without exposing material',()=>{
 const base={productId:'product',attemptId:batchId,state:'prepared',errorCode:null};
 for(const value of [base,{...base,bindingFactoryBatchId:batchId}])validateWireResponse('allocationStatus',200,value);
 validateWireResponse('stockAllocationStatus',200,{...base,bindingFactoryBatchId:batchId,shopId:batchId,command:'createListing',attemptShopId:batchId});
 for(const value of [{...base,bindingFactoryBatchId:'invalid'},{...base,bindingFactoryBatchId:batchId,custody:'secret'}])assert.throws(()=>validateWireResponse('allocationStatus',200,value),WireContractError);
});

test('pending binding views forbid reward material while active bindings retain required data',()=>{
 const validate=new Ajv({strict:false,validateFormats:false}).compile(readModelDefinitions.CardBindingView);
 const base={visibility:'owner',transfer:'follow',holderId:batchId};
 for(const state of ['activation-pending','activation-failed']){assert(validate({...base,state}));assert(!validate({...base,state,data:{secret:'hidden'}}));}
 for(const state of ['active','used']){assert(validate({...base,state,data:{value:1}}));assert(!validate({...base,state}));}
});
test('wallet activation disclosure is bounded and survives reviewed purchase input',()=>{
 const x=fixture(),quote=x.core.quote(x.alice,{productId:'common'});try{
 validateWireResponse('quote',200,{...quote,bindingActivation:{maximum:2}});
 validateWireRequest('purchase',{...quote,key:'reviewed',bindingActivation:{maximum:2}});
 for(const maximum of [0,1001])assert.throws(()=>validateWireResponse('quote',200,{...quote,bindingActivation:{maximum}}),WireContractError);
 }finally{x.core.close();}
});

test('external payment quotes preserve bounded activation disclosure without breaking legacy quotes',()=>{
 const ajv=new Ajv2020({strict:false});ajv.addSchema(externalPurchaseSchema);
 const validate=ajv.compile({$ref:externalPurchaseSchema.$id+'#/$defs/ExternalPurchaseQuote'});
 const quote={productId:'product',quantity:1,productRevision:1,catalogVersion:1,adminRevision:0,price:{currencyId:'credits',amount:10}};
 assert(validate(quote));assert(validate({...quote,allocationDigest:'a'.repeat(64),bindingActivation:{maximum:2}}));
 for(const bindingActivation of [{maximum:0},{maximum:1001},{maximum:1,private:'hidden'},{}])assert(!validate({...quote,bindingActivation}));
});
