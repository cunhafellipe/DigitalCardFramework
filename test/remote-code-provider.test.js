import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRemoteCodeProvider,createCodeProviderRegistry} from '../src/remote-code-provider.js';
import {codeProviderProtocol,codeProviderSchema,validateCodeProviderRequest,validateCodeProviderResponse} from '../src/code-provider-contracts.js';
import {createCodeGateway} from '../src/code-gateway.js';
import {codesFixture} from './codes-fixtures.mjs';

const token='synthetic-code-provider-credential';
const material={codeId:'code-fixture',providerId:'example.game',externalId:'ext-fixture',code:'SYNTHETIC-CODE'};
const config=url=>({providerId:'example.game',url,token,allowLoopbackHttp:true});
const identity=request=>Object.fromEntries(['protocol','requestId','providerId','codeId'].map(key=>[key,request[key]]));
const success=(request,status='redeemed')=>({...identity(request),status,...(status==='unknown'?{}:{eventId:'event-fixture',occurredAt:'2026-10-01T00:00:00Z'})});
const reply=(response,value,status=200)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(value));};
const errorCode=expected=>error=>error.code===expected;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function withProvider(handler,run) {
  const server=createServer(async(request,response)=>{
    try{const chunks=[];for await(const chunk of request)chunks.push(chunk);const value=JSON.parse(Buffer.concat(chunks));await handler(request,response,value);}catch{response.destroy();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run('http://127.0.0.1:'+server.address().port+'/code-status');}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

test('portable code status schema rejects extra fields, unsupported operations and invalid terminal evidence',async()=>{
  const request={...material,protocol:codeProviderProtocol,operation:'lookup',requestId:'01234567-89ab-4cde-8f01-23456789abcd'};
  assert.equal(validateCodeProviderRequest(request),request);
  assert.equal(validateCodeProviderRequest({...request,externalId:'x'.repeat(300)}).externalId.length,300);
  for(const value of [{...request,operation:'redeem'},{...request,providerId:'constructor'},{...request,code:'x\n'},{...request,externalId:'x'.repeat(301)},{...request,code:'\ud800'},{...request,metadata:{}}])assert.throws(()=>validateCodeProviderRequest(value),errorCode('INVALID_PROVIDER_REQUEST'));
  for(const value of [{...success(request),occurredAt:'2026-02-30T00:00:00Z'},{...success(request),eventId:''},{...success(request),message:material.code},{...identity(request),status:'unknown',eventId:'not-allowed'},{...identity(request),status:'error',errorCode:'private-error'},{...success(request),protocol:'digital-card-code-status@2'}])assert.throws(()=>validateCodeProviderResponse(value),errorCode('INVALID_PROVIDER'));
  for(const occurredAt of ['2026-10-01T00:00:00.1Z','2026-10-01T00:00:00.12Z','2026-10-01T00:00:00.123Z'])assert.equal(validateCodeProviderResponse({...success(request),occurredAt}).occurredAt,occurredAt);
  const schemaFile=new URL('../docs/code-provider.schema.json',import.meta.url);
  assert.deepEqual(JSON.parse(await readFile(schemaFile,'utf8')),codeProviderSchema);
});

test('only explicit loopback development HTTP and bounded operator configuration are accepted',()=>{
  const userinfo=new URL('https://example.com/status');userinfo.username='synthetic-user';userinfo.password='synthetic-password';
  for(const options of [
    {...config('http://127.0.0.1/status'),allowLoopbackHttp:false},config('http://example.com/status'),config(userinfo.href),config('https://example.com/status?token=hidden'),config('https://example.com/status#hidden'),{...config('https://example.com'),token:'short'},{...config('https://example.com'),token:token+'\n'}, {...config('https://example.com'),maxConcurrent:65},{...config('https://example.com'),timeoutMs:0},{...config('https://example.com'),maxRequestBytes:65537},{...config('https://example.com'),fetchImpl:()=>{}}
  ])assert.throws(()=>createRemoteCodeProvider(options),errorCode('CODE_PROVIDER_CONFIG'));
  const provider=createRemoteCodeProvider(config('https://example.com/status'));assert.equal(provider.providerId,'example.game');assert(!JSON.stringify(provider).includes(token));provider.disable();
  const direct={lookup:()=>({codeId:material.codeId,status:'unknown'})};
  assert.equal(createCodeProviderRegistry({codeProviders:{'example.game':direct}}).providers['example.game'],direct);
  for(const settings of [
    {codeProviders:{'example.game':direct},codeProviderEndpoints:{'example.game':config('https://example.com')}},
    {codeProviders:{'example.game':{...direct,providerId:'other'}}},
    {codeProviderEndpoints:{'example.game':{...config('https://example.com'),providerId:'other'}}},
    {codeProviderEndpoints:[]},
  ])assert.throws(()=>createCodeProviderRegistry(settings),errorCode('CODE_PROVIDER_CONFIG'));
});

test('actual HTTP lookup authenticates and confirms exact provider evidence with core event deduplication',async()=>{
  let calls=0;
  await withProvider((request,response,data)=>{
    calls++;
    assert.equal(request.method,'POST');assert.equal(request.url,'/code-status');assert.equal(request.headers.authorization,'Bearer '+token);
    assert.equal(request.headers['cache-control'],'no-store');assert.equal(data.operation,'lookup');assert.equal(data.code,'SECRET-REWARD-0');assert.equal(data.externalId,'ext-0');
    validateCodeProviderRequest(data);reply(response,success(data));
  },async url=>{
    const x=codesFixture(),codeId=x.openCode().codes[0].id;
    const registry=createCodeProviderRegistry({codeProviderEndpoints:{'example.game':{url,token,allowLoopbackHttp:true}}});
    const gateway=createCodeGateway({framework:x.core,providers:registry.providers});
    try{
      assert.deepEqual(await gateway.reconcile(x.alice,{codeId}),{codeId,status:'redeemed'});
      assert.deepEqual(await gateway.reconcile(x.alice,{codeId}),{codeId,status:'redeemed'});
      assert.equal(calls,2);assert.equal(x.store.read(s=>Object.keys(s.codeConfirmations).length),1);assert.equal(x.core.audit({role:'admin'}).ok,true);
      assert(!JSON.stringify(x.store.read(s=>s)).includes('SECRET-REWARD-0'));
    }finally{registry.close();x.core.close();}
  });
});

test('unauthenticated, disabled, sealed and wrong-holder callers never reach remote lookup',async()=>{
  let calls=0;
  await withProvider((_request,response,data)=>{calls++;reply(response,success(data));},async url=>{
    const x=codesFixture(),provider=createRemoteCodeProvider(config(url));
    const gateway=createCodeGateway({framework:x.core,providers:{'example.game':provider}});
    try{
      x.buy('bundle');const codeId=x.store.read(s=>Object.values(s.codes).find(row=>row.copyId)?.id);
      await assert.rejects(gateway.reconcile(x.alice,{codeId}),errorCode('NOT_FOUND'));
      const openedId=x.openCode().codes[0].id;
      for(const actor of [null,{},x.bob,{...x.alice,disabled:true}])await assert.rejects(gateway.reconcile(actor,{codeId:openedId}));
      assert.equal(calls,0);
    }finally{provider.disable();x.core.close();}
  });
});

test('unknown stays unverified and revoked is a confirmed terminal state',async()=>{
  let status='unknown';
  await withProvider((_request,response,data)=>reply(response,success(data,status)),async url=>{
    const x=codesFixture(),codeId=x.openCode().codes[0].id,provider=createRemoteCodeProvider(config(url));
    const gateway=createCodeGateway({framework:x.core,providers:{'example.game':provider}});
    try{
      assert.deepEqual(await gateway.reconcile(x.alice,{codeId}),{codeId,status:'unverified'});assert.equal(x.store.read(s=>Object.keys(s.codeConfirmations).length),0);
      status='revoked';assert.deepEqual(await gateway.reconcile(x.alice,{codeId}),{codeId,status:'revoked'});
    }finally{provider.disable();x.core.close();}
  });
});

test('wrong request, provider and code identity and malformed replies cannot confirm',async()=>{
  const variants=[value=>({...success(value),requestId:'01234567-89ab-4cde-8f01-23456789abcd'}),value=>({...success(value),providerId:'other.provider'}),value=>({...success(value),codeId:'other.code'}),value=>({...success(value),status:'pending'}),value=>({...success(value),privateMessage:material.code}),value=>({...identity(value),status:'error',errorCode:'unavailable'})];
  for(const change of variants)await withProvider((_request,response,data)=>reply(response,change(data)),async url=>{
    const provider=createRemoteCodeProvider(config(url));
    await assert.rejects(provider.lookup(material),errorCode('INVALID_PROVIDER'));provider.disable();
  });
});

test('authenticated error replies and rejected credentials expose only sanitized failure',async()=>{
  await withProvider((_request,response,data)=>reply(response,{...identity(data),status:'error',errorCode:'unauthenticated'},401),async url=>{
    const provider=createRemoteCodeProvider(config(url));
    await assert.rejects(provider.lookup(material),error=>error.code==='CODE_PROVIDER_ERROR'&&!error.message.includes(token)&&!error.message.includes(material.code));provider.disable();
  });
  await withProvider((_request,response)=>{response.writeHead(401,{'content-type':'text/plain'});response.end(token+' '+material.code);},async url=>{
    const provider=createRemoteCodeProvider(config(url));await assert.rejects(provider.lookup(material),error=>!error.message.includes(token)&&!error.message.includes(material.code));provider.disable();
  });
});

test('duplicate JSON keys, malformed UTF-8 and compressed output fail closed',async()=>{
  for(const mode of ['duplicate','utf8','compressed'])await withProvider((_request,response,data)=>{
    response.writeHead(200,{'content-type':'application/json',...(mode==='compressed'?{'content-encoding':'gzip'}:{})});
    if(mode==='duplicate')response.end(JSON.stringify(success(data)).replace('"status":"redeemed"','"status":"unknown","sta\\u0074us":"redeemed"'));
    else if(mode==='utf8')response.end(Buffer.from([0xff,0xfe]));
    else response.end(JSON.stringify(success(data)));
  },async url=>{
    const provider=createRemoteCodeProvider(config(url));await assert.rejects(provider.lookup(material),errorCode(mode==='utf8'?'CODE_PROVIDER_ERROR':'INVALID_PROVIDER'));provider.disable();
  });
});

test('request, streamed response, declared response and header bounds reject excess bytes',async()=>{
  let calls=0;
  await withProvider((_request,response,data)=>{calls++;reply(response,success(data));},async url=>{
    const provider=createRemoteCodeProvider({...config(url),maxRequestBytes:32});await assert.rejects(provider.lookup(material),errorCode('CODE_PROVIDER_LIMIT'));assert.equal(calls,0);provider.disable();
  });
  for(const mode of ['stream','length','header'])await withProvider((_request,response)=>{
    const headers={'content-type':'application/json',...(mode==='length'?{'content-length':'100000'}:{}),...(mode==='header'?{'x-excess':'x'.repeat(9000)}:{})};
    response.writeHead(200,headers);response.write('x'.repeat(100));response.end('x'.repeat(100));
  },async url=>{
    const provider=createRemoteCodeProvider({...config(url),maxResponseBytes:64});await assert.rejects(provider.lookup(material),errorCode(mode==='header'?'CODE_PROVIDER_ERROR':'CODE_PROVIDER_LIMIT'));provider.disable();
  });
});

test('redirects are rejected without disclosing lookup credentials or material to a second endpoint',async()=>{
  let redirected=0;
  await withProvider((_request,response,data)=>{redirected++;reply(response,success(data));},async target=>{
    await withProvider((_request,response)=>{response.writeHead(307,{location:target});response.end();},async url=>{
      const provider=createRemoteCodeProvider(config(url));await assert.rejects(provider.lookup(material),errorCode('INVALID_PROVIDER'));assert.equal(redirected,0);provider.disable();
    });
  });
});

test('deadline and caller abort terminate actual in-flight HTTP requests',async()=>{
  for(const mode of ['deadline','abort']) {
    const started=deferred(),closed=deferred();
    await withProvider((_request,response)=>{response.on('close',closed.resolve);started.resolve();},async url=>{
      const provider=createRemoteCodeProvider({...config(url),timeoutMs:mode==='deadline'?50:1000}),controller=new AbortController();
      const lookup=provider.lookup({...material,signal:controller.signal});const rejected=assert.rejects(lookup,errorCode(mode==='deadline'?'PROVIDER_TIMEOUT':'CODE_PROVIDER_ABORTED'));
      await started.promise;if(mode==='abort')controller.abort();await rejected;await closed.promise;provider.disable();
    });
  }
});

test('concurrency limits reject excess work without a pending request queue',async()=>{
  const started=deferred(),release=deferred();let calls=0;
  await withProvider(async(_request,response,data)=>{calls++;started.resolve();await release.promise;reply(response,success(data,'unknown'));},async url=>{
    const provider=createRemoteCodeProvider({...config(url),maxConcurrent:1});const first=provider.lookup(material);await started.promise;
    await assert.rejects(provider.lookup(material),errorCode('CODE_PROVIDER_BUSY'));assert.equal(calls,1);release.resolve();await first;
    await provider.lookup(material);assert.equal(calls,2);provider.disable();
  });
});

test('disable aborts all in-flight requests and never admits their terminal response',async()=>{
  const started=deferred(),closed=deferred(),release=deferred();let confirmations=0;
  await withProvider(async(_request,response,data)=>{response.on('close',closed.resolve);started.resolve();await release.promise;reply(response,success(data));},async url=>{
    const registry=createCodeProviderRegistry({codeProviderEndpoints:{'example.game':{url,token,allowLoopbackHttp:true}}});
    const framework={codeLookupMaterial:()=>material,confirmCodeStatus:()=>{confirmations++;}};
    const gateway=createCodeGateway({framework,providers:registry.providers});
    const pending=gateway.reconcile({userId:'collector'},{codeId:material.codeId});const rejected=assert.rejects(pending,errorCode('CODE_PROVIDER_ERROR'));
    await started.promise;registry.disable('example.game');await rejected;await closed.promise;release.resolve();
    await assert.rejects(registry.providers['example.game'].lookup(material),errorCode('CODE_PROVIDER_DISABLED'));assert.equal(confirmations,0);registry.close();
  });
});

test('gateway checks the live grant again after a transport response and before confirmation admission',async()=>{
  await withProvider((_request,response,data)=>reply(response,success(data)),async url=>{
    const provider=createRemoteCodeProvider(config(url));let confirmations=0;
    const framework={codeLookupMaterial:()=>material,confirmCodeStatus:()=>{confirmations++;}};
    const bridge={...provider,async lookup(input){const result=await provider.lookup(input);provider.disable();return result;}};
    const gateway=createCodeGateway({framework,providers:{'example.game':bridge}});
    await assert.rejects(gateway.reconcile({userId:'collector'},{codeId:material.codeId}),errorCode('CODE_PROVIDER_DISABLED'));assert.equal(confirmations,0);
  });
});

test('independent Python standard-library fixture exercises authenticated exact lookup over the same protocol',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'dc-code-provider-'));
  let child;
  try{
    const filename=path.join(directory,'records.json');await writeFile(filename,JSON.stringify([{code:material.code,externalId:material.externalId,status:'redeemed',eventId:'python-fixture',occurredAt:'2026-10-01T00:00:00Z'}]));
    child=spawn(process.env.PYTHON??(process.platform==='win32'?'python':'python3'),[fileURLToPath(new URL('../examples/plugins/python-code-provider.py',import.meta.url)),filename],{env:{...process.env,CODE_PROVIDER_TOKEN:token},stdio:['ignore','pipe','pipe']});
    const port=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('Python provider startup timed out')),10000);
      const done=(fn,value)=>{clearTimeout(timer);fn(value);};
      child.once('error',error=>done(reject,error));child.once('exit',()=>done(reject,Error('Python provider exited before readiness')));
      child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('\n'))done(resolve,Number(output.trim()));});
    });
    const url='http://127.0.0.1:'+port+'/code-status',provider=createRemoteCodeProvider(config(url));
    assert.deepEqual(await provider.lookup(material),{codeId:material.codeId,status:'redeemed',eventId:'python-fixture',occurredAt:'2026-10-01T00:00:00Z'});
    assert.deepEqual(await provider.lookup({...material,code:material.code+'-OTHER'}),{codeId:material.codeId,status:'unknown'});
    assert.deepEqual(await provider.lookup({...material,externalId:'other'}),{codeId:material.codeId,status:'unknown'});
    const unauthenticated=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(material)});assert.equal(unauthenticated.status,401);assert.deepEqual(await unauthenticated.json(),{});
    for(const body of [JSON.stringify({protocol:codeProviderProtocol,operation:'redeem'}),'{"code":"one","code":"two"}']) {
      const invalid=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body});assert.equal(invalid.status,400);assert.deepEqual(await invalid.json(),{});
    }
    provider.disable();
  }finally{
    if(child?.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}await rm(directory,{recursive:true,force:true});
  }
});

test('invalid SDK cancellation cannot consume provider capacity',async()=>{
  const provider=createRemoteCodeProvider({...config('https://example.invalid'),maxConcurrent:1});
  try{for(let attempt=0;attempt<2;attempt++)await assert.rejects(provider.lookup({...material,signal:{}}),error=>error.code==='CODE_PROVIDER_CONFIG');}finally{provider.disable();}
});
