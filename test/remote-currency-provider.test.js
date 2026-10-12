import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRemoteCurrencyProvider,createCurrencyProviderRegistry} from '../src/remote-currency-provider.js';
import {currencyProviderProtocol,currencyProviderSchema,validateCurrencyProviderRequest,validateCurrencyProviderResponse} from '../src/currency-provider-contracts.js';
import {createCurrencyGateway} from '../src/currency-gateway.js';
import {createApiHandler} from '../src/http.js';
import {fixture,admin} from './helpers.js';

const token='synthetic-currency-provider-credential';
const currencies={POINTS:{currencyId:'credits',numerator:2,denominator:3}};
const material={providerId:'example.points',transactionId:'transaction-fixture'};
const config=url=>({providerId:material.providerId,url,token,currencies,allowLoopbackHttp:true});
const identity=request=>({...request});
const success=request=>request.operation==='resolve-account'?{...identity(request),status:'resolved',account:'external:'+request.userId}:{...identity(request),status:'settled',currency:'POINTS',amountUnits:'150'};
const reply=(response,value,status=200)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(value));};
const errorCode=expected=>error=>error.code===expected;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function unchanged(x) {
  assert.equal(x.core.wallet(x.alice).credits,10000);
  assert.equal(x.core.wallet(x.bob).credits,10000);
  assert.equal(x.core.history(x.alice).filter(row=>row.type==='external-credit').length,0);
  assert.equal(x.core.audit(admin).ok,true);
}
async function withProvider(handler,run) {
  const server=createServer(async(request,response)=>{
    try{const chunks=[];for await(const chunk of request)chunks.push(chunk);await handler(request,response,JSON.parse(Buffer.concat(chunks)));}catch{response.destroy();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run('http://127.0.0.1:'+server.address().port+'/currency-settlement');}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
async function rejectedGateway(url,expected,options={}) {
  const x=fixture(),provider=createRemoteCurrencyProvider({...config(url),...options});
  const gateway=createCurrencyGateway({framework:x.core,providers:{[material.providerId]:provider}});
  try{await assert.rejects(gateway.reconcile(x.alice,material),errorCode(expected));await tick();unchanged(x);}
  finally{provider.disable();x.core.close();}
}

test('versioned currency contract admits only exact identity and integer settlement evidence',()=>{
  const account={protocol:currencyProviderProtocol,operation:'resolve-account',requestId:'01234567-89ab-4cde-8f01-23456789abcd',providerId:material.providerId,userId:'collector'};
  const lookup={protocol:currencyProviderProtocol,operation:'lookup',requestId:account.requestId,providerId:material.providerId,transactionId:material.transactionId,account:'external:collector'};
  assert.equal(currencyProviderSchema.$ref,'#/$defs/request');
  for(const value of [account,lookup])assert.equal(validateCurrencyProviderRequest(value),value);
  for(const value of [{...account,amountUnits:'100'},{...lookup,operation:'settle'},{...account,providerId:'constructor'},{...account,userId:'\ud800'},{...lookup,account:'\n'},{...lookup,transactionId:'x'.repeat(301)},{...account,userId:'x'.repeat(101)}])assert.throws(()=>validateCurrencyProviderRequest(value),errorCode('INVALID_PROVIDER_REQUEST'));
  for(const value of [success(account),success(lookup),{...lookup,status:'pending'},{...lookup,status:'refunded'},{...lookup,status:'unknown'},{...account,status:'error',errorCode:'not-found'}])assert.equal(validateCurrencyProviderResponse(value),value);
  for(const value of [{...success(account),currency:'POINTS'},{...success(lookup),amountUnits:100},{...success(lookup),amountUnits:'0'},{...success(lookup),amountUnits:'-1'},{...success(lookup),amountUnits:'1.5'},{...success(lookup),amountUnits:'01'},{...success(lookup),amountUnits:'1'.repeat(41)},{...success(lookup),currency:'__proto__'},{...lookup,status:'pending',amountUnits:'100'},{...lookup,status:'paid'},{...success(lookup),metadata:{}},{...success(lookup),protocol:'digital-card-currency-settlement@2'},{...lookup,status:'error',errorCode:'private-error'}])assert.throws(()=>validateCurrencyProviderResponse(value),errorCode('INVALID_PROVIDER'));
  for(const suffix of ['\n','\r','\u2028','\u2029']) {
    assert.throws(()=>validateCurrencyProviderRequest({...account,requestId:account.requestId+suffix}),errorCode('INVALID_PROVIDER_REQUEST'));
    assert.throws(()=>validateCurrencyProviderRequest({...account,providerId:account.providerId+suffix}),errorCode('INVALID_PROVIDER_REQUEST'));
    assert.throws(()=>validateCurrencyProviderResponse({...success(lookup),currency:'POINTS'+suffix}),errorCode('INVALID_PROVIDER'));
    assert.throws(()=>validateCurrencyProviderResponse({...success(lookup),amountUnits:'150'+suffix}),errorCode('INVALID_PROVIDER'));
    assert.throws(()=>createRemoteCurrencyProvider({...config('https://example.com'),providerId:material.providerId+suffix}),errorCode('CURRENCY_PROVIDER_CONFIG'));
    assert.throws(()=>createRemoteCurrencyProvider({...config('https://example.com'),currencies:{['POINTS'+suffix]:{currencyId:'credits'}}}),errorCode('CURRENCY_PROVIDER_CONFIG'));
  }
});

test('configuration is bounded and mappings are trusted immutable host data',()=>{
  const userinfo=new URL('https://example.com/settlement');userinfo.username='synthetic-user';userinfo.password='synthetic-password';
  for(const options of [
    {...config('http://127.0.0.1/settlement'),allowLoopbackHttp:false},config('http://example.com/settlement'),config(userinfo.href),config('https://example.com/settlement?token=hidden'),config('https://example.com/settlement#hidden'),{...config('https://example.com'),token:'short'},{...config('https://example.com'),token:token+'\n'},{...config('https://example.com'),timeoutMs:0},{...config('https://example.com'),maxConcurrent:65},{...config('https://example.com'),maxRequestBytes:65537},{...config('https://example.com'),maxResponseBytes:65537},{...config('https://example.com'),currencies:{}},{...config('https://example.com'),currencies:{POINTS:{currencyId:'credits',denominator:0}}},{...config('https://example.com'),currencies:{POINTS:{currencyId:'credits',numerator:1.5}}},{...config('https://example.com'),currencies:{POINTS:{currencyId:'credits',amountUnits:'100'}}},{...config('https://example.com'),fetchImpl:()=>{}}
  ])assert.throws(()=>createRemoteCurrencyProvider(options),errorCode('CURRENCY_PROVIDER_CONFIG'));
  const mapping={POINTS:{currencyId:'credits'}},provider=createRemoteCurrencyProvider({...config('https://example.com'),currencies:mapping});
  mapping.POINTS.currencyId='gems';assert.equal(provider.currencies.POINTS.currencyId,'credits');assert(Object.isFrozen(provider.currencies.POINTS));assert(!JSON.stringify(provider).includes(token));provider.disable();
  const direct={resolveAccount:()=> 'external:collector',lookup:()=>({}),currencies};
  assert.equal(createCurrencyProviderRegistry({currencyProviders:{[material.providerId]:direct}}).providers[material.providerId],direct);
  for(const options of [{currencyProviders:{[material.providerId]:direct},currencyProviderEndpoints:{[material.providerId]:config('https://example.com')}},{currencyProviders:{[material.providerId]:{...direct,providerId:'other'}}},{currencyProviderEndpoints:{[material.providerId]:{...config('https://example.com'),providerId:'other'}}},{currencyProviderEndpoints:[]}])assert.throws(()=>createCurrencyProviderRegistry(options),errorCode('CURRENCY_PROVIDER_CONFIG'));
  assert.throws(()=>createCurrencyGateway({framework:{},providers:{[material.providerId]:{...direct,providerId:'other'}}}),errorCode('INVALID_PROVIDER'));
});

test('actual authenticated HTTP resolution and lookup convert host mapping and deduplicate settlement',async()=>{
  let calls=0;
  await withProvider((request,response,data)=>{
    calls++;assert.equal(request.method,'POST');assert.equal(request.url,'/currency-settlement');assert.equal(request.headers.authorization,'Bearer '+token);assert.equal(request.headers['cache-control'],'no-store');
    assert(!Object.hasOwn(data,'amountUnits'));assert(!Object.hasOwn(data,'currencies'));validateCurrencyProviderRequest(data);reply(response,success(data));
  },async url=>{
    const x=fixture(),registry=createCurrencyProviderRegistry({currencyProviderEndpoints:{[material.providerId]:{url,token,currencies,allowLoopbackHttp:true}}});
    const gateway=createCurrencyGateway({framework:x.core,providers:registry.providers});
    try{
      const first=await gateway.reconcile(x.alice,{...material,amountUnits:'999999',amount:999999,userId:x.bob.userId,status:'settled'});
      assert.equal(first.amount,100);assert.deepEqual(await gateway.reconcile(x.alice,material),first);assert.equal(calls,4);
      assert.equal(x.core.wallet(x.alice).credits,10100);assert.equal(x.core.wallet(x.bob).credits,10000);assert.equal(x.core.history(x.alice).filter(row=>row.type==='external-credit').length,1);assert.equal(x.core.audit(admin).ok,true);
    }finally{registry.close();x.core.close();}
  });
});

test('HTTP callers cannot choose amount, status, currency mapping or account owner',async()=>{
  await withProvider((_request,response,data)=>reply(response,success(data)),async url=>{
    const x=fixture(),provider=createRemoteCurrencyProvider(config(url));
    const gateway=createCurrencyGateway({framework:x.core,providers:{[material.providerId]:provider}});
    const server=createServer(createApiHandler({framework:x.core,currencyGateway:gateway,resolveIdentity:()=>x.alice,allowedOrigin:'https://cards.test',requirePrincipal:true}));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/currency/reconcile',{method:'POST',headers:{origin:'https://cards.test','content-type':'application/json','x-dc-principal':x.alice.userId},body:JSON.stringify({...material,userId:x.bob.userId,account:'external:'+x.bob.userId,amountUnits:'999999',status:'settled',currency:'gems',currencies:{POINTS:{currencyId:'gems'}}})});
      assert.equal(response.status,200);assert.equal((await response.json()).amount,100);assert.equal(x.core.wallet(x.alice).credits,10100);assert.equal(x.core.wallet(x.bob).credits,10000);assert.equal(x.core.audit(admin).ok,true);
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));provider.disable();x.core.close();}
  });
});

