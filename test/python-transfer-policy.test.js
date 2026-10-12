import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createRemoteTransferPolicy,transferPolicyProtocol,validateTransferPolicyRequest,validateTransferPolicyResponse} from '../src/remote-transfer-policy.js';
import {createRemoteTradePolicy,tradePolicyProtocol,validateTradePolicyRequest,validateTradePolicyResponse} from '../src/remote-trade-policy.js';

const python=process.env.PYTHON??(process.platform==='win32'?'C:/Program Files/Python314/python.exe':'python3');
const example=fileURLToPath(new URL('../examples/plugins/python-transfer-policy.py',import.meta.url));
const token='synthetic-transfer-python-credential',providerId='example.transfer';
const copyId=randomUUID(),headers={'content-type':'application/json',authorization:'Bearer '+token};
const records={actors:[{id:'alice',recipientIds:['bob'],allowListingReservation:true},{id:'bob',recipientIds:['alice'],allowListingReservation:false}]};
const identity=()=>({providerId,requestId:randomUUID(),grantId:randomUUID(),generation:1,commandId:'a'.repeat(64),inputDigest:'b'.repeat(64),snapshotDigest:'c'.repeat(64),deadline:Date.now()+30000});
const transfer=()=>({...identity(),protocol:transferPolicyProtocol,operation:'canTransfer',scope:'transfer',phase:'review',context:{channel:'trade',legs:[{fromUserId:'alice',toUserId:'bob',copyIds:[copyId],versions:[1]}]}});
const trade=()=>({...identity(),protocol:tradePolicyProtocol,operation:'canTrade',scope:'exchange',phase:'review',context:{channel:'trade',fromUserId:'alice',toUserId:'bob',give:{copyIds:[],currencies:[{currencyId:'credits',amount:15}]},receive:{copyIds:[],currencies:[]}}});
const echo=request=>Object.fromEntries(Object.entries(request).filter(([key])=>key!=='context'));

async function withPython(config,run,env={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'dc-transfer-policy-'));let child;
  try{
    const filename=path.join(directory,'records.json');await writeFile(filename,typeof config==='string'||Buffer.isBuffer(config)?config:JSON.stringify(config));
    child=spawn(python,[example,filename],{env:{...process.env,TRANSFER_POLICY_PROVIDER_ID:providerId,TRANSFER_POLICY_TOKEN:token,...env},stdio:['ignore','pipe','pipe']});
    const port=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('Python policy startup timed out')),10000);
      const done=(fn,value)=>{clearTimeout(timer);fn(value);};
      child.once('error',error=>done(reject,error));child.once('exit',()=>done(reject,Error('Python policy exited before readiness')));child.stderr.resume();
      child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('\n')){const value=Number(output.trim());if(Number.isSafeInteger(value)&&value>0&&value<=65535)done(resolve,value);else done(reject,Error('Invalid Python policy readiness'));}});
    });
    await run('http://127.0.0.1:'+port+'/transfer-policy',filename);
  }finally{
    if(child?.pid&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
    await rm(directory,{recursive:true,force:true});
  }
}
async function post(url,request,status=200){
  const response=await fetch(url,{method:'POST',headers,body:typeof request==='string'||Buffer.isBuffer(request)?request:JSON.stringify(request)});
  assert.equal(response.status,status);assert.ok(Number(response.headers.get('content-length'))<=8192);return response.json();
}

