import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRemoteCurrencyProvider} from '../src/remote-currency-provider.js';
import {currencyProviderProtocol,validateCurrencyProviderResponse} from '../src/currency-provider-contracts.js';
import {createCurrencyGateway} from '../src/currency-gateway.js';
import {fixture,admin} from './helpers.js';

const python=process.env.PYTHON??(process.platform==='win32'?'C:/Program Files/Python314/python.exe':'python3');
const example=fileURLToPath(new URL('../examples/plugins/python-currency-provider.py',import.meta.url));
const token='synthetic-currency-python-credential';
const providerId='example.points';
const requestId='01234567-89ab-4cde-8f01-23456789abcd';
const headers={'content-type':'application/json',authorization:'Bearer '+token};
const lookup={protocol:currencyProviderProtocol,operation:'lookup',providerId,requestId,transactionId:'settled-fixture',account:'external:alice'};
const errorCode=expected=>error=>error.code===expected;
const recordsFor=x=>({
  accounts:[{userId:x.alice.userId,account:'external:alice'},{userId:x.bob.userId,account:'external:bob'}],
  transactions:[
    {transactionId:'settled-fixture',account:'external:alice',status:'settled',currency:'POINTS',amountUnits:'150'},
    {transactionId:'pending-fixture',account:'external:alice',status:'pending'},
    {transactionId:'refunded-fixture',account:'external:alice',status:'refunded'},
    {transactionId:'unknown-fixture',account:'external:alice',status:'unknown'},
  ],
});
function unchanged(x,credits=10000) {
  assert.equal(x.core.wallet(x.alice).credits,credits);assert.equal(x.core.wallet(x.bob).credits,10000);assert.equal(x.core.audit(admin).ok,true);
}
async function withPython(records,run) {
  const directory=await mkdtemp(path.join(tmpdir(),'dc-currency-provider-'));let child;
  try{
    const filename=path.join(directory,'records.json');const raw=typeof records==='string'?records:JSON.stringify(records);await writeFile(filename,raw);
    child=spawn(python,[example,filename],{env:{...process.env,CURRENCY_PROVIDER_ID:providerId,CURRENCY_PROVIDER_TOKEN:token},stdio:['ignore','pipe','pipe']});
    const port=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('Python provider startup timed out')),10000);
      const done=(fn,value)=>{clearTimeout(timer);fn(value);};
      child.once('error',error=>done(reject,error));child.once('exit',()=>done(reject,Error('Python provider exited before readiness')));
      child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('\n')){const value=Number(output.trim());if(Number.isSafeInteger(value)&&value>0&&value<=65535)done(resolve,value);else done(reject,Error('Invalid Python provider readiness'));}});
    });
    await run('http://127.0.0.1:'+port+'/currency-settlement',filename);
  }finally{
    if(child?.pid&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
    await rm(directory,{recursive:true,force:true});
  }
}

test('independent Python HTTP fixture binds users and transactions, rejects pending evidence and replays one settlement',async()=>{
  const x=fixture(),records=recordsFor(x);
  try{await withPython(records,async(url,filename)=>{
    const provider=createRemoteCurrencyProvider({providerId,url,token,allowLoopbackHttp:true,currencies:{POINTS:{currencyId:'credits',numerator:2,denominator:3}}});
    const gateway=createCurrencyGateway({framework:x.core,providers:{[providerId]:provider}});
    try{
      assert.equal(await provider.resolveAccount({userId:x.alice.userId}),'external:alice');
      assert.equal(await provider.resolveAccount({userId:x.bob.userId}),'external:bob');
      await assert.rejects(provider.resolveAccount({userId:'unmapped-user'}),errorCode('CURRENCY_PROVIDER_ERROR'));unchanged(x);
      for(const [transactionId,status] of [['pending-fixture','pending'],['refunded-fixture','refunded'],['unknown-fixture','unknown'],['missing-fixture','unknown']]){
        assert.deepEqual(await provider.lookup({transactionId,account:'external:alice'}),{transactionId,account:'external:alice',status});
        await assert.rejects(gateway.reconcile(x.alice,{providerId,transactionId}),errorCode('SETTLEMENT_PENDING'));unchanged(x);
      }
      await assert.rejects(gateway.reconcile(x.bob,{providerId,transactionId:lookup.transactionId}),errorCode('CURRENCY_PROVIDER_ERROR'));unchanged(x);
      await assert.rejects(provider.lookup({...lookup,account:'unmapped-account'}),errorCode('CURRENCY_PROVIDER_ERROR'));unchanged(x);
      const settled=await gateway.reconcile(x.alice,{providerId,transactionId:lookup.transactionId,amountUnits:'999999',userId:x.bob.userId});
      assert.equal(settled.amount,100);assert.deepEqual(await gateway.reconcile(x.alice,{providerId,transactionId:lookup.transactionId}),settled);unchanged(x,10100);
      assert.equal(x.core.history(x.alice).filter(row=>row.type==='external-credit').length,1);
      await assert.rejects(gateway.reconcile(x.bob,{providerId,transactionId:lookup.transactionId}),errorCode('CURRENCY_PROVIDER_ERROR'));unchanged(x,10100);
      assert.deepEqual(JSON.parse(await readFile(filename,'utf8')),records);
    }finally{provider.disable();}
  });}finally{x.core.close();}
});

