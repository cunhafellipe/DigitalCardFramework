import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {request as httpRequest} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createRemoteTransferPolicy,transferPolicyProtocol,validateTransferPolicyResponse} from '../src/remote-transfer-policy.js';
import {createRemoteTradePolicy,tradePolicyProtocol,validateTradePolicyResponse} from '../src/remote-trade-policy.js';

const executable=process.argv[2];
if(!executable)throw Error('Usage: node test/go-transfer-policy-conformance.mjs GO_TRANSFER_POLICY');
const token='synthetic-transfer-conformance-credential',providerId='example.transfer';
const records={actors:[{id:'alice',recipientIds:['bob'],allowListingReservation:true},{id:'bob',recipientIds:['alice'],allowListingReservation:false}]};
const identity=()=>({providerId,requestId:randomUUID(),grantId:randomUUID(),generation:1,commandId:'a'.repeat(64),inputDigest:'b'.repeat(64),snapshotDigest:'c'.repeat(64),deadline:Date.now()+30000});
const transfer=()=>({...identity(),protocol:transferPolicyProtocol,operation:'canTransfer',scope:'transfer',phase:'review',context:{channel:'trade',legs:[{fromUserId:'alice',toUserId:'bob',copyIds:[randomUUID()],versions:[1]}]}});
const trade=()=>({...identity(),protocol:tradePolicyProtocol,operation:'canTrade',scope:'exchange',phase:'review',context:{channel:'trade',fromUserId:'alice',toUserId:'bob',give:{copyIds:[],currencies:[{currencyId:'credits',amount:0}]},receive:{copyIds:[],currencies:[]}}});
const echo=request=>Object.fromEntries(Object.entries(request).filter(([key])=>key!=='context'));
const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'dc-go-transfer-'));
const processes=new Set();let assertions=0,sequence=0;
async function start(config=records,environment={}){
  const filename=join(directory,`records-${sequence++}.json`);
  await writeFile(filename,typeof config==='string'||Buffer.isBuffer(config)?config:JSON.stringify(config));
  const child=spawn(executable,[filename],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,TRANSFER_POLICY_TOKEN:token,TRANSFER_POLICY_PROVIDER_ID:providerId,...environment}});
  processes.add(child);let errors='';child.stderr.on('data',data=>{errors=(errors+data).slice(-4096);});
  const port=await new Promise((fulfill,reject)=>{
    let output='',settled=false;
    const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value);};
    const timer=setTimeout(()=>finish(reject,Error('Policy readiness timed out')),10000);
    child.once('error',error=>finish(reject,error));child.once('exit',()=>finish(reject,Error('Policy exited before readiness: '+errors)));
    child.stdout.on('data',data=>{output+=data;if(output.length>4096)finish(reject,Error('Invalid policy readiness'));else if(output.includes('\n')){const port=Number(output.trim());if(Number.isInteger(port)&&port>0&&port<=65535)finish(fulfill,port);else finish(reject,Error('Invalid policy readiness'));}});
  });
  assertions++;return {child,filename,url:`http://127.0.0.1:${port}/transfer-policy`};
}
async function stop(receiver){
  const child=receiver.child;if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}processes.delete(child);
}
async function post(receiver,value,status=200,options={}){
  const body=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value));
  let headers=options.headers??{'content-type':'application/json',authorization:'Bearer '+token,'content-length':String(body.length)};
  if(Array.isArray(headers))headers=['Host',new URL(options.url??receiver.url).host,...headers];
  const result=await new Promise((fulfill,reject)=>{
    const request=httpRequest(options.url??receiver.url,{method:'POST',headers,signal:AbortSignal.timeout(10000)},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);response.on('end',()=>fulfill({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));
    });request.on('error',reject);request.end(body);
  });
  assert.equal(result.status,status);assert.ok(result.body.length<=8192);assert.equal(result.headers['cache-control'],'no-store');assertions+=3;
  const parsed=JSON.parse(result.body);if(status===200){(parsed.operation==='canTransfer'?validateTransferPolicyResponse:validateTradePolicyResponse)(parsed);assertions++;}else{assert.deepEqual(parsed,{});assertions++;}
  return parsed;
}
const expected=(request,allowed=true)=>({...echo(request),status:allowed?'allowed':'denied',...(!allowed?{reasonCode:'restricted'}:{})});
try{
  const receiver=await start(),original=await readFile(receiver.filename);
  for(const [factory,make,validate] of [[createRemoteTransferPolicy,transfer,validateTransferPolicyResponse],[createRemoteTradePolicy,trade,validateTradePolicyResponse]]){
    const remote=factory({scope:make().scope,providerId,url:receiver.url,token,allowLoopbackHttp:true});
    try{
      const request={...make(),...remote.grant()},snapshot=structuredClone(request);
      const result=await remote.evaluate(request);validate(result);assert.deepEqual(result,expected(request));assert.deepEqual(request,snapshot);assertions+=2;
      for(const key of ['fromUserId','toUserId']){
        const denied=structuredClone(request);(denied.context.legs?.[0]??denied.context)[key]='unconfigured';assert.deepEqual(await remote.evaluate(denied),expected(denied,false));assertions++;
      }
      if(request.operation==='canTransfer'){
        const reservation=structuredClone(request);reservation.phase='list';reservation.context.channel='sale';reservation.context.legs[0].toUserId=null;
        assert.deepEqual(await remote.evaluate(reservation),expected(reservation));reservation.context.legs[0].fromUserId='bob';assert.deepEqual(await remote.evaluate(reservation),expected(reservation,false));assertions+=2;
        const both=structuredClone(request);both.context.legs.push({fromUserId:'bob',toUserId:'alice',copyIds:[randomUUID()],versions:[2]});
        assert.deepEqual(await remote.evaluate(both),expected(both));both.context.legs[1].toUserId='unconfigured';assert.deepEqual(await remote.evaluate(both),expected(both,false));assertions+=2;
      }else{
        const sale=structuredClone(request);sale.phase='purchase';sale.context.channel='sale';sale.context.expiresInSeconds=604800;
        assert.deepEqual(await remote.evaluate(sale),expected(sale));sale.context.give.currencies[0].amount=Number.MAX_SAFE_INTEGER;assert.deepEqual(await remote.evaluate(sale),expected(sale));assertions+=2;
      }
    }finally{remote.close();}
  }
  for(const make of [transfer,trade]){
    const request=make();
    for(const patch of [{providerId:'other.policy'},{protocol:'digital-card-transfer-policy@2'},{operation:'pay'},{scope:'listing'},{phase:'settle'},{requestId:'invalid'},{grantId:request.grantId+'\n'},{generation:true},{generation:0},{generation:9007199254740992},{deadline:-1},{commandId:'z'.repeat(64)},{inputDigest:'a'.repeat(65)},{snapshotDigest:'a'.repeat(64)+'\n'},{allocated:true},{context:null}])await post(receiver,{...request,...patch},400);
    for(const key of Object.keys(request)){const missing={...request};delete missing[key];await post(receiver,missing,400);}
    for(const auth of ['', 'Bearer revoked-fixture-credential'])await post(receiver,request,401,{headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(JSON.stringify(request))),...(auth?{authorization:auth}:{})}});
    for(const numeric of ['1.0','1e0','1'+'0'.repeat(1000)+'e-1000']){assert.deepEqual(await post(receiver,JSON.stringify(request).replace('"generation":1','"generation":'+numeric)),expected(request));assertions++;}
    for(const numeric of ['1.1','9007199254740991.1','9007199254740993','1e400','1e-1000000000'])await post(receiver,JSON.stringify(request).replace('"generation":1','"generation":'+numeric),400);
    await post(receiver,'{"providerId":"example.transfer",'+JSON.stringify(request).slice(1),400);
    await post(receiver,JSON.stringify(request).replace('"context":','"cont\\u0065xt":{},"context":'),400);
    for(const patch of [{channel:'unknown'},{allocate:true}])await post(receiver,{...request,context:{...request.context,...patch}},400);
    for(const key of ['fromUserId','toUserId'])for(const invalid of ['constructor','prototype','__proto__','bad id','\ud800']){
      const value=structuredClone(request);(value.context.legs?.[0]??value.context)[key]=invalid;await post(receiver,value,400);
    }
  }
  const request=transfer();
  for(const patch of [{versions:[true]},{versions:[0]},{versions:[]},{versions:[Number.MAX_SAFE_INTEGER+1]},{copyIds:[]},{copyIds:['invalid']},{copyIds:[request.context.legs[0].copyIds[0],request.context.legs[0].copyIds[0]],versions:[1,1]},{toUserId:{}},{allocated:true}]){
    const value=structuredClone(request);Object.assign(value.context.legs[0],patch);await post(receiver,value,400);
  }
  for(const legs of [[],Array(3).fill(request.context.legs[0])])await post(receiver,{...request,context:{...request.context,legs}},400);
  const exchange=trade();
  for(const patch of [{copyIds:['invalid']},{copyIds:[request.context.legs[0].copyIds[0],request.context.legs[0].copyIds[0]]},{currencies:Array(101).fill({currencyId:'credits',amount:1})},{currencies:[{currencyId:'prototype',amount:1}]},{currencies:[{currencyId:'credits',amount:-1}]},{currencies:[{currencyId:'credits',amount:true}]},{currencies:[{currencyId:'credits',amount:1,settled:true}]},{allocated:true}])await post(receiver,{...exchange,context:{...exchange.context,give:{...exchange.context.give,...patch}}},400);
  for(const expires of [0,604801,true])await post(receiver,{...exchange,context:{...exchange.context,expiresInSeconds:expires}},400);
  await post(receiver,{...exchange,context:{...exchange.context,toUserId:null}},400);
  for(const numeric of ['0.0','0e0','0e999999999','-0','-0e999999999','15.0','15e0','1.5e1','9007199254740991.0']){assert.deepEqual(await post(receiver,JSON.stringify(exchange).replace('"amount":0','"amount":'+numeric)),expected(exchange));assertions++;}
  for(const numeric of ['0.1','15.1','9007199254740991.1','9007199254740993','NaN','-1','1e999999999'])await post(receiver,JSON.stringify(exchange).replace('"amount":0','"amount":'+numeric),400);
  const copies=Array.from({length:2001},()=>randomUUID());
  request.context.legs=[{fromUserId:'alice',toUserId:'bob',copyIds:copies.slice(0,1000),versions:Array(1000).fill(1)},{fromUserId:'bob',toUserId:'alice',copyIds:copies.slice(1000,2000),versions:Array(1000).fill(2)}];
  assert.deepEqual(await post(receiver,request),expected(request));assertions++;
  const over=structuredClone(request);over.context.legs[1].copyIds.push(copies[2000]);over.context.legs[1].versions.push(1);await post(receiver,over,400);
  const repeated=structuredClone(request);repeated.context.legs[1].copyIds[0]=copies[0];await post(receiver,repeated,400);
  exchange.context.give.copyIds=copies.slice(0,1000);exchange.context.receive.copyIds=copies.slice(1000,2000);
  assert.deepEqual(await post(receiver,exchange),expected(exchange));assertions++;
  exchange.context.receive.copyIds.push(copies[2000]);await post(receiver,exchange,400);
  for(const body of ['{','null','[]','{}','{"context":{},"context":{}}','x'.repeat(262145),Buffer.from([0xff,0xfe]),JSON.stringify(transfer()).replace('"alice"','"\\ud800"'),JSON.stringify(transfer())+' {}'])await post(receiver,body,400);
  const encoded=JSON.stringify(transfer());
  await post(receiver,encoded,400,{url:receiver.url+'?unexpected=1'});
  await post(receiver,encoded,400,{headers:{'content-type':'text/plain',authorization:'Bearer '+token,'content-length':String(Buffer.byteLength(encoded))}});
  await post(receiver,encoded,400,{headers:{'content-type':'application/json',authorization:'Bearer '+token,'transfer-encoding':'chunked'}});
  await post(receiver,encoded,401,{headers:['Content-Type','application/json','Authorization','Bearer '+token,'Authorization','Bearer '+token,'Content-Length',String(Buffer.byteLength(encoded))]});
  await post(receiver,encoded,400,{headers:['Content-Type','application/json','Content-Type','application/json','Authorization','Bearer '+token,'Content-Length',String(Buffer.byteLength(encoded))]});
  assert.deepEqual(await readFile(receiver.filename),original);assertions++;
  await writeFile(receiver.filename,JSON.stringify({actors:[]}));
  const unchanged=transfer();assert.deepEqual(await post(receiver,unchanged),expected(unchanged));assertions++;
  await stop(receiver);
  const deny=await start({actors:[]});for(const make of [transfer,trade]){const request=make();assert.deepEqual(await post(deny,request),expected(request,false));assertions++;}await stop(deny);
  const actor=records.actors[0];
  for(const config of [{actors:[actor,actor]},{actors:[{...actor,id:'__proto__'}]},{actors:[{...actor,id:'\ud800'}]},{actors:[{...actor,recipientIds:['bob','bob']}]},{actors:[{...actor,recipientIds:['prototype']}]},{actors:[{...actor,recipientIds:Array(101).fill('bob')}]},{actors:[{...actor,allowListingReservation:1}]},{actors:[{...actor,allocate:true}]},{actors:Array(101).fill(actor)},{...records,payments:[]},'{"actors":[],"act\\u006frs":[]}','x'.repeat(65537),Buffer.from([0xff])]){
    await assert.rejects(start(config),/Policy exited before readiness/);assertions++;
  }
  for(const environment of [{TRANSFER_POLICY_PROVIDER_ID:'constructor'},{TRANSFER_POLICY_TOKEN:'short'},{TRANSFER_POLICY_TOKEN:'invalid credential with spaces'}]){await assert.rejects(start(records,environment),/Policy exited before readiness/);assertions++;}
  console.log(JSON.stringify({provider:'go',assertions,status:'passed',scenarios:['Node transfer/trade transports','both transfer legs and null reservation','currency-only zero and exact integer limits','identity/authentication','malformed/unknown/duplicate JSON and UTF-8','combined 2000 copies','bounded requests and configuration','default deny and immutable records']},null,2));
}finally{
  for(const child of processes){if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}}
  if(!resolve(directory).startsWith(base+sep))throw Error('Unsafe conformance cleanup target');
  await rm(directory,{recursive:true,force:true});
}
