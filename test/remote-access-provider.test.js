import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {createRemoteAccessProvider,createHostAccessResolver,validateAccessProviderRequest} from '../src/remote-access-provider.js';
import {createAuthHost} from '../src/auth.js';
import {PERMISSIONS} from '../src/access.js';

const identity=Object.freeze({issuer:'https://issuer.test',subject:'collector',userId:'collector'});
const token='access-fixture-service-token';
const allowed=input=>({...input,status:'allowed',role:'player',permissions:['art.import']});
async function endpoint(t){
  let respond=(input,req,res)=>res.end(JSON.stringify(allowed(input)));
  const requests=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body);requests.push({input,headers:req.headers});
    res.setHeader('Content-Type','application/json');respond(input,req,res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return {requests,set respond(value){respond=value;},options:{providerId:'example.access',url:'http://127.0.0.1:'+server.address().port+'/access-provider',token,allowLoopbackHttp:true,allowRoles:['player'],allowPermissions:['art.import']}};
}

test('authenticated remote access sends only a bounded identity snapshot and copies operator ceilings',async t=>{
  const service=await endpoint(t),options={...service.options},provider=createRemoteAccessProvider(options);t.after(()=>provider.close());
  options.allowRoles.push('admin');options.allowPermissions.push('catalog.publish');
  const access=await provider.resolveAccess({...identity,cookie:'browser-cookie',credentials:'identity-secret',permissions:['catalog.publish']});
  assert.deepEqual(access,{role:'player',permissions:['art.import']});assert(Object.isFrozen(access));assert(Object.isFrozen(access.permissions));
  const {input,headers}=service.requests[0];validateAccessProviderRequest(input);
  assert.equal(headers.authorization,'Bearer '+token);assert.equal(headers.cookie,undefined);assert.equal(headers['content-type'],'application/json');
  assert.deepEqual(Object.keys(input).sort(),['protocol','operation','scope','requestId','providerId','grantId','generation','deadline','issuer','subject','userId'].sort());
  assert.equal(input.issuer,identity.issuer);assert.equal(input.subject,identity.subject);assert.equal(input.userId,identity.userId);assert(input.deadline>Date.now());
  assert.deepEqual(provider.allowRoles,['player']);assert.deepEqual(provider.allowPermissions,['art.import']);
  assert.throws(()=>provider.allowPermissions.push('admin.read'));
  service.respond=(input,req,res)=>res.end(JSON.stringify({...allowed(input),permissions:['art.import','catalog.publish']}));
  assert.equal(await provider.resolveAccess(identity),null);
  const calls=service.requests.length;assert.equal(await provider.resolveAccess({...identity,userId:'__proto__'}),null);assert.equal(service.requests.length,calls);
  const bounded=createRemoteAccessProvider({...service.options,allowRoles:['player'],allowPermissions:['art.import'],maxRequestBytes:1});t.after(()=>bounded.close());assert.equal(await bounded.resolveAccess(identity),null);assert.equal(service.requests.length,calls);
});

