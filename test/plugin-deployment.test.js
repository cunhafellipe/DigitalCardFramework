import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {CardFramework} from '../src/index.js';
import {SQLiteStore} from '../src/sqlite.js';
import {createPluginDeployment,validatePluginManifest} from '../src/plugin-deployment.js';
import {pluginProtocol,pluginCommands} from '../src/plugin-host.js';
import {fixture,admin} from './helpers.js';
const manifest=(id,dependencies=[],version='1.0.0')=>({contract:'digital-card-plugin-manifest@1',id,version,protocol:pluginProtocol,commands:[...pluginCommands],dependencies,configurationSchema:{type:'object',additionalProperties:false,properties:{region:{type:'string',enum:['local']}},required:['region']},runtime:{kind:'external-http',language:'Python',prerequisites:['Python 3'],migration:'none'}});
const installations=(manifests,userId,suffix='initial')=>manifests.map(manifest=>({id:manifest.id,token:'public-deployment-'+suffix+'-'+manifest.id,commands:manifest.commands,userIds:[userId],configuration:{region:'local'}}));
async function setup(manifests,overrides={}){
  const x=fixture(overrides.fixture??{}),installs=installations(manifests,x.a.id),framework={...Object.fromEntries(['inventoryPage','operatorCatalog','quote','commandIntents','registerCommandIntent','commandIntent','executeCommandIntentAsync','acknowledgeCommandIntent'].map(name=>[name,(...args)=>x.core[name](...args)])),...overrides.framework};
  const deployment=createPluginDeployment({manifests,installations:installs,framework,resolveActor:()=>x.alice,...overrides.options});
  const server=createServer(async(req,res)=>{if(!await deployment.handle(req,res)){res.statusCode=404;res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
  const post=async(id,path,value,token=installs.find(install=>install.id===id).token,delegation)=>{const response=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token,...(delegation?{'x-dc-delegation':delegation}:{})},body:JSON.stringify(value)});return {status:response.status,body:await response.json()};};
  const handshake=async(id,version='1.0.0',token)=>post(id,'/plugins/handshake',{protocol:pluginProtocol,pluginId:id,version},token);
  const command=(id,session,delegation,name,input={},token)=>post(id,'/plugins/commands',{protocol:pluginProtocol,sessionId:session.sessionId,requestId:'deployment-fixture',command:name,input},token,delegation);
  const delegate=id=>deployment.issueDelegation({pluginId:id,actor:x.alice,commands:[...pluginCommands]});
  return {...x,installs,framework,deployment,post,handshake,command,delegate,async close(){deployment.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));x.core.close();}};
}
test('manifests reject malformed capabilities, unsafe schemas, conflicting grants and dependencies',()=>{
  const valid=manifest('example.base');assert.deepEqual(validatePluginManifest(valid),valid);
  for(const patch of [{protocol:'other@1'},{commands:['purchase']},{runtime:{...valid.runtime,kind:'exec'}},{configurationSchema:{$ref:'https://remote.example/schema'}},{configurationSchema:{type:'string',pattern:'(a+)+$'}},{dependencies:[{id:valid.id,version:'1.0.0'}]}])assert.throws(()=>validatePluginManifest({...valid,...patch}));
  const base={framework:{inventoryPage:()=>({}),operatorCatalog:()=>({})},resolveActor:()=>null};
  for(const manifests of [[manifest('a',[{id:'missing',version:'1.0.0'}])],[manifest('a',[{id:'b',version:'2.0.0'}]),manifest('b')],[manifest('a',[{id:'b',version:'1.0.0'}]),manifest('b',[{id:'a',version:'1.0.0'}])]])assert.throws(()=>createPluginDeployment({...base,manifests,installations:installations(manifests,'owner')}),error=>error.code==='PLUGIN_DEPLOYMENT');
  const readonly={...valid,commands:['inventory.read']};assert.throws(()=>createPluginDeployment({...base,manifests:[readonly],installations:installations([valid],'owner')}),error=>error.code==='PLUGIN_DEPLOYMENT');
  assert.throws(()=>createPluginDeployment({...base,manifests:[readonly],installations:[{...installations([readonly],'owner')[0],configuration:{region:'unknown'}}]}),error=>error.code==='PLUGIN_DEPLOYMENT');
});
test('dependency readiness is authenticated and transitive; disable revokes dependents',async()=>{
  const x=await setup([manifest('base'),manifest('middle',[{id:'base',version:'1.0.0'}]),manifest('app',[{id:'middle',version:'1.0.0'}])]);
  try{const session=(await x.handshake('app')).body,delegation=x.delegate('app');assert.equal((await x.command('app',session,delegation,'inventory.read')).status,403);await x.handshake('middle');assert.equal((await x.command('app',session,delegation,'inventory.read')).status,403);await x.handshake('base');assert.equal((await x.command('app',session,delegation,'inventory.read')).status,200);assert.equal(x.deployment.status().find(row=>row.pluginId==='app').dependenciesReady,true);
    x.deployment.disable('base');assert(x.deployment.status().every(row=>row.enabled===false));assert.equal((await x.command('app',session,delegation,'inventory.read')).status,403);
    assert.throws(()=>x.deployment.enable('app',{token:x.installs.find(row=>row.id==='app').token}),error=>error.code==='PLUGIN_DEPLOYMENT');
  }finally{await x.close();}
});
test('drain permits original purchase settlement and replacement preserves durable recovery',async()=>{
  const manifests=[manifest('buyer')],x=await setup(manifests);
  try{const session=(await x.handshake('buyer')).body,delegation=x.delegate('buyer'),quote=x.core.quote(x.alice,{productId:'common',quantity:1}),intent=(await x.command('buyer',session,delegation,'purchase.register',quote)).body.result,start=x.core.wallet(x.alice).credits;
    assert.throws(()=>x.deployment.replace({manifests,installations:installations(manifests,x.a.id,'new')}),error=>error.status===409);x.deployment.drain('buyer');assert.equal((await x.command('buyer',session,delegation,'purchase.register',quote)).status,403);const executed=(await x.command('buyer',session,delegation,'purchase.execute',{id:intent.id})).body.result;assert.equal(x.core.wallet(x.alice).credits,start-10);
    const updated=[{...manifest('buyer',[],'2.0.0'),runtime:{...manifests[0].runtime,migration:'operator-required'}}],fresh=installations(updated,x.a.id,'upgrade');assert.throws(()=>x.deployment.replace({manifests:updated,installations:fresh}),error=>error.status===409);assert.equal((await x.command('buyer',session,delegation,'purchase.pending')).status,200);
    x.deployment.replace({manifests:updated,installations:fresh,migrationApproved:['buyer']});assert.equal((await x.command('buyer',session,delegation,'purchase.execute',{id:intent.id})).status,403);const next=(await x.handshake('buyer','2.0.0',fresh[0].token)).body,recovered=await x.command('buyer',next,x.delegate('buyer'),'purchase.execute',{id:intent.id},fresh[0].token);assert.equal(recovered.status,200);assert.deepEqual(recovered.body.result,executed);assert.equal(x.core.wallet(x.alice).credits,start-10);assert.equal(x.core.audit(admin).ok,true);
  }finally{await x.close();}
});
test('replacement waits for active callbacks and late dependency revocation suppresses results',async()=>{
  let enter,release;const entered=new Promise(resolve=>enter=resolve),wait=new Promise(resolve=>release=resolve);const manifests=[manifest('base'),manifest('app',[{id:'base',version:'1.0.0'}])];let x;
  x=await setup(manifests,{framework:{inventoryPage:async(...args)=>{enter();await wait;return x.core.inventoryPage(...args);}}});
  try{await x.handshake('base');const session=(await x.handshake('app')).body,task=x.command('app',session,x.delegate('app'),'inventory.read');await entered;x.deployment.drain('base');assert.throws(()=>x.deployment.replace({manifests,installations:installations(manifests,x.a.id,'replace')}),error=>error.status===409);x.deployment.disable('base');release();const result=await task;assert([403,504].includes(result.status));assert.equal(result.body.result,undefined);
  }finally{release();await x.close();}
});

