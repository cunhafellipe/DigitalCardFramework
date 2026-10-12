import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApiHandler} from '../src/http.js';
import {validateWireRequest,validateWireResponse,WireContractError} from '../src/wire-contracts.js';
const batchId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const status={batchId,state:'pending',counts:{total:2,pending:2,issued:0,attached:0,cancelled:0},errorCode:null};
test('issuance wire contracts reject extra material and invalid recovery identities',()=>{
  validateWireRequest('recoverCodeIssuance',{batchId});
  validateWireResponse('codeIssuanceStatus',200,status);
  for(const input of [{},{batchId:'invalid'},{batchId,code:'secret'}])assert.throws(()=>validateWireRequest('recoverCodeIssuance',input),WireContractError);
  for(const value of [{...status,code:'secret'},{...status,counts:{...status.counts,total:1001}},{...status,errorCode:'upstream private text'}])assert.throws(()=>validateWireResponse('codeIssuanceStatus',200,value),WireContractError);
});
test('issuance operator routes enforce exposure, authority and origin and forward cancellation',async t=>{
  let actor={userId:'operator',permissions:['codes.manage']},expose=true,reads=0,recoveries=0,signal;
  const framework={codeIssuanceStatus(principal,input){assert.equal(principal,actor);assert.deepEqual(input,{batchId});reads++;return status;},async recoverCodeIssuance(principal,input,options){assert.equal(principal,actor);assert.deepEqual(input,{batchId});signal=options.signal;recoveries++;return status;}};
  let origin;const server=createServer((req,res)=>createApiHandler({framework,resolveIdentity:()=>actor,exposeOperators:expose,allowedOrigin:origin})(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const read=()=>fetch(origin+'/api/operator/code-issuance/status?batchId='+batchId);
  const recover=(requestOrigin=origin)=>fetch(origin+'/api/operator/code-issuance/recover',{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json'},body:JSON.stringify({batchId})});
  assert.deepEqual(await (await read()).json(),status);assert.equal(reads,1);assert.equal(recoveries,0);
  const response=await recover();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),status);assert.ok(signal instanceof AbortSignal);assert.equal(signal.aborted,false);
  assert.equal((await recover('https://invalid.example')).status,403);
  actor={userId:'collector',permissions:[]};assert.equal((await read()).status,403);assert.equal((await recover()).status,403);
  actor={userId:'operator',permissions:['codes.manage']};expose=false;assert.equal((await read()).status,403);assert.equal((await recover()).status,403);
  assert.equal(reads,1);assert.equal(recoveries,1);
});

test('disconnect aborts operator issuance recovery without starting another operation',async t=>{
  let enter,finish,calls=0;const entered=new Promise(resolve=>{enter=resolve;}),aborted=new Promise(resolve=>{finish=resolve;});
  const framework={async recoverCodeIssuance(actor,input,{signal}){calls++;enter();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));finish();return status;}};
  let origin;const server=createServer((req,res)=>createApiHandler({framework,resolveIdentity:()=>({userId:'operator',permissions:['codes.manage']}),exposeOperators:true,allowedOrigin:origin})(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const controller=new AbortController(),request=fetch(origin+'/api/operator/code-issuance/recover',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({batchId}),signal:controller.signal});
  await entered;controller.abort();await assert.rejects(request,{name:'AbortError'});
  let timer;try{await Promise.race([aborted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Recovery cancellation was not forwarded')),3000);})]);}finally{clearTimeout(timer);}
  assert.equal(calls,1);
});

test('allocation status discovery accepts an optional issuance batch without exposing material',()=>{
 const base={productId:'product',attemptId:batchId,state:'prepared',errorCode:null};
 for(const value of [base,{...base,codeIssuanceBatchId:batchId}])validateWireResponse('allocationStatus',200,value);
 validateWireResponse('stockAllocationStatus',200,{...base,codeIssuanceBatchId:batchId,shopId:batchId,command:'createListing',attemptShopId:batchId});
 for(const value of [{...base,codeIssuanceBatchId:'invalid'},{...base,codeIssuanceBatchId:batchId,custody:'secret'}])assert.throws(()=>validateWireResponse('allocationStatus',200,value),WireContractError);
});