test('remote decisions fail closed on malformed data, correlation drift, overgrants and transport errors',async t=>{
  const service=await endpoint(t),provider=createRemoteAccessProvider({...service.options,maxResponseBytes:4096});t.after(()=>provider.close());
  const cases=[
    input=>({...input,status:'denied'}),input=>({...input,status:'disabled'}),
    input=>({...allowed(input),role:'admin'}),input=>({...allowed(input),permissions:['catalog.publish']}),
    input=>({...allowed(input),permissions:['unknown.permission']}),input=>({...allowed(input),permissions:['art.import','art.import']}),
    input=>({...allowed(input),sessionSecret:'unexpected'}),input=>({...allowed(input),role:undefined}),
    input=>({...allowed(input),issuer:'https://foreign.test'}),input=>({...allowed(input),subject:'other'}),
    input=>({...allowed(input),userId:'other'}),input=>({...allowed(input),generation:input.generation+1}),
    input=>({...allowed(input),grantId:'00000000-0000-4000-8000-000000000000'}),
    input=>({...allowed(input),requestId:'00000000-0000-4000-8000-000000000000'}),
    input=>({...allowed(input),deadline:input.deadline+1}),input=>({...allowed(input),protocol:'digital-card-access-provider@2'}),
    input=>({...input,status:'error',errorCode:'unavailable'}),
  ];
  for(const decision of cases){service.respond=(input,req,res)=>res.end(JSON.stringify(decision(input)));assert.equal(await provider.resolveAccess(identity),null);}
  for(const [status,errorCode]of [[400,'invalid-request'],[401,'unauthenticated'],[429,'rate-limited'],[503,'unavailable']]){
    service.respond=(input,req,res)=>{res.statusCode=status;res.end(JSON.stringify({...input,status:'error',errorCode}));};assert.equal(await provider.resolveAccess(identity),null);
  }
  for(const reply of [
    (input,res)=>{res.statusCode=302;res.setHeader('Location','http://127.0.0.1/redirect');res.end();},
    (input,res)=>{res.setHeader('Content-Type','text/plain');res.end(JSON.stringify(allowed(input)));},
    (input,res)=>{res.setHeader('Content-Encoding','gzip');res.end(JSON.stringify(allowed(input)));},
    (input,res)=>res.end(JSON.stringify(allowed(input)).replace('"status":','"status":"disabled","status":')),
    (input,res)=>res.end(Buffer.from([0xff])),
    (input,res)=>res.end('{malformed'),
    (input,res)=>res.end(' '.repeat(4097)),
  ]){service.respond=(input,req,res)=>reply(input,res);assert.equal(await provider.resolveAccess(identity),null);}
  service.respond=(input,req,res)=>req.socket.destroy();assert.equal(await provider.resolveAccess(identity),null);
  service.respond=(input,req,res)=>res.end(JSON.stringify(allowed(input)));assert.deepEqual(await provider.resolveAccess(identity),{role:'player',permissions:['art.import']});
});

test('access cancellation, capacity, timeout, disable and close discard pending decisions',async t=>{
  const service=await endpoint(t),provider=createRemoteAccessProvider({...service.options,timeoutMs:150,maxConcurrent:1});t.after(()=>provider.close());
  let arrived;service.respond=()=>arrived?.();
  const waitForCall=()=>new Promise(resolve=>{arrived=resolve;});
  const firstArrival=waitForCall(),controller=new AbortController(),pending=provider.resolveAccess(identity,{signal:controller.signal});await firstArrival;
  const calls=service.requests.length;assert.equal(await provider.resolveAccess(identity),null);assert.equal(service.requests.length,calls);
  controller.abort();assert.equal(await pending,null);
  const secondArrival=waitForCall(),stale=provider.resolveAccess(identity);await secondArrival;const disabled=provider.setEnabled(false);assert.equal(disabled.enabled,false);provider.setEnabled(true);assert.equal(await stale,null);
  service.respond=(input,req,res)=>res.end(JSON.stringify(allowed(input)));assert.deepEqual(await provider.resolveAccess(identity),{role:'player',permissions:['art.import']});assert.equal(service.requests.at(-1).input.generation,3);
  service.respond=()=>{};assert.equal(await provider.resolveAccess(identity),null);
  const finalArrival=waitForCall();service.respond=()=>arrived?.();const closing=provider.resolveAccess(identity);await finalArrival;provider.close();assert.equal(await closing,null);
  const before=service.requests.length;assert.equal(await provider.resolveAccess(identity),null);assert.equal(service.requests.length,before);assert.throws(()=>provider.setEnabled(true));
});