test('shared diamond dependencies have consistent bounded transitive health and admission',async()=>{
  const manifests=[manifest('base')];let previous=['base'];
  for(let layer=0;layer<18;layer++){const ids=['left'+layer,'right'+layer];for(const id of ids)manifests.push(manifest(id,previous.map(id=>({id,version:'1.0.0'}))));previous=ids;}
  const x=await setup(manifests);
  try{let session;for(const definition of manifests.slice(1)){const reply=await x.handshake(definition.id);assert.equal(reply.status,200);if(definition.id==='left17')session=reply.body;}
    assert.equal(x.deployment.status().find(row=>row.pluginId==='left17').dependenciesReady,false);const delegation=x.delegate('left17');assert.equal((await x.command('left17',session,delegation,'inventory.read')).status,403);
    const base=(await x.handshake('base')).body;assert.equal(x.deployment.status().find(row=>row.pluginId==='left17').dependenciesReady,true);assert.equal((await x.command('left17',session,delegation,'inventory.read')).status,200);
    await x.post('base','/plugins/sessions/close',{protocol:pluginProtocol,sessionId:base.sessionId});assert.equal(x.deployment.status().find(row=>row.pluginId==='left17').dependenciesReady,false);assert.equal((await x.command('left17',session,delegation,'inventory.read')).status,403);
  }finally{await x.close();}
});