test('invalid caller identities never reach remote account resolution',async()=>{
  let calls=0;
  await withProvider((_request,response,data)=>{calls++;reply(response,success(data));},async url=>{
    const x=fixture(),provider=createRemoteCurrencyProvider(config(url));
    const gateway=createCurrencyGateway({framework:x.core,providers:{[material.providerId]:provider}});
    try{for(const actor of [null,{}, {...x.alice,disabled:true}])await assert.rejects(gateway.reconcile(actor,material));assert.equal(calls,0);unchanged(x);}
    finally{provider.disable();x.core.close();}
  });
});

test('wrong user, request, provider, operation, transaction and account binding never credit',async()=>{
  const variants=[
    ['resolve-account',value=>({...success(value),userId:'another-user'})],
    ['resolve-account',value=>({...success(value),requestId:'01234567-89ab-4cde-8f01-23456789abcd'})],
    ['resolve-account',value=>({...success(value),providerId:'other.provider'})],
    ['resolve-account',value=>({...success(value),account:'\ud800'})],
    ['lookup',value=>({...success(value),requestId:'01234567-89ab-4cde-8f01-23456789abcd'})],
    ['lookup',value=>({...success(value),providerId:'other.provider'})],
    ['lookup',value=>({...success(value),operation:'resolve-account'})],
    ['lookup',value=>({...success(value),transactionId:'other-transaction'})],
    ['lookup',value=>({...success(value),account:'other-account'})],
  ];
  for(const [operation,change] of variants)await withProvider((_request,response,data)=>reply(response,data.operation===operation?change(data):success(data)),url=>rejectedGateway(url,'INVALID_PROVIDER'));
});

