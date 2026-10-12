import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {sampleCatalog} from '../examples/catalog.js';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';

test('actual production entrypoint initializes encrypted state, serves authenticated UI/API and excludes demo login',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'card-host-')),portProbe=createServer();await new Promise(r=>portProbe.listen(0,'127.0.0.1',r));const port=portProbe.address().port;await new Promise(r=>portProbe.close(r));
  const providerToken=randomBytes(24).toString('hex'),providerCalls=[];
  const providerServer=createHttpServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer '+providerToken);let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);providerCalls.push(input);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...input,...(input.operation==='resolve-account'?{status:'resolved',account:'fixture-account'}:{status:'settled',currency:'POINT',amountUnits:'25'})}));});
  await new Promise(r=>providerServer.listen(0,'127.0.0.1',r));
  const providerConfig={'wallet.fixture':{url:'http://127.0.0.1:'+providerServer.address().port,token:providerToken,allowLoopbackHttp:true,currencies:{POINT:{currencyId:'credits'}}}};
  const extension=join(dir,'identity.mjs'),catalog=join(dir,'catalog.json'),database=join(dir,'state.sqlite');writeFileSync(catalog,JSON.stringify(sampleCatalog));
  // Trusted adapter fixture exercises host wiring. Maintained OIDC token verification has separate tests.
  writeFileSync(extension,`export const currencyProviderEndpoints=${JSON.stringify(providerConfig)};export const storageOptions={maxStateBytes:128*1024*1024};export async function handleStatic(req,res,{framework}){if(req.url==='/fixture/stop-worker'){await framework.terminate();res.end('stopped');return true;}if(req.url!=='/fixture/storage-diagnostics')return false;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await framework.storeDiagnostics()));return true;}export function createFrameworkOptions(){return {bindings:{'demo.code':()=>({code:'SYNTHETIC'})},limits:{copiesPerUser:900}};} export const identityProvider={begin:async()=>({url:'https://issuer.test/authorize',data:{challenge:'fixture'}}),finish:async(url,flow)=>{if(flow.challenge!=='fixture')throw new Error();return {issuer:'https://issuer.test',subject:'operator',displayName:'Fixture operator'};}};`);
  const child=spawn(process.execPath,[resolve('host/server.js')],{env:{...process.env,SITE_ORIGIN:'https://cards.test',OIDC_ISSUER:'https://issuer.test',OIDC_CLIENT_ID:'fixture',STATE_ENCRYPTION_KEY:randomBytes(32).toString('hex'),STATE_ENCRYPTION_KEY_FILE:'',OIDC_CLIENT_SECRET_FILE:'',CATALOG_FILE:catalog,DATABASE_PATH:database,HOST_MODULE:extension,OPERATOR_SUBJECTS:'["operator"]',PORT:String(port),BIND_ADDRESS:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
  try{await new Promise((ready,reject)=>{const timeout=setTimeout(()=>reject(new Error('Host did not start: '+output)),10000);const onData=()=>{if(output.includes('production host ready')){clearTimeout(timeout);child.stdout.off('data',onData);ready();}};child.stdout.on('data',onData);child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Host exited '+code+': '+output));});});
    const base='http://127.0.0.1:'+port,request=(path,options={})=>fetch(base+path,{...options,redirect:'manual'});
    const home=await request('/');assert.equal(home.status,200);assert.match(home.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.equal((await request('/healthz')).status,200);assert.equal((await request('/demo/session',{method:'POST'})).status,404);assert.equal((await request('/api/me')).status,401);
    const login=await request('/auth/login');assert.equal(login.status,303);const flow=login.headers.getSetCookie()[0];assert.match(flow,/Secure/);assert.match(flow,/HttpOnly/);const callback=await request('/auth/callback?state=fixture',{headers:{cookie:flow.split(';')[0]}});assert.equal(callback.status,303);const session=callback.headers.getSetCookie().find(c=>c.startsWith('__Host-dc_session=')).split(';')[0];
    const me=await (await request('/api/me',{headers:{cookie:session}})).json();assert.equal(me.role,'admin');assert.equal(me.displayName,'Fixture operator');
    const reconcile={method:'POST',headers:{cookie:session,origin:'https://cards.test','Content-Type':'application/json','X-DC-Principal':me.userId},body:JSON.stringify({providerId:'wallet.fixture',transactionId:'fixture-settlement'})};
    const creditResponse=await request('/api/currency/reconcile',reconcile);assert.equal(creditResponse.status,200);const credit=await creditResponse.json();assert.equal(credit.amount,25);assert.equal(credit.balance,25);
    const replay=await request('/api/currency/reconcile',reconcile);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),credit);assert.equal(providerCalls.length,4);assert.equal(providerCalls[0].userId,me.userId);assert.equal(providerCalls[1].account,'fixture-account');
    const before=await (await request('/fixture/storage-diagnostics')).json();
    const write={method:'POST',headers:{cookie:session,origin:'https://cards.test','Content-Type':'application/json','X-DC-Principal':me.userId},body:JSON.stringify({key:'private',inventoryVisibility:'private'})};assert.equal((await request('/api/preferences',write)).status,200);
    const after=await (await request('/fixture/storage-diagnostics')).json();assert.equal(after.compatibilityMaterializations,before.compatibilityMaterializations);assert(after.decodedQueryRecords-before.decodedQueryRecords<20);assert.equal((await request('/api/operator/audit',{headers:{cookie:session}})).status,200);assert(!output.includes('SYNTHETIC'));
    const writer=new DatabaseSync(database);writer.exec('BEGIN IMMEDIATE');
    let loginComplete=false,queuedLogin;
    try{
      queuedLogin=request('/auth/login').finally(()=>{loginComplete=true;});await delay(80);
      const begun=performance.now(),health=await request('/healthz');assert.equal(health.status,200);assert(performance.now()-begun<300);assert.equal(loginComplete,false);
    }finally{writer.exec('ROLLBACK');writer.close();}
    assert.equal((await queuedLogin).status,303);
    assert.equal((await request('/auth/logout',{method:'POST',headers:{cookie:session,origin:'https://cards.test'}})).status,204);
    assert.equal((await request('/api/me',{headers:{cookie:session}})).status,401);
    assert.equal((await request('/fixture/stop-worker')).status,200);const health=await request('/healthz');assert.equal(health.status,503);assert.deepEqual(await health.json(),{ok:false});const unavailable=await request('/api/me',{headers:{cookie:session}});assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).code,'WORKER_UNAVAILABLE');
  }finally{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}providerServer.closeAllConnections();await new Promise(r=>providerServer.close(r));rmSync(dir,{recursive:true,force:true});}
});