test('encrypted deployment upgrade, compatible rollback and uninstall retain the original purchase',{timeout:20000},async t=>{
  const root=mkdtempSync(join(tmpdir(),'deployment-rollback-')),filename=join(root,'framework.sqlite'),encryptionKey=randomBytes(32),original=[manifest('buyer')],x=await setup(original,{fixture:{store:new SQLiteStore(filename,{encryptionKey})}});let closed=false,reopened;
  t.after(async()=>{if(!closed)await x.close();reopened?.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe deployment fixture cleanup target');rmSync(root,{recursive:true,force:true});});
  const session=(await x.handshake('buyer')).body,delegation=x.delegate('buyer'),quote=x.core.quote(x.alice,{productId:'common',quantity:1}),start=x.core.wallet(x.alice).credits;
  const registered=await x.command('buyer',session,delegation,'purchase.register',quote);assert.equal(registered.status,200);const intent=registered.body.result;
  x.deployment.drain('buyer');assert.equal((await x.command('buyer',session,delegation,'purchase.register',quote)).status,403);
  const upgraded=[{...manifest('buyer',[],'2.0.0'),runtime:{...original[0].runtime,migration:'operator-required'}}],fresh=installations(upgraded,x.a.id,'durable-upgrade');
  assert.throws(()=>x.deployment.replace({manifests:upgraded,installations:[{...fresh[0],configuration:{region:'invalid'}}],migrationApproved:['buyer']}),error=>error.code==='PLUGIN_DEPLOYMENT');
  assert.equal((await x.command('buyer',session,delegation,'purchase.pending')).status,200);assert.equal(x.core.commandIntents(x.alice,{command:'purchase'}).items[0].id,intent.id);assert.equal(x.core.wallet(x.alice).credits,start);
  assert.throws(()=>x.deployment.replace({manifests:upgraded,installations:fresh}),error=>error.status===409);
  x.deployment.replace({manifests:upgraded,installations:fresh,migrationApproved:['buyer']});assert.equal((await x.handshake('buyer')).status,403);
  const v2=(await x.handshake('buyer','2.0.0',fresh[0].token)).body,v2delegation=x.delegate('buyer'),execution=await x.command('buyer',v2,v2delegation,'purchase.execute',{id:intent.id},fresh[0].token);assert.equal(execution.status,200);const receipt=execution.body.result;
  assert.equal(x.core.wallet(x.alice).credits,start-quote.price.amount);const packs=x.core.packs(x.alice);assert.equal(packs.length,1);
  x.deployment.drain('buyer');const rollback=installations(original,x.a.id,'durable-rollback');x.deployment.replace({manifests:original,installations:rollback});
  assert.equal((await x.handshake('buyer','2.0.0',fresh[0].token)).status,403);assert.equal((await x.command('buyer',v2,v2delegation,'purchase.pending',{},fresh[0].token)).status,403);
  const v1=(await x.handshake('buyer','1.0.0',rollback[0].token)).body,v1delegation=x.delegate('buyer'),recovered=await x.command('buyer',v1,v1delegation,'purchase.execute',{id:intent.id},rollback[0].token);assert.equal(recovered.status,200);assert.deepEqual(recovered.body.result,receipt);
  x.deployment.drain('buyer');x.deployment.replace({manifests:[],installations:[]});assert.deepEqual(x.deployment.status(),[]);assert.equal((await x.handshake('buyer','1.0.0',rollback[0].token)).status,403);assert.equal((await x.command('buyer',v1,v1delegation,'purchase.execute',{id:intent.id},rollback[0].token)).status,403);
  assert.deepEqual(await x.core.executeCommandIntentAsync(x.alice,{id:intent.id}),receipt);assert.deepEqual(x.core.packs(x.alice),packs);assert.equal(x.core.audit(admin).ok,true);
  await x.close();closed=true;reopened=new CardFramework({store:new SQLiteStore(filename,{encryptionKey})});
  assert.equal(reopened.commandIntents(x.alice,{command:'purchase'}).items[0].id,intent.id);assert.deepEqual(await reopened.executeCommandIntentAsync(x.alice,{id:intent.id}),receipt);assert.deepEqual(reopened.packs(x.alice),packs);assert.equal(reopened.wallet(x.alice).credits,start-quote.price.amount);
  const acknowledged=reopened.acknowledgeCommandIntent(x.alice,{id:intent.id});assert.deepEqual(reopened.acknowledgeCommandIntent(x.alice,{id:intent.id}),acknowledged);assert.deepEqual(reopened.commandIntents(x.alice,{command:'purchase'}),{items:[]});assert.equal(reopened.audit(admin).ok,true);
});