test('untrusted amount, status, mappings and inexact conversions never credit',async()=>{
  const variants=[
    [value=>({...success(value),amountUnits:150}),'INVALID_PROVIDER'],
    [value=>({...success(value),amountUnits:'-150'}),'INVALID_PROVIDER'],
    [value=>({...success(value),amountUnits:'0.1'}),'INVALID_PROVIDER'],
    [value=>({...success(value),amountUnits:'150\n'}),'INVALID_PROVIDER'],
    [value=>({...success(value),amountUnits:'27021597764222976'}),'INVALID_INPUT'],
    [value=>({...success(value),amountUnits:'151'}),'INEXACT_CONVERSION'],
    [value=>({...success(value),status:'paid'}),'INVALID_PROVIDER'],
    [value=>({...identity(value),status:'pending'}),'SETTLEMENT_PENDING'],
    [value=>({...identity(value),status:'refunded'}),'SETTLEMENT_PENDING'],
    [value=>({...identity(value),status:'unknown'}),'SETTLEMENT_PENDING'],
    [value=>({...success(value),currency:'UNMAPPED'}),'UNKNOWN_CURRENCY'],
    [value=>({...success(value),currencies:{POINTS:{currencyId:'gems'}}}),'INVALID_PROVIDER'],
  ];
  for(const [change,expected] of variants)await withProvider((_request,response,data)=>reply(response,data.operation==='lookup'?change(data):success(data)),url=>rejectedGateway(url,expected));
});

