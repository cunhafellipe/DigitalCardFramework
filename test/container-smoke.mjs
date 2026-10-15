import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import https from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {sampleCatalog} from '../examples/catalog.js';

const tag='dc-smoke-'+randomBytes(6).toString('hex'),app=tag+'-app',edge=tag+'-edge',network=tag+'-net',volume=tag+'-data',root=mkdtempSync(join(tmpdir(),'dc-container-'));
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
const inspect=name=>JSON.parse(docker('inspect',name))[0];
const request=(port,path)=>new Promise((yes,no)=>{
  const req=https.get({hostname:'127.0.0.1',port,servername:'localhost',headers:{host:'localhost'},path,rejectUnauthorized:false,timeout:5000},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>yes({status:res.statusCode,headers:res.headers,body}));});req.on('error',no);req.on('timeout',()=>req.destroy(Error('Proxy request timeout')));
});
async function healthy(){for(let i=0;i<60;i++){const state=inspect(app).State;if(state.Health?.Status==='healthy')return;assert(state.Running,'Container exited before health');await delay(500);}throw Error('App health deadline');}
try{
  chmodSync(root,0o755);
  writeFileSync(join(root,'catalog.json'),JSON.stringify(sampleCatalog));
  writeFileSync(join(root,'key.txt'),randomBytes(32).toString('hex'),{mode:0o644});
  // Only this disposable test mounts the trusted fixture module; it is not in the image.
  writeFileSync(join(root,'host.mjs'),`export function createFrameworkOptions(){return {bindings:{'demo.code':()=>({code:'SYNTHETIC'})}};}
export const identityProvider={begin:async()=>({url:'https://issuer.test/authorize',data:{}}),finish:async()=>({issuer:'https://issuer.test',subject:'fixture'})};
export async function handleStatic(req,res,{framework}){if(req.url!=='/fixture/persist')return false;const user=await framework.registerUser({role:'admin'},{provider:'container-fixture',subject:'collector',displayName:'Collector'});const result=await framework.setPreferences({userId:user.id},{key:'container-original',inventoryVisibility:'private'});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result,audit:await framework.audit({role:'admin'})}));return true;}`);
  docker('network','create',network);docker('volume','create',volume);
  docker('run','-d','--name',app,'--network',network,'--network-alias','cards','--read-only','--tmpfs','/tmp','--cap-drop','ALL','--security-opt','no-new-privileges:true',
    '--mount',`type=volume,src=${volume},dst=/app/data`,'--mount',`type=bind,src=${root},dst=/content,readonly`,
    '-e','SITE_ORIGIN=https://localhost','-e','STATE_ENCRYPTION_KEY_FILE=/content/key.txt','-e','CATALOG_FILE=/content/catalog.json','-e','HOST_MODULE=/content/host.mjs',
    '--health-interval','1s','--health-start-period','0s','digital-card-framework:ci');
  await healthy();const config=inspect(app);assert.equal(config.Config.User,'node');assert.equal(config.HostConfig.ReadonlyRootfs,true);assert.deepEqual(config.HostConfig.PortBindings,{});
  docker('run','-d','--name',edge,'--network',network,'-p','127.0.0.1::443','-e','SITE_HOST=localhost','--mount',`type=bind,src=${resolve('deploy/Caddyfile')},dst=/etc/caddy/Caddyfile,readonly`,'caddy:2');
  const port=Number(inspect(edge).NetworkSettings.Ports['443/tcp'][0].HostPort);let ready;
  for(let i=0;i<60;i++){try{ready=await request(port,'/healthz');if(ready.status===200)break;}catch{}await delay(500);}assert.equal(ready?.status,200);assert.deepEqual(JSON.parse(ready.body),{ok:true});
  const home=await request(port,'/');assert.equal(home.status,200);assert.match(home.body,/Card Atelier/);assert.match(home.headers['content-security-policy'],/frame-ancestors 'none'/);
  assert.equal((await request(port,'/api/me')).status,401);assert.equal((await request(port,'/demo/session')).status,404);assert.equal((await request(port,'/data/production.sqlite')).status,404);
  const first=await request(port,'/fixture/persist');assert.equal(first.status,200);assert.equal(JSON.parse(first.body).audit.ok,true);
  docker('stop','--time','15',app);assert.equal(inspect(app).State.ExitCode,0);const down=await request(port,'/healthz');assert.equal(down.status,502);
  docker('start',app);await healthy();const replay=await request(port,'/fixture/persist');assert.equal(replay.status,200);assert.deepEqual(JSON.parse(replay.body),JSON.parse(first.body));
  docker('stop','--time','15',app);assert.equal(inspect(app).State.ExitCode,0);
  console.log(JSON.stringify({checks:['non-root read-only app with private network port','supplied Caddy configuration with local TLS','health, authentication, demo and private-file boundaries','clean stop and same-volume original-key replay'],passed:true}));
}catch(error){for(const name of [app,edge])try{console.error(docker('logs','--tail','60',name));}catch{}throw error;}
finally{
  for(const name of [edge,app])try{docker('rm','-f',name);}catch{}
  try{docker('network','rm',network);}catch{}try{docker('volume','rm',volume);}catch{}
  assert(resolve(root).startsWith(join(resolve(tmpdir()),'dc-container-')));rmSync(root,{recursive:true,force:true});
}
