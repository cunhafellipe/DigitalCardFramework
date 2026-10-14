import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createRemoteAccessProvider,validateAccessProviderResponse} from '../src/remote-access-provider.js';
import {PERMISSIONS} from '../src/access.js';

const python=process.env.PYTHON??'python3',go=process.env.GO??'go';
const pythonSource=fileURLToPath(new URL('../examples/plugins/python-access-provider.py',import.meta.url));
const goSource=fileURLToPath(new URL('../examples/plugins/go-access-provider/main.go',import.meta.url));
const providerId='example.access',identity={issuer:'https://issuer.test',subject:'collector',userId:'collector'};
const record=(extra={})=>({...identity,status:'allowed',role:'player',permissions:['art.import'],...extra});
const request=()=>({protocol:'digital-card-access-provider@1',operation:'resolveAccess',scope:'access',requestId:randomUUID(),providerId,grantId:randomUUID(),generation:1,deadline:Date.now()+30000,...identity});
const environment={GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off'};
function compile(executable,args,env){
 return new Promise((fulfill,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,...environment,...env}});let diagnostics='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Access example compilation timed out'));},60000);
  const collect=data=>{diagnostics+=data;if(Buffer.byteLength(diagnostics)>16384){child.kill();reject(Error('Compiler diagnostics exceed limit'));}};
  child.stdout.on('data',collect);child.stderr.on('data',collect);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);code===0?fulfill():reject(Error('Access example compilation failed: '+diagnostics));});
 });
}
async function start(command,args,env){
 const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,...environment,...env}});let diagnostics='',stdout='';
 child.stderr.on('data',chunk=>{diagnostics+=chunk;if(Buffer.byteLength(diagnostics)>16384)child.kill();});
 const port=await new Promise((fulfill,reject)=>{
  let settled=false;const timer=setTimeout(()=>finish(reject,Error('Access provider startup timed out')),10000);
  const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);fn(value);};
  child.once('error',error=>finish(reject,error));child.once('exit',()=>finish(reject,Error('Access provider exited before readiness')));
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.includes('\n')){const port=Number(stdout.trim());Number.isSafeInteger(port)&&port>0&&port<=65535?finish(fulfill,port):finish(reject,Error('Invalid provider readiness'));}if(stdout.length>100)child.kill();});
 }).catch(async error=>{if(child.exitCode===null&&child.pid){const exited=once(child,'exit');child.kill();await exited;}throw error;});
 return {url:'http://127.0.0.1:'+port+'/access-provider',async stop(){if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}return diagnostics;}};
}
async function post(url,value,token,status=200){
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:typeof value==='string'?value:JSON.stringify(value),signal:AbortSignal.timeout(10000)});
 assert.equal(response.status,status);assert(Number(response.headers.get('content-length'))<=32768);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();
}