test('provider errors and rejected credentials expose only bounded sanitized failure',async()=>{
  for(const operation of ['resolve-account','lookup'])await withProvider((_request,response,data)=>data.operation===operation?reply(response,{...identity(data),status:'error',errorCode:'unauthenticated'},401):reply(response,success(data)),url=>rejectedGateway(url,'CURRENCY_PROVIDER_ERROR'));
  await withProvider((_request,response)=>{response.writeHead(401,{'content-type':'text/plain'});response.end(token+' private upstream detail');},async url=>{
    const x=fixture(),provider=createRemoteCurrencyProvider(config(url)),gateway=createCurrencyGateway({framework:x.core,providers:{[material.providerId]:provider}});
    try{await assert.rejects(gateway.reconcile(x.alice,material),error=>!error.message.includes(token)&&!error.message.includes('private upstream'));unchanged(x);}
    finally{provider.disable();x.core.close();}
  });
  await withProvider((_request,response,data)=>reply(response,{...identity(data),status:'error',errorCode:'unavailable'}),url=>rejectedGateway(url,'INVALID_PROVIDER'));
});

test('duplicate keys, invalid UTF-8, compression and extra fields fail without settlement',async()=>{
  for(const mode of ['duplicate','utf8','compressed','extra','json'])await withProvider((_request,response,data)=>{
    if(data.operation==='resolve-account'){reply(response,success(data));return;}
    response.writeHead(200,{'content-type':'application/json',...(mode==='compressed'?{'content-encoding':'gzip'}:{})});
    if(mode==='duplicate')response.end(JSON.stringify(success(data)).replace('"amountUnits":"150"','"amountUnits":"300","amount\\u0055nits":"150"'));
    else if(mode==='utf8')response.end(Buffer.from([0xff,0xfe]));
    else if(mode==='extra')response.end(JSON.stringify({...success(data),message:'upstream detail'}));
    else if(mode==='json')response.end('{');
    else response.end(JSON.stringify(success(data)));
  },url=>rejectedGateway(url,['utf8','json'].includes(mode)?'CURRENCY_PROVIDER_ERROR':'INVALID_PROVIDER'));
});

test('request, streamed response, declared response and header limits prevent settlement',async()=>{
  let calls=0;
  await withProvider((_request,response,data)=>{calls++;reply(response,success(data));},async url=>{await rejectedGateway(url,'CURRENCY_PROVIDER_LIMIT',{maxRequestBytes:32});assert.equal(calls,0);});
  for(const mode of ['stream','length','header'])await withProvider((_request,response)=>{
    response.writeHead(200,{'content-type':'application/json',...(mode==='length'?{'content-length':'100000'}:{}),...(mode==='header'?{'x-excess':'x'.repeat(9000)}:{})});response.write('x'.repeat(100));response.end('x'.repeat(100));
  },url=>rejectedGateway(url,mode==='header'?'CURRENCY_PROVIDER_ERROR':'CURRENCY_PROVIDER_LIMIT',{maxResponseBytes:64}));
});

test('redirects cannot disclose credentials to a second endpoint or credit funds',async()=>{
  let redirected=0;
  await withProvider((_request,response,data)=>{redirected++;reply(response,success(data));},async target=>{
    await withProvider((_request,response)=>{response.writeHead(307,{location:target});response.end();},url=>rejectedGateway(url,'INVALID_PROVIDER'));assert.equal(redirected,0);
  });
});

