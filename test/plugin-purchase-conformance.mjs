import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createPluginHost,pluginCommands,validatePluginMessage} from '../src/plugin-host.js';
import {fixture,admin} from './helpers.js';

const binary=process.argv[2],python=process.argv[3]??'python3';
if(!binary)throw Error('Pass Go plugin-client executable or --python-only, then Python interpreter');
async function nativeClient(raw,environment){
  let session;
  const post=async(path,input,delegated=false)=>{const response=await fetch(environment.PLUGIN_CONTROL_URL+path,{method:'POST',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json',authorization:'Bearer '+environment.PLUGIN_TOKEN,...(delegated?{'X-DC-Delegation':environment.PLUGIN_DELEGATION}:{})},body:JSON.stringify(input)});const result=await response.json();validatePluginMessage(response.ok?path.endsWith('handshake')?'handshakeResponse':path.endsWith('close')?'closeResponse':'commandResponse':'error',result);assert(response.ok);return result;};
  try{const ready=await post('/plugins/handshake',{protocol:'digital-card-plugin@1',pluginId:environment.PLUGIN_ID??'example.reader',version:environment.PLUGIN_VERSION??'1.0.0'});session=ready.sessionId;const input=JSON.parse(raw);assert.deepEqual(Object.keys(input).sort(),['command','input']);const requestId=crypto.randomUUID();const reply=await post('/plugins/commands',{protocol:'digital-card-plugin@1',sessionId:session,requestId,...input},true);assert.equal(reply.requestId,requestId);assert.equal(reply.command,input.command);return {code:0,out:JSON.stringify(reply.result),errors:''};}catch{return {code:1,out:'',errors:'PLUGIN_REQUEST'};}finally{if(session)await post('/plugins/sessions/close',{protocol:'digital-card-plugin@1',sessionId:session}).catch(()=>{});}
}
const clients=[['JavaScript',null,[]],['Python',python,[fileURLToPath(new URL('../examples/plugins/python-plugin-client.py',import.meta.url)),'--command-json']],...(binary==='--python-only'?[]:[['Go',binary,[]]])];
for(const [language,executable,args]of clients)test(language+' durable purchase recovery over authenticated plugin HTTP',async()=>{
  const x=fixture(),credential='public-purchase-control-credential',calls={};let lose,revoke=false;
  const adapters=Object.fromEntries(['inventoryPage','operatorCatalog','quote','commandIntents','registerCommandIntent','commandIntent','executeCommandIntentAsync','acknowledgeCommandIntent'].map(name=>[name,(...args)=>x.core[name](...args)]));
  for(const [method,command]of [['registerCommandIntent','purchase.register'],['executeCommandIntentAsync','purchase.execute'],['acknowledgeCommandIntent','purchase.acknowledge']]){const original=adapters[method];adapters[method]=async(...args)=>{calls[command]=(calls[command]??0)+1;const result=await original(...args);if(lose===command){lose='drop';}if(revoke&&command==='purchase.execute'){revoke=false;host.setGrants('example.reader',['inventory.read']);}return result;};}
  const host=createPluginHost({framework:adapters,plugins:[{id:'example.reader',version:'1.0.0',token:credential,commands:[...pluginCommands],userIds:[x.a.id,x.b.id]}],resolveActor:id=>id===x.a.id?x.alice:id===x.b.id?x.bob:null});
  const server=createServer(async(req,res)=>{const end=res.end.bind(res);res.end=(...args)=>{if(lose==='drop'){lose=undefined;res.flushHeaders();res.write('{"protocol":',()=>res.destroy());return res;}return end(...args);};if(!await host.handle(req,res)){res.statusCode=404;res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const issue=()=>host.issueDelegation({pluginId:'example.reader',actor:x.alice,commands:[...pluginCommands]});let delegation=issue();const url='http://127.0.0.1:'+server.address().port;
  const call=async(command,input={},options={})=>{
    const environment={...process.env,PYTHONDONTWRITEBYTECODE:'1',PLUGIN_CONTROL_URL:url,PLUGIN_TOKEN:credential,PLUGIN_DELEGATION:options.delegation??delegation,...options.env},raw=options.raw??JSON.stringify({command,input});let result;
    if(!executable)result=await nativeClient(raw,environment);else{const child=spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env:environment});let out='',errors='';child.stdout.on('data',value=>out+=value);child.stderr.on('data',value=>errors+=value);const exited=once(child,'exit');child.stdin.end(raw);const [code]=await exited;result={code,out,errors};}const {code,out,errors}=result;assert(!out.includes(credential)&&!errors.includes(credential));assert(!out.includes(delegation)&&!errors.includes(delegation));
    if(options.reject){assert.notEqual(code,0);assert.equal(out,'');return;}
    assert.equal(code,0,errors);assert.equal(host.status()[0].sessions,0);return JSON.parse(out);
  };
  try{
    for(const env of [{PLUGIN_ID:'forged.plugin'},{PLUGIN_VERSION:'2.0.0'},{PLUGIN_TOKEN:'incorrect-service-credential'}])await call('inventory.read',{}, {env,reject:true});await call('inventory.read',{}, {raw:'{',reject:true});
    const start=x.core.wallet(x.alice).credits,quote=await call('purchase.quote',{productId:'common',quantity:1});
    lose='purchase.register';await call('purchase.register',quote,{reject:true});assert.equal(calls['purchase.register'],1);let heads=await call('purchase.pending');assert.equal(heads.items.length,1);const intent=heads.items[0];assert.equal(intent.command,'purchase');assert.equal(typeof intent.input.key,'string');assert.equal(x.core.wallet(x.alice).credits,start);
    const other=await call('purchase.quote',{productId:'rare',quantity:1});assert.deepEqual(await call('purchase.register',other),intent);
    lose='purchase.execute';await call('purchase.execute',{id:intent.id},{reject:true});assert.equal(calls['purchase.execute'],1);assert.equal(x.core.wallet(x.alice).credits,start-10);heads=await call('purchase.pending');assert.equal(heads.items[0].state,'completed');
    const recovered=await call('purchase.execute',{id:intent.id});assert.equal(recovered.result.packs.length,1);assert.deepEqual(await call('purchase.execute',{id:intent.id}),recovered);assert.equal(x.core.wallet(x.alice).credits,start-10);
    const bob=host.issueDelegation({pluginId:'example.reader',actor:x.bob,commands:['purchase.execute']});await call('purchase.execute',{id:intent.id},{delegation:bob,reject:true});
    const foreign=x.core.registerCommandIntent(x.alice,{command:'preferences',input:{}});await call('purchase.execute',{id:foreign.id},{reject:true});
    lose='purchase.acknowledge';await call('purchase.acknowledge',{id:intent.id},{reject:true});assert.equal(calls['purchase.acknowledge'],1);assert.deepEqual(await call('purchase.pending'),{items:[]});assert.deepEqual(await call('purchase.acknowledge',{id:intent.id}),{id:intent.id,state:'acknowledged'});
    await call('purchase.register',{...quote,key:'caller-selected-key'},{reject:true});await call('purchase.register',{...quote,adminRevision:undefined},{reject:true});
    const stale=await call('purchase.register',{...quote,catalogVersion:quote.catalogVersion+1});await call('purchase.execute',{id:stale.id},{reject:true});assert.equal((await call('purchase.pending')).items[0].state,'failed');await call('purchase.execute',{id:stale.id},{reject:true});await call('purchase.acknowledge',{id:stale.id});
    assert.equal(x.core.wallet(x.alice).credits,start-10);const next=await call('purchase.register',await call('purchase.quote',{productId:'common',quantity:1})),before=calls['purchase.execute'];revoke=true;await call('purchase.execute',{id:next.id},{reject:true});assert.equal(calls['purchase.execute'],before+1);assert.equal(x.core.wallet(x.alice).credits,start-20);await call('purchase.pending',{}, {reject:true});host.setGrants('example.reader',[...pluginCommands]);delegation=issue();const recoveredAfterRevocation=await call('purchase.execute',{id:next.id});assert.equal(recoveredAfterRevocation.result.packs.length,1);assert.equal(x.core.wallet(x.alice).credits,start-20);assert.equal(x.core.audit(admin).ok,true);
  }finally{host.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));x.core.close();}
});