test('independent Python and compiled Go access services resolve bounded operator-owned authorization through the real bridge',async t=>{
 const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'access-provider-'));
 t.after(async()=>{assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});});
 const executable=join(directory,process.platform==='win32'?'access-provider.exe':'access-provider');
 await compile(go,['build','-trimpath','-o',executable,goSource],{GOCACHE:join(directory,'go-cache')});
 for(const [language,command,args] of [['python',python,[pythonSource]],['go',executable,[]]])await t.test(language,async()=>{
  const token=randomUUID()+randomUUID(),filename=join(directory,language+'.json');
  const replace=async records=>{await writeFile(filename+'.next',typeof records==='string'?records:JSON.stringify({identities:records}));await rename(filename+'.next',filename);};
  await replace([record()]);const service=await start(command,[...args,filename],{ACCESS_PROVIDER_TOKEN:token,ACCESS_PROVIDER_ID:providerId});
  const options={providerId,url:service.url,token,allowLoopbackHttp:true,allowRoles:['player'],allowPermissions:['art.import'],maxResponseBytes:32768};
  const bridge=createRemoteAccessProvider(options);let diagnostics;
  try{
   const input=Object.freeze({...identity,id_token:'ambient-login-credential',role:'admin',permissions:PERMISSIONS});
   assert.deepEqual(await bridge.resolveAccess(input),{role:'player',permissions:['art.import']});
   const direct=request(),allowed=await post(service.url,direct,token);validateAccessProviderResponse(allowed);assert.deepEqual(allowed,{...direct,status:'allowed',role:'player',permissions:['art.import']});
   assert(!JSON.stringify(allowed).includes(token));assert(!JSON.stringify(allowed).includes('ambient-login-credential'));
   for(const key of ['issuer','subject','userId']){
    const unknown={...identity,[key]:'unconfigured'};assert.equal(await bridge.resolveAccess(unknown),null);
    const deniedRequest={...request(),...unknown};assert.deepEqual(await post(service.url,deniedRequest,token),{...deniedRequest,status:'denied'});
   }
   // Subject alone is insufficient: each issuer/user mapping is operator-owned.
   await replace([record(),record({issuer:'https://other-issuer.test',permissions:[]})]);
   assert.deepEqual(await bridge.resolveAccess({...identity,issuer:'https://other-issuer.test'}),{role:'player',permissions:[]});
   await replace([record({permissions:['art.import','art.review']})]);assert.equal(await bridge.resolveAccess(identity),null);
   await replace([record({permissions:[]})]);assert.deepEqual(await bridge.resolveAccess(identity),{role:'player',permissions:[]});
   for(const status of ['denied','disabled']){
    await replace([{...identity,status}]);assert.equal(await bridge.resolveAccess(identity),null);
    const query=request();assert.deepEqual(await post(service.url,query,token),{...query,status});
   }
   await replace([record({role:'admin',permissions:PERMISSIONS})]);assert.equal(await bridge.resolveAccess(identity),null);
   const approvedAdmin=createRemoteAccessProvider({...options,allowRoles:['admin'],allowPermissions:PERMISSIONS});
   try{assert.deepEqual(await approvedAdmin.resolveAccess(identity),{role:'admin',permissions:PERMISSIONS});}finally{approvedAdmin.close();}
   await replace([record()]);bridge.setEnabled(false);assert.equal(await bridge.resolveAccess(identity),null);bridge.setEnabled(true);assert.deepEqual(await bridge.resolveAccess(identity),{role:'player',permissions:['art.import']});
   const unauthorized=request(),error=await post(service.url,unauthorized,'incorrect-credential',401);assert.deepEqual(error,{...unauthorized,status:'error',errorCode:'unauthenticated'});validateAccessProviderResponse(error);
   const badBridge=createRemoteAccessProvider({...options,token:randomUUID()});try{assert.equal(await badBridge.resolveAccess(identity),null);}finally{badBridge.close();}
   for(const change of [{role:'admin'},{permissions:PERMISSIONS},{context:{}},{userId:'constructor'},{subject:'invalid\nsubject'},{issuer:''},{generation:true},{generation:0},{deadline:9007199254740992},{requestId:'invalid'},{providerId:'other.access'}])assert.deepEqual(await post(service.url,{...request(),...change},token,400),{});
   const valid=request(),encoded=JSON.stringify(valid);
   assert.deepEqual(await post(service.url,encoded.slice(0,-1)+',"userId":"collector"}',token,400),{});
   assert.deepEqual(await post(service.url,{...valid,subject:'\ud800'},token,400),{});
   assert.deepEqual(await post(service.url,' '.repeat(65537),token,400),{});
   const unicode={issuer:'https://issuer.test/世界',subject:'收藏者😀',userId:'unicode'};
   await replace([{...unicode,status:'allowed',role:'player',permissions:['art.import']}]);assert.deepEqual(await bridge.resolveAccess(unicode),{role:'player',permissions:['art.import']});
   await replace('{"identities":[');assert.equal(await bridge.resolveAccess(identity),null);const unavailable=request();assert.deepEqual(await post(service.url,unavailable,token,503),{...unavailable,status:'error',errorCode:'unavailable'});
   await replace([record()]);assert.deepEqual(await bridge.resolveAccess(identity),{role:'player',permissions:['art.import']});
   const expired={...request(),deadline:1};assert.deepEqual(await post(service.url,expired,token,503),{...expired,status:'error',errorCode:'unavailable'});
  }finally{bridge.close();diagnostics=await service.stop();}
  assert.equal(diagnostics,'');assert(!diagnostics.includes(token));
 });
});