test('independent Python transfer and currency-only trade policies allow configured routes and deny other actors or recipients through Node transports',async()=>{
  await withPython(records,async(url,filename)=>{
    const original=await readFile(filename);
    for(const [factory,make,validate] of [[createRemoteTransferPolicy,transfer,validateTransferPolicyResponse],[createRemoteTradePolicy,trade,validateTradePolicyResponse]]){
      const remote=factory({scope:make().scope,providerId,url,token,allowLoopbackHttp:true});
      try{
        const request={...make(),...remote.grant()},snapshot=structuredClone(request);
        const result=await remote.evaluate(request);validate(result);assert.deepEqual(result,{...echo(request),status:'allowed'});assert.deepEqual(request,snapshot);
        for(const key of ['fromUserId','toUserId']){
          const denied=structuredClone(request);(denied.context.legs?.[0]??denied.context)[key]='unconfigured';
          assert.deepEqual(await remote.evaluate(denied),{...echo(denied),status:'denied',reasonCode:'restricted'});
        }
        if(request.operation==='canTransfer'){
          const reservation=structuredClone(request);reservation.phase='list';reservation.context.channel='sale';reservation.context.legs[0].toUserId=null;
          assert.deepEqual(await remote.evaluate(reservation),{...echo(reservation),status:'allowed'});
          reservation.context.legs[0].fromUserId='bob';assert.deepEqual(await remote.evaluate(reservation),{...echo(reservation),status:'denied',reasonCode:'restricted'});
          const twoLegs=structuredClone(request);twoLegs.context.legs.push({fromUserId:'bob',toUserId:'alice',copyIds:[randomUUID()],versions:[2]});
          assert.equal((await remote.evaluate(twoLegs)).status,'allowed');twoLegs.context.legs[1].toUserId='unconfigured';assert.equal((await remote.evaluate(twoLegs)).status,'denied');
        }else{
          const sale=structuredClone(request);sale.phase='purchase';sale.context.channel='sale';sale.context.expiresInSeconds=604800;
          assert.equal((await remote.evaluate(sale)).status,'allowed');
          sale.context.give.currencies[0].amount=0;
          assert.deepEqual(await remote.evaluate(sale),{...echo(sale),status:'allowed'});
        }
      }finally{remote.close();}
    }
    assert.deepEqual(await readFile(filename),original);
  });
});

test('Python policies enforce 2000 combined copies and transfer version and cross-leg uniqueness constraints',async()=>{
  await withPython(records,async url=>{
    const copies=Array.from({length:2001},()=>randomUUID());
    const request=transfer();request.context.legs=[{fromUserId:'alice',toUserId:'bob',copyIds:copies.slice(0,1000),versions:Array(1000).fill(1)},{fromUserId:'bob',toUserId:'alice',copyIds:copies.slice(1000,2000),versions:Array(1000).fill(2)}];
    validateTransferPolicyRequest(request);assert.deepEqual(await post(url,request),{...echo(request),status:'allowed'});
    const over=structuredClone(request);over.context.legs[1].copyIds.push(copies[2000]);over.context.legs[1].versions.push(1);
    assert.throws(()=>validateTransferPolicyRequest(over));assert.deepEqual(await post(url,over,400),{});
    const repeated=structuredClone(request);repeated.context.legs[1].copyIds[0]=copies[0];assert.throws(()=>validateTransferPolicyRequest(repeated));assert.deepEqual(await post(url,repeated,400),{});
    const mismatch=structuredClone(request);mismatch.context.legs[1].versions.pop();assert.deepEqual(await post(url,mismatch,400),{});
    const exchange=trade();exchange.context.give.copyIds=copies.slice(0,1000);exchange.context.receive.copyIds=copies.slice(1000,2000);
    validateTradePolicyRequest(exchange);assert.deepEqual(await post(url,exchange),{...echo(exchange),status:'allowed'});
    exchange.context.receive.copyIds.push(copies[2000]);assert.throws(()=>validateTradePolicyRequest(exchange));assert.deepEqual(await post(url,exchange,400),{});
  });
});