test('remote timeout, gateway deadline and cancellation close in-flight HTTP before settlement',async()=>{
  for(const operation of ['resolve-account','lookup'])for(const mode of ['remote-timeout','gateway-deadline','cancel']) {
    const started=deferred(),closed=deferred();
    await withProvider((_request,response,data)=>{
      if(data.operation!==operation){reply(response,success(data));return;}
      response.on('close',closed.resolve);started.resolve();
    },async url=>{
      const x=fixture(),provider=createRemoteCurrencyProvider({...config(url),timeoutMs:mode==='remote-timeout'?50:1000});
      const gateway=createCurrencyGateway({framework:x.core,providers:{[material.providerId]:provider},timeoutMs:mode==='gateway-deadline'?100:2000}),controller=new AbortController();
      try{
        const pending=gateway.reconcile(x.alice,material,{signal:controller.signal});
        const rejected=assert.rejects(pending,mode==='remote-timeout'?errorCode('PROVIDER_TIMEOUT'):{name:mode==='gateway-deadline'?'TimeoutError':'AbortError'});
        await started.promise;if(mode==='cancel')controller.abort();await rejected;await closed.promise;await tick();unchanged(x);
      }finally{provider.disable();x.core.close();}
    });
  }
});

test('disable aborts resolution or lookup and rejects all new admission without mutation',async()=>{
  for(const operation of ['resolve-account','lookup']) {
    const started=deferred(),closed=deferred(),release=deferred();
    await withProvider(async(_request,response,data)=>{
      if(data.operation!==operation){reply(response,success(data));return;}
      response.on('close',closed.resolve);started.resolve();await release.promise;reply(response,success(data));
    },async url=>{
      const x=fixture(),registry=createCurrencyProviderRegistry({currencyProviderEndpoints:{[material.providerId]:{url,token,currencies,allowLoopbackHttp:true}}});
      const gateway=createCurrencyGateway({framework:x.core,providers:registry.providers});
      try{
        const rejected=assert.rejects(gateway.reconcile(x.alice,material),errorCode('CURRENCY_PROVIDER_DISABLED'));
        await started.promise;registry.disable(material.providerId);await rejected;await closed.promise;release.resolve();await tick();
        await assert.rejects(gateway.reconcile(x.alice,material),errorCode('CURRENCY_PROVIDER_DISABLED'));unchanged(x);
      }finally{release.resolve();registry.close();x.core.close();}
    });
  }
});

test('live disable and cancellation after evidence arrival are checked immediately before settlement',async()=>{
  for(const mode of ['disable-account','disable-lookup','cancel-account','cancel-lookup']) {
    let lookups=0;
    await withProvider((_request,response,data)=>{if(data.operation==='lookup')lookups++;reply(response,success(data));},async url=>{
      const x=fixture(),provider=createRemoteCurrencyProvider(config(url)),controller=new AbortController();
      const operation=mode.endsWith('account')?'resolveAccount':'lookup';
      const bridge={...provider,async [operation](input){const result=await provider[operation](input);if(mode.startsWith('disable'))provider.disable();else controller.abort();return result;}};
      const gateway=createCurrencyGateway({framework:x.core,providers:{[material.providerId]:bridge}});
      try{
        await assert.rejects(gateway.reconcile(x.alice,material,{signal:controller.signal}),mode.startsWith('disable')?errorCode('CURRENCY_PROVIDER_DISABLED'):{name:'AbortError'});
        if(operation==='resolveAccount')assert.equal(lookups,0);await tick();unchanged(x);
      }finally{provider.disable();x.core.close();}
    });
  }
});

test('concurrency bounds share capacity across resolution and lookup without queuing',async()=>{
  const started=deferred(),release=deferred();let calls=0;
  await withProvider(async(_request,response,data)=>{calls++;started.resolve();await release.promise;reply(response,success(data));},async url=>{
    const x=fixture(),provider=createRemoteCurrencyProvider({...config(url),maxConcurrent:1});
    const gateway=createCurrencyGateway({framework:x.core,providers:{[material.providerId]:provider}});
    try{
      const first=provider.resolveAccount({userId:x.alice.userId});await started.promise;
      await assert.rejects(gateway.reconcile(x.alice,material),errorCode('CURRENCY_PROVIDER_BUSY'));
      await assert.rejects(provider.lookup({transactionId:material.transactionId,account:'external:'+x.alice.userId}),errorCode('CURRENCY_PROVIDER_BUSY'));
      assert.equal(calls,1);unchanged(x);release.resolve();assert.equal(await first,'external:'+x.alice.userId);
    }finally{release.resolve();provider.disable();x.core.close();}
  });
});

test('invalid SDK cancellation cannot consume provider capacity',async()=>{
  const provider=createRemoteCurrencyProvider({...config('https://example.invalid'),maxConcurrent:1});
  try{for(let attempt=0;attempt<2;attempt++)await assert.rejects(provider.resolveAccount({userId:'fixture',signal:{}}),error=>error.code==='CURRENCY_PROVIDER_CONFIG');}finally{provider.disable();}
});