test('production storage budget is validated and applied before admission',async()=>{
  for(const [setting,expected] of [['{maxStateBytes:0}',/Invalid storage capacity/],['{readOnly:true}',/Unsupported storage option/],['{maxStateBytes:1}',/STORAGE_CAPACITY|capacity/]]){
    const dir=mkdtempSync(join(tmpdir(),'host-budget-')),extension=join(dir,'config.mjs'),catalog=join(dir,'catalog.json');
    writeFileSync(extension,'export const storageOptions='+setting+';');writeFileSync(catalog,JSON.stringify(sampleCatalog));
    const child=spawn(process.execPath,[resolve('host/server.js')],{env:{...process.env,SITE_ORIGIN:'https://cards.test',STATE_ENCRYPTION_KEY:randomBytes(32).toString('hex'),STATE_ENCRYPTION_KEY_FILE:'',CODE_VAULT_KEYS:'',CODE_VAULT_KEYS_FILE:'',CODE_INDEX_KEY:'',CODE_INDEX_KEY_FILE:'',CATALOG_FILE:catalog,DATABASE_PATH:join(dir,'state.sqlite'),HOST_MODULE:extension},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    try{const status=await new Promise((resolveExit,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Host configuration was not rejected'));},10000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',status=>{clearTimeout(timer);resolveExit(status);});});assert.notEqual(status,0);assert.match(output,expected);}finally{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}rmSync(dir,{recursive:true,force:true});}
  }
});