test('Python endpoint authenticates both protocols and rejects malformed identity, nested context, encodings and authority',async()=>{
  await withPython(records,async url=>{
    for(const make of [transfer,trade])for(const auth of [undefined,'Bearer incorrect-synthetic-credential']){
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:auth}:{})},body:JSON.stringify(make())});assert.equal(response.status,401);assert.deepEqual(await response.json(),{});
    }
    const values=[null,[],{}];
    for(const make of [transfer,trade]){
      const base=make();
      for(const change of [{providerId:'other.policy'},{protocol:'digital-card-transfer-policy@2'},{operation:'pay'},{scope:'listing'},{phase:'settle'},{requestId:'invalid'},{grantId:base.grantId+'\n'},{generation:true},{generation:0},{generation:9007199254740992},{deadline:-1},{commandId:'z'.repeat(64)},{inputDigest:'a'.repeat(65)},{snapshotDigest:'a'.repeat(64)+'\n'},{approved:true},{wallet:{credits:1000}},{context:null}])values.push({...base,...change});
      const mutate=fn=>{const value=structuredClone(base);fn(value.context);values.push(value);};
      mutate(c=>{c.channel='unknown';});mutate(c=>{c.allocate=true;});
      for(const key of ['fromUserId','toUserId'])for(const invalid of ['constructor','\ud800','bad id'])mutate(c=>{(c.legs?.[0]??c)[key]=invalid;});
      if(base.operation==='canTransfer'){
        mutate(c=>{c.legs=[];});mutate(c=>{c.legs=Array(3).fill(c.legs[0]);});
        for(const patch of [{versions:[true]},{versions:[0]},{versions:[9007199254740992]},{versions:[]},{copyIds:[]},{copyIds:['invalid']},{copyIds:[copyId,copyId],versions:[1,1]},{pay:true},{toUserId:{id:'bob'}}])mutate(c=>{Object.assign(c.legs[0],patch);});
      }else{
        mutate(c=>{c.toUserId=null;});mutate(c=>{delete c.receive;});
        for(const expires of [0,604801,true])mutate(c=>{c.expiresInSeconds=expires;});
        for(const patch of [{copyIds:['invalid']},{copyIds:[copyId,copyId]},{currencies:Array(101).fill({currencyId:'credits',amount:1})},{currencies:[{currencyId:'prototype',amount:1}]},{currencies:[{currencyId:'credits',amount:-1}]},{currencies:[{currencyId:'credits',amount:true}]},{currencies:[{currencyId:'credits',amount:1,settled:true}]},{allocated:true}])mutate(c=>{Object.assign(c.give,patch);});
      }
    }
    const bodies=[...values.map(value=>JSON.stringify(value)),'{','{"context":{},"cont\\u0065xt":{}}',JSON.stringify(trade()).replace('"amount":15','"amount":NaN'),'x'.repeat(262145),Buffer.from([0xff,0xfe])];
    for(const body of bodies)assert.deepEqual(await post(url,body,400),{});
    for(const spelling of ['15.0','15e0','1.5e1'])assert.equal((await post(url,JSON.stringify(trade()).replace('"amount":15','"amount":'+spelling))).status,'allowed');
    for(const spelling of ['15.1','9007199254740991.1','1e999999999'])assert.deepEqual(await post(url,JSON.stringify(trade()).replace('"amount":15','"amount":'+spelling),400),{});
    assert.equal((await post(url,JSON.stringify(transfer()).replace('"generation":1','"generation":1.0'))).generation,1);
    for(const options of [{url:url+'?unsupported=1',headers},{url,headers:{...headers,'content-type':'text/plain'}}]){
      const response=await fetch(options.url,{method:'POST',headers:options.headers,body:JSON.stringify(transfer())});assert.equal(response.status,400);assert.deepEqual(await response.json(),{});
    }
    assert.equal((await post(url,transfer())).status,'allowed');
  });
});

test('Python fixture refuses ambiguous, unbounded or authoritative startup configuration',async()=>{
  const actor=records.actors[0];
  const variants=[{actors:[actor,actor]},{actors:[{...actor,id:'__proto__'}]},{actors:[{...actor,id:'\ud800'}]},{actors:[{...actor,recipientIds:['bob','bob']}]},{actors:[{...actor,recipientIds:['prototype']}]},{actors:[{...actor,recipientIds:Array(101).fill('bob')}]},{actors:[{...actor,allowListingReservation:1}]},{actors:[{...actor,allocate:true}]},{actors:Array(101).fill(actor)},{...records,payments:[]},'{"actors":[],"act\\u006frs":[]}','x'.repeat(65537),Buffer.from([0xff])];
  for(const config of variants)await assert.rejects(withPython(config,()=>assert.fail('Invalid records admitted')),/Python policy exited before readiness/);
  for(const env of [{TRANSFER_POLICY_PROVIDER_ID:'constructor'},{TRANSFER_POLICY_TOKEN:'short'},{TRANSFER_POLICY_TOKEN:'invalid credential with spaces'}])await assert.rejects(withPython(records,()=>assert.fail('Invalid environment admitted'),env),/Python policy exited before readiness/);
  await withPython({actors:[]},async url=>{for(const make of [transfer,trade]){const request=make();assert.deepEqual(await post(url,request),{...echo(request),status:'denied',reasonCode:'restricted'});}});
});
