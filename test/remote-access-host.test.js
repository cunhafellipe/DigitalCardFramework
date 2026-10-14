import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as createPortProbe} from 'node:net';
import {randomBytes} from 'node:crypto';
import {sampleCatalog} from '../examples/catalog.js';

async function freePort(){const probe=createPortProbe();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;}
async function launch(t,extensionSource){
  const directory=mkdtempSync(join(tmpdir(),'dc-access-host-')),extension=join(directory,'extension.mjs'),catalog=join(directory,'catalog.json'),port=await freePort();
  const content=structuredClone(sampleCatalog);delete content.variants.find(variant=>variant.id==='solstice.unique').bindings;
  writeFileSync(extension,extensionSource);writeFileSync(catalog,JSON.stringify(content));
  const child=spawn(process.execPath,[resolve('host/server.js')],{env:{...process.env,SITE_ORIGIN:'https://cards.test',STATE_ENCRYPTION_KEY:randomBytes(32).toString('hex'),STATE_ENCRYPTION_KEY_FILE:'',CODE_VAULT_KEYS:'',CODE_VAULT_KEYS_FILE:'',CODE_INDEX_KEY:'',CODE_INDEX_KEY_FILE:'',CATALOG_FILE:catalog,DATABASE_PATH:join(directory,'state.sqlite'),PRESENTATION_ROOT:join(directory,'presentations'),HOST_MODULE:extension,OPERATOR_SUBJECTS:'["collector"]',PORT:String(port),BIND_ADDRESS:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
  t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}rmSync(directory,{recursive:true,force:true});});
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Production host did not start: '+output)),15000);
    child.stdout.on('data',()=>{if(output.includes('production host ready')){clearTimeout(timer);resolve(true);}});
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);resolve(false);});
  });
  return {child,ready,output:()=>output,base:'http://127.0.0.1:'+port};
}

const identityProvider=`export const identityProvider={async begin(){return {url:'https://issuer.test/authorize',data:{challenge:'access-fixture'}};},async finish(url,flow){if(flow.challenge!=='access-fixture')throw new Error('Invalid challenge');return {issuer:'https://issuer.test',subject:'collector',displayName:'Collector'};}};`;

test('production host reevaluates remote actor grants and credential revocation without administrator fallback',async t=>{
  const token=randomBytes(24).toString('hex'),calls=[];let mode='grant',permissions=['catalog.read','art.import'];
  const service=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);calls.push({input,headers:req.headers});
    assert.equal(req.headers.authorization,'Bearer '+token);res.setHeader('Content-Type','application/json');
    if(mode==='offline'){req.socket.destroy();return;}
    if(mode==='revoked'){res.statusCode=401;res.end(JSON.stringify({...input,status:'error',errorCode:'unauthenticated'}));return;}
    if(mode==='disabled'){res.end(JSON.stringify({...input,status:'disabled'}));return;}
    if(mode==='wrong-identity'){res.end(JSON.stringify({...input,subject:'other',status:'allowed',role:'player',permissions}));return;}
    if(mode==='admin'){res.end(JSON.stringify({...input,status:'allowed',role:'admin',permissions:[]}));return;}
    res.end(JSON.stringify({...input,status:'allowed',role:'player',permissions}));
  });
  await new Promise(resolve=>service.listen(0,'127.0.0.1',resolve));t.after(async()=>{service.closeAllConnections();await new Promise(resolve=>service.close(resolve));});
  const config={providerId:'example.access',url:'http://127.0.0.1:'+service.address().port+'/access-provider',token,allowLoopbackHttp:true,timeoutMs:1000,allowRoles:['player'],allowPermissions:['catalog.read','art.import']};
  const host=await launch(t,identityProvider+'export const remoteAccess='+JSON.stringify(config)+';');assert.equal(await host.ready,true,host.output());
  const request=(path,options={})=>fetch(host.base+path,{...options,redirect:'manual'});
  assert.equal((await request('/healthz')).status,200);assert.equal((await request('/api/me')).status,401);assert.equal(calls.length,0);
  const login=await request('/auth/login'),flow=login.headers.getSetCookie()[0].split(';')[0];
  const callback=await request('/auth/callback',{headers:{cookie:flow}});assert.equal(callback.status,303);
  const cookie=callback.headers.getSetCookie().find(value=>value.startsWith('__Host-dc_session=')).split(';')[0];
  const get=path=>request(path,{headers:{cookie,authorization:'Bearer browser-credential','x-role':'admin'}});
  const me=await (await get('/api/me')).json();assert.equal(me.role,'player');assert.deepEqual(me.permissions,['catalog.read','art.import']);
  assert.equal((await get('/api/operator/catalog')).status,200);
  const upload=()=>request('/presentations/imports',{method:'POST',headers:{cookie,origin:'https://cards.test','x-dc-principal':me.userId,'idempotency-key':'access-fixture','content-type':'application/octet-stream'},body:'invalid-archive'});
  assert.equal((await upload()).status,200);
  permissions=[];assert.equal((await get('/api/operator/catalog')).status,403);assert.equal((await upload()).status,403);assert.deepEqual((await (await get('/api/me')).json()).permissions,[]);
  for(const denied of ['disabled','revoked','offline','wrong-identity','admin']){
    mode=denied;assert.equal((await get('/api/me')).status,401,denied);assert.equal((await upload()).status,401,denied);
    assert.equal((await request('/healthz')).status,200);
  }
  mode='grant';permissions=['catalog.read'];assert.equal((await get('/api/operator/catalog')).status,200);
  for(const {input,headers}of calls){assert.equal(input.issuer,'https://issuer.test');assert.equal(input.subject,'collector');assert.equal(input.userId,me.userId);assert.equal(headers.cookie,undefined);assert.equal(headers.authorization,'Bearer '+token);assert(!JSON.stringify(input).includes(cookie));}
});

test('production host rejects simultaneous direct and remote access configuration',async t=>{
  const host=await launch(t,identityProvider+`export function resolveAccess(){return {role:'admin'};}export const remoteAccess={};`);
  assert.equal(await host.ready,false);assert.notEqual(host.child.exitCode,0);assert.match(host.output(),/ACCESS_PROVIDER_CONFIG|Invalid remote access provider configuration/);
});