test('Python endpoint authenticates requests and returns strictly bound unknown and wrong-owner replies',async()=>{
  const records={accounts:[{userId:'local-alice',account:'external:alice'},{userId:'local-bob',account:'external:bob'}],transactions:[{transactionId:lookup.transactionId,account:lookup.account,status:'settled',currency:'POINTS',amountUnits:'150'}]};
  await withPython(records,async url=>{
    for(const auth of [undefined,'Bearer incorrect-synthetic-credential']){
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:auth}:{})},body:JSON.stringify(lookup)});
      assert.equal(response.status,401);assert.deepEqual(await response.json(),{});
    }
    for(const request of [{...lookup,account:'external:bob'},{...lookup,account:'unmapped-account'},{protocol:currencyProviderProtocol,operation:'resolve-account',providerId,requestId,userId:'unmapped-user'}]){
      const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(request)});assert.equal(response.status,404);
      const value=await response.json();validateCurrencyProviderResponse(value);assert.deepEqual(value,{...request,status:'error',errorCode:'not-found'});
    }
    const request={...lookup,transactionId:'absent'};
    const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(request)});assert.equal(response.status,200);
    const value=await response.json();validateCurrencyProviderResponse(value);assert.deepEqual(value,{...request,status:'unknown'});
  });
});

test('Python request boundary rejects malformed identity, duplicate keys, amounts and oversized input',async()=>{
  await withPython({accounts:[{userId:'local-alice',account:'external:alice'}],transactions:[]},async url=>{
    const resolution={protocol:currencyProviderProtocol,operation:'resolve-account',providerId,requestId,userId:'local-alice'};
    const values=[null,[],{}, {...lookup,operation:'settle'},{...lookup,providerId:'other.provider'},{...lookup,protocol:'digital-card-currency-settlement@2'}, {...lookup,requestId:requestId+'\n'}, {...lookup,requestId:'invalid'}, {...lookup,amountUnits:'150'}, {...lookup,status:'settled'}, {...lookup,account:'x'.repeat(301)}, {...lookup,account:'\ud800'}, {...lookup,transactionId:'x\n'}, {...resolution,userId:'x'.repeat(101)}, {...resolution,userId:'\ud800'}, {...resolution,currencies:{POINTS:{currencyId:'credits'}}}];
    const bodies=[...values.map(value=>JSON.stringify(value)),'{','{"operation":"lookup","oper\\u0061tion":"resolve-account"}',JSON.stringify(lookup).replace('"external:alice"','NaN'),'x'.repeat(8193),Buffer.from([0xff,0xfe])];
    for(const body of bodies){const response=await fetch(url,{method:'POST',headers,body});assert.equal(response.status,400);assert.deepEqual(await response.json(),{});}
    for(const options of [{url:url+'?unsupported=1',headers},{url,headers:{...headers,'content-type':'text/plain'}}]){
      const response=await fetch(options.url,{method:'POST',headers:options.headers,body:JSON.stringify(lookup)});assert.equal(response.status,400);assert.deepEqual(await response.json(),{});
    }
  });
});

test('Python fixture refuses ambiguous, unbounded and untrusted record data at startup',async()=>{
  const account={userId:'local-alice',account:'external:alice'},transaction={transactionId:lookup.transactionId,account:lookup.account,status:'settled',currency:'POINTS',amountUnits:'150'};
  const base={accounts:[account],transactions:[transaction]};
  const variants=[
    {...base,accounts:[account,account]},
    {...base,accounts:[account,{userId:'local-bob',account:account.account}]},
    {...base,transactions:[transaction,transaction]},
    {...base,transactions:[{...transaction,account:'unmapped-account'}]},
    {...base,transactions:[{...transaction,amountUnits:150}]},
    {...base,transactions:[{...transaction,amountUnits:'150\n'}]},
    {...base,transactions:[{...transaction,currency:'POINTS\n'}]},
    {...base,transactions:[{...transaction,status:'pending'}]},
    {...base,accounts:[{...account,userId:'\ud800'}]},
    {...base,metadata:{}},
    {accounts:Array.from({length:101},(_,i)=>({userId:'local-'+i,account:'external:'+i})),transactions:[]},
    '{"accounts":[],"acc\\u006funts":[],"transactions":[]}',
    'x'.repeat(65537),
  ];
  for(const records of variants)await assert.rejects(withPython(records,()=>assert.fail('Invalid records admitted')),/Python provider exited before readiness/);
});