test('configuration requires explicit known grants and unambiguous host selection',async t=>{
  const service=await endpoint(t);
  for(const options of [
    {...service.options,allowRoles:undefined},{...service.options,allowPermissions:undefined},
    {...service.options,allowRoles:['admin']},{...service.options,allowRoles:[]},
    {...service.options,allowPermissions:['unknown.permission']},{...service.options,scope:'access'},
    {...service.options,url:'http://external.test/access-provider'},{...service.options,url:service.options.url+'?query=secret'},
    {...service.options,token:'short'},{...service.options,maxConcurrent:65},
  ])assert.throws(()=>createRemoteAccessProvider(options));
  assert.throws(()=>createHostAccessResolver({remoteAccess:service.options,resolveAccess:()=>null}));assert.throws(()=>createHostAccessResolver({resolveAccess:null}));
  const base=createHostAccessResolver();assert.equal(base.resolveAccess,undefined);base.close();
  const callback=()=>({role:'player'});assert.equal(createHostAccessResolver({resolveAccess:callback}).resolveAccess,callback);
  const admin=createRemoteAccessProvider({...service.options,allowRoles:['admin'],allowPermissions:PERMISSIONS});t.after(()=>admin.close());
  service.respond=(input,req,res)=>res.end(JSON.stringify({...allowed(input),role:'admin',permissions:[]}));assert.equal((await admin.resolveAccess(identity)).role,'admin');
});

test('auth preserves synchronous callers and awaits immutable async access with request cancellation',async()=>{
  const sessions={get(){return {...identity,privateField:'hidden'};}};
  const plain=createAuthHost({sessions,origin:'https://cards.test',adminSubjects:[identity.subject]});const request={headers:{cookie:'__Host-dc_session=opaque'}};
  assert.deepEqual(plain.resolveIdentity(request),{userId:'collector',role:'admin',permissions:[]});
  const sync=createAuthHost({sessions,origin:'https://cards.test',resolveAccess(verified){assert(Object.isFrozen(verified));assert.deepEqual(verified,identity);return {role:'player',permissions:['art.import']};}});
  assert.deepEqual(sync.resolveIdentity(request),{userId:'collector',role:'player',permissions:['art.import']});
  let started;const arrival=new Promise(resolve=>{started=resolve;});
  const socket=new EventEmitter(),req=Object.assign(new EventEmitter(),request,{socket});
  const asyncHost=createAuthHost({sessions,origin:'https://cards.test',adminSubjects:[identity.subject],resolveAccess(verified,{signal}){started();return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({role:'admin'}),{once:true}));}});
  const pending=asyncHost.resolveIdentity(req);await arrival;socket.emit('close');assert.equal(await pending,null);assert.equal(socket.listenerCount('close'),0);assert.equal(req.listenerCount('aborted'),0);
  const failed=createAuthHost({sessions,origin:'https://cards.test',adminSubjects:[identity.subject],resolveAccess(){throw new Error('Access unavailable');}});assert.equal(failed.resolveIdentity(request),null);
});

test('a disconnected HTTP client cancels access transport and releases its concurrency slot',async t=>{
  const service=await endpoint(t),provider=createRemoteAccessProvider({...service.options,maxConcurrent:1,timeoutMs:3000});t.after(()=>provider.close());
  let arrived,finished,closed;
  const arrival=new Promise(resolve=>{arrived=resolve;}),completion=new Promise(resolve=>{finished=resolve;}),connectionClosed=new Promise(resolve=>{closed=resolve;});
  service.respond=(input,req,res)=>{res.once('close',closed);arrived();};
  let signal;
  const auth=createAuthHost({sessions:{get:()=>identity},origin:'https://cards.test',resolveAccess(verified,options){signal=options.signal;return provider.resolveAccess(verified,options);}});
  const server=createServer(async(req,res)=>{const result=await auth.resolveIdentity(req);assert.equal(req.listenerCount('aborted'),0);if(!res.destroyed)res.end(JSON.stringify(result));finished(result);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const controller=new AbortController(),pending=fetch('http://127.0.0.1:'+server.address().port,{headers:{cookie:'__Host-dc_session=opaque'},signal:controller.signal});
  await arrival;controller.abort();await assert.rejects(pending);assert.equal(await completion,null);assert.equal(signal.aborted,true);
  let timer;try{await Promise.race([connectionClosed,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Provider connection was not cancelled')),1000);})]);}finally{clearTimeout(timer);}
  service.respond=(input,req,res)=>res.end(JSON.stringify(allowed(input)));assert.deepEqual(await provider.resolveAccess(identity),{role:'player',permissions:['art.import']});
});
