import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createRemoteListingPolicy,listingPolicyProtocol,validateListingPolicyResponse} from '../src/remote-listing-policy.js';
import {createRemotePurchasePolicy,purchasePolicyProtocol,validatePurchasePolicyResponse} from '../src/remote-purchase-policy.js';

const python=process.env.PYTHON??(process.platform==='win32'?'C:/Program Files/Python314/python.exe':'python3');
const example=fileURLToPath(new URL('../examples/plugins/python-listing-policy.py',import.meta.url));
const token='synthetic-listing-python-credential',providerId='example.policy';
const shopId=randomUUID(),listingId=randomUUID(),unitId=randomUUID();
const headers={'content-type':'application/json',authorization:'Bearer '+token};
const records={actors:[{id:'alice',listShopIds:[shopId],purchaseListingIds:[listingId]}]};
const shop={id:shopId,ownerId:'alice',kind:'player'},price={currencyId:'credits',amount:15};
const identity=()=>({scope:'listing',providerId,requestId:randomUUID(),grantId:randomUUID(),generation:1,commandId:'a'.repeat(64),inputDigest:'b'.repeat(64),snapshotDigest:'c'.repeat(64),deadline:Date.now()+10000});
const list=()=>({...identity(),protocol:listingPolicyProtocol,operation:'canList',phase:'create',context:{actor:{id:'alice'},shop,price,stock:{kind:'copies',ids:[unitId]}}});
const purchase=()=>({...identity(),protocol:purchasePolicyProtocol,operation:'canPurchase',phase:'quote',context:{user:{id:'alice'},shop,listing:{id:listingId,kind:'copies',price},quantity:1,unitIds:[unitId]}});

async function withPython(config,run,env={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'dc-listing-policy-'));let child;
  try{
    const filename=path.join(directory,'records.json');await writeFile(filename,typeof config==='string'||Buffer.isBuffer(config)?config:JSON.stringify(config));
    child=spawn(python,[example,filename],{env:{...process.env,LISTING_POLICY_PROVIDER_ID:providerId,LISTING_POLICY_TOKEN:token,...env},stdio:['ignore','pipe','pipe']});
    const port=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('Python policy startup timed out')),10000);
      const done=(fn,value)=>{clearTimeout(timer);fn(value);};
      child.once('error',error=>done(reject,error));child.once('exit',()=>done(reject,Error('Python policy exited before readiness')));
      child.stderr.resume();
      child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('\n')){const value=Number(output.trim());if(Number.isSafeInteger(value)&&value>0&&value<=65535)done(resolve,value);else done(reject,Error('Invalid Python policy readiness'));}});
    });
    await run('http://127.0.0.1:'+port+'/listing-policy',filename);
  }finally{
    if(child?.pid&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
    await rm(directory,{recursive:true,force:true});
  }
}

test('independent Python policy allows only configured actors and targets through both Node transports',async()=>{
  await withPython(records,async(url,filename)=>{
    const original=await readFile(filename);
    for(const [factory,make,validate] of [[createRemoteListingPolicy,list,validateListingPolicyResponse],[createRemotePurchasePolicy,purchase,validatePurchasePolicyResponse]]){
      const remote=factory({scope:'listing',providerId,url,token,allowLoopbackHttp:true});
      try{
        const request={...make(),...remote.grant()};const snapshot=structuredClone(request);
        const result=await remote.evaluate(request);validate(result);
        const {context,...echo}=request;assert.deepEqual(result,{...echo,status:'allowed'});assert.deepEqual(request,snapshot);
        const deniedActor=structuredClone(request);(deniedActor.context.actor??deniedActor.context.user).id='bob';
        const deniedTarget=structuredClone(request);if(request.operation==='canList')deniedTarget.context.shop.id=randomUUID();else deniedTarget.context.listing.id=randomUUID();
        for(const denied of [deniedActor,deniedTarget]){
          const {context,...echo}=denied;assert.deepEqual(await remote.evaluate(denied),{...echo,status:'denied',reasonCode:'restricted'});
        }
        if(request.operation==='canPurchase')assert.equal((await remote.evaluate({...request,phase:'purchase'})).status,'allowed');
      }finally{remote.close();}
    }
    assert.deepEqual(await readFile(filename),original);
  });
});

test('Python endpoint authenticates and validates all listing stock forms without changing fixture records',async()=>{
  await withPython(records,async(url,filename)=>{
    const original=await readFile(filename);
    for(const auth of [undefined,'Bearer incorrect-synthetic-credential']){
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:auth}:{})},body:JSON.stringify(list())});
      assert.equal(response.status,401);assert.deepEqual(await response.json(),{});
    }
    const stocks=[{kind:'copies',ids:[unitId]},{kind:'packs',ids:[unitId]},{kind:'mint-card',variantId:'base',quantity:1},{kind:'mint-pack',productId:'starter',quantity:1000},{kind:'action',handler:'example.effect',quantity:1}];
    for(const stock of stocks){
      const request=list();request.context.stock=stock;
      const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(request)});assert.equal(response.status,200);
      const value=await response.json();validateListingPolicyResponse(value);const {context,...echo}=request;assert.deepEqual(value,{...echo,status:'allowed'});
    }
    assert.deepEqual(await readFile(filename),original);
  });
});

test('Python request boundary rejects malformed identity, protocols, nested context and extra authority',async()=>{
  await withPython(records,async url=>{
    const values=[null,[],{}];
    for(const make of [list,purchase]){
      const base=make();
      for(const change of [{providerId:'other.policy'},{protocol:'digital-card-listing-policy@2'},{operation:'pay'},{scope:'trade'},{phase:'settle'},{requestId:'invalid'},{grantId:base.grantId+'\n'},{generation:true},{generation:0},{generation:9007199254740992},{deadline:-1},{commandId:'z'.repeat(64)},{inputDigest:'a'.repeat(65)},{snapshotDigest:'a'.repeat(64)+'\n'},{status:'allowed'},{wallet:{credits:1000}},{context:null}])values.push({...base,...change});
      const mutate=fn=>{const value=structuredClone(base);fn(value.context);values.push(value);};
      mutate(c=>{(c.actor??c.user).id='constructor';});mutate(c=>{(c.actor??c.user).id='\ud800';});
      mutate(c=>{(c.actor??c.user).role='admin';});mutate(c=>{c.shop.ownerId='bad id';});mutate(c=>{c.shop.kind='system';});mutate(c=>{c.shop.balance=1000;});mutate(c=>{c.approved=true;});
      mutate(c=>{(c.price??c.listing.price).amount=true;});mutate(c=>{(c.price??c.listing.price).amount=-1;});mutate(c=>{(c.price??c.listing.price).currencyId='prototype';});
      if(base.operation==='canList'){
        for(const stock of [null,{}, {kind:'copies',ids:[]},{kind:'copies',ids:[unitId,unitId]},{kind:'packs',ids:['invalid']},{kind:'copies',ids:Array(1001).fill(unitId)},{kind:'mint-card',variantId:'base',quantity:0},{kind:'mint-pack',productId:'prototype',quantity:1},{kind:'action',handler:'effect',quantity:1001},{kind:'action',handler:'effect',quantity:1,pay:true}])mutate(c=>{c.stock=stock;});
      }else{
        mutate(c=>{c.quantity=1001;});mutate(c=>{c.unitIds=[];});mutate(c=>{c.unitIds=[unitId,unitId];});mutate(c=>{c.listing.id='invalid';});mutate(c=>{c.listing.kind='unknown';});mutate(c=>{c.listing.allocated=true;});
      }
    }
    const bodies=[...values.map(value=>JSON.stringify(value)),'{','{"context":{},"cont\\u0065xt":{}}',JSON.stringify(list()).replace('"amount":15','"amount":NaN'),'x'.repeat(65537),Buffer.from([0xff,0xfe])];
    for(const body of bodies){const response=await fetch(url,{method:'POST',headers,body});assert.equal(response.status,400);assert.deepEqual(await response.json(),{});}
    for(const options of [{url:url+'?unsupported=1',headers},{url,headers:{...headers,'content-type':'text/plain'}}]){
      const response=await fetch(options.url,{method:'POST',headers:options.headers,body:JSON.stringify(list())});assert.equal(response.status,400);assert.deepEqual(await response.json(),{});
    }
    assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(list())})).status,200);
  });
});

test('Python fixture refuses ambiguous, unbounded or authoritative startup configuration',async()=>{
  const actor=records.actors[0];
  const variants=[{actors:[actor,actor]},{actors:[{...actor,id:'__proto__'}]},{actors:[{...actor,id:'\ud800'}]},{actors:[{...actor,listShopIds:[shopId,shopId]}]},{actors:[{...actor,purchaseListingIds:['invalid']}]},{actors:[{...actor,listShopIds:Array(101).fill(shopId)}]},{actors:[{...actor,allow:true}]},{actors:Array(101).fill(actor)},{...records,payments:[]},'{"actors":[],"act\\u006frs":[]}','x'.repeat(65537),Buffer.from([0xff])];
  for(const config of variants)await assert.rejects(withPython(config,()=>assert.fail('Invalid records admitted')),/Python policy exited before readiness/);
  for(const env of [{LISTING_POLICY_PROVIDER_ID:'constructor'},{LISTING_POLICY_TOKEN:'short'},{LISTING_POLICY_TOKEN:'invalid credential with spaces'}])await assert.rejects(withPython(records,()=>assert.fail('Invalid environment admitted'),env),/Python policy exited before readiness/);
});
