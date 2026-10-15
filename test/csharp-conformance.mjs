import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createPluginHost,pluginCommands} from '../src/plugin-host.js';
import {createRemoteTransferPolicy} from '../src/remote-transfer-policy.js';
import {createRemoteActionHandler} from '../src/remote-actions.js';
import {CardFramework} from '../src/core.js';
import {SQLiteStore} from '../src/sqlite.js';
import {fixture,admin} from './helpers.js';

const dotnet=process.env.DOTNET??'dotnet';
const project=fileURLToPath(new URL('../examples/plugins/csharp-conformance/Conformance.csproj',import.meta.url));
const config=fileURLToPath(new URL('../examples/plugins/csharp-conformance/NuGet.Config',import.meta.url));
const root=await mkdtemp(join(tmpdir(),'dc-csharp-conformance-')),output=join(root,'output'),intermediate=join(root,'obj')+'/',assembly=join(output,'Conformance.dll');
const runtimeEnv={DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'1',DOTNET_ADD_GLOBAL_TOOLS_TO_PATH:'false',DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE:'true',DOTNET_GENERATE_ASPNET_CERTIFICATE:'false',DOTNET_CLI_HOME:join(root,'dotnet-home'),NUGET_PACKAGES:join(root,'packages')};
const token='synthetic-csharp-conformance-credential',providerId='example.transfer',processes=new Set(),checks=[];
const records=join(root,'actors.json'),journal=join(root,'receipts.json');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function processResult(executable,args,{input='',env={}}={}){
  const child=spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,...runtimeEnv,...env}});processes.add(child);let out='',errors='';
  child.stdout.on('data',part=>{out+=part;assert(out.length<2097152);});child.stderr.on('data',part=>{errors+=part;assert(errors.length<1048576);});
  const exited=once(child,'exit');child.stdin.end(input);const [code]=await exited;processes.delete(child);return {code,out,errors};
}
async function stop(child){if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}processes.delete(child);}
async function start(path=journal,extra={}){
  const child=spawn(dotnet,[assembly,'serve',records,path],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,...runtimeEnv,PLUGIN_TOKEN:token,TRANSFER_POLICY_PROVIDER_ID:providerId,...extra}});processes.add(child);let errors='';child.stderr.on('data',part=>errors+=part);
  const port=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('C# service readiness timed out: '+errors)),15000);const finish=(fn,value)=>{clearTimeout(timer);fn(value);};child.once('error',error=>finish(reject,error));child.once('exit',()=>finish(reject,Error('C# service exited: '+errors)));child.stdout.on('data',part=>{output+=part;if(output.includes('\n')){const port=Number(output.trim());assert(Number.isInteger(port)&&port>0&&port<65536);finish(resolve,port);}});});return {child,url:'http://127.0.0.1:'+port};
}
async function post(service,path,value,status=200,headers={}){
  const body=typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value);
  const response=await fetch(service.url+path,{method:'POST',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json',authorization:'Bearer '+token,...headers},body});assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();
}
async function control(){
  const x=fixture();let lose,revoke=false,delegation;const calls={};
  const adapters=Object.fromEntries(['inventoryPage','operatorCatalog','quote','commandIntents','registerCommandIntent','commandIntent','executeCommandIntentAsync','acknowledgeCommandIntent'].map(name=>[name,(...args)=>x.core[name](...args)]));
  let host;for(const [method,command]of [['registerCommandIntent','purchase.register'],['executeCommandIntentAsync','purchase.execute'],['acknowledgeCommandIntent','purchase.acknowledge']]){const original=adapters[method];adapters[method]=async(...args)=>{calls[command]=(calls[command]??0)+1;const result=await original(...args);if(lose===command)lose='drop';if(revoke&&command==='purchase.execute'){revoke=false;host.setGrants('example.reader',['inventory.read']);}return result;};}
  host=createPluginHost({framework:adapters,plugins:[{id:'example.reader',version:'1.0.0',token,commands:[...pluginCommands],userIds:[x.a.id,x.b.id]}],resolveActor:id=>id===x.a.id?x.alice:id===x.b.id?x.bob:null});
  const server=createServer(async(req,res)=>{const end=res.end.bind(res);res.end=(...args)=>{if(lose==='drop'){lose=undefined;res.flushHeaders();res.write('{"protocol":',()=>res.destroy());return res;}return end(...args);};if(!await host.handle(req,res)){res.statusCode=404;res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const issue=()=>host.issueDelegation({pluginId:'example.reader',actor:x.alice,commands:[...pluginCommands]});delegation=issue();const base={PLUGIN_CONTROL_URL:'http://127.0.0.1:'+server.address().port,PLUGIN_TOKEN:token};
  const call=async(command,input={},options={})=>{const result=await processResult(dotnet,[assembly,'client'],{input:options.raw??JSON.stringify({command,input}),env:{...base,PLUGIN_DELEGATION:options.delegation??delegation,...options.env}});assert(!result.out.includes(token)&&!result.errors.includes(token));assert(!result.out.includes(delegation)&&!result.errors.includes(delegation));if(options.reject){assert.notEqual(result.code,0);assert.equal(result.out,'');return;}assert.equal(result.code,0,result.errors);assert.equal(host.status()[0].sessions,0);return JSON.parse(result.out);};
  try{
    for(const env of [{PLUGIN_ID:'forged.plugin'},{PLUGIN_VERSION:'2.0.0'},{PLUGIN_TOKEN:'incorrect-service-credential'}])await call('inventory.read',{}, {env,reject:true});
    await call('inventory.read',{}, {raw:'{"command":"inventory.read","command":"catalog.read","input":{}}',reject:true});
    const initial=x.core.wallet(x.alice).credits,quote=await call('purchase.quote',{productId:'common',quantity:1});
    lose='purchase.register';await call('purchase.register',quote,{reject:true});assert.equal(calls['purchase.register'],1);let heads=await call('purchase.pending');assert.equal(heads.items.length,1);const intent=heads.items[0];assert.equal(typeof intent.input.key,'string');assert.equal(x.core.wallet(x.alice).credits,initial);
    lose='purchase.execute';await call('purchase.execute',{id:intent.id},{reject:true});assert.equal(calls['purchase.execute'],1);assert.equal(x.core.wallet(x.alice).credits,initial-10);const recovered=await call('purchase.execute',{id:intent.id});assert.deepEqual(await call('purchase.execute',{id:intent.id}),recovered);assert.equal(recovered.result.packs.length,1);assert.equal(x.core.wallet(x.alice).credits,initial-10);
    const bob=host.issueDelegation({pluginId:'example.reader',actor:x.bob,commands:['purchase.execute']});await call('purchase.execute',{id:intent.id},{delegation:bob,reject:true});const foreign=x.core.registerCommandIntent(x.alice,{command:'preferences',input:{}});await call('purchase.execute',{id:foreign.id},{reject:true});
    lose='purchase.acknowledge';await call('purchase.acknowledge',{id:intent.id},{reject:true});assert.equal(calls['purchase.acknowledge'],1);assert.deepEqual(await call('purchase.pending'),{items:[]});assert.deepEqual(await call('purchase.acknowledge',{id:intent.id}),{id:intent.id,state:'acknowledged'});
    await call('purchase.register',{...quote,key:'caller-selected-key'},{reject:true});await call('purchase.register',{...quote,adminRevision:undefined},{reject:true});
    const failed=await call('purchase.register',{...quote,catalogVersion:quote.catalogVersion+1});await call('purchase.execute',{id:failed.id},{reject:true});assert.equal((await call('purchase.pending')).items[0].state,'failed');await call('purchase.acknowledge',{id:failed.id});
    const next=await call('purchase.register',await call('purchase.quote',{productId:'common',quantity:1}));const before=calls['purchase.execute'];revoke=true;await call('purchase.execute',{id:next.id},{reject:true});assert.equal(calls['purchase.execute'],before+1);assert.equal(x.core.wallet(x.alice).credits,initial-20);await call('purchase.pending',{}, {reject:true});host.setGrants('example.reader',[...pluginCommands]);delegation=issue();const restored=await call('purchase.execute',{id:next.id});assert.equal(restored.result.packs.length,1);assert.equal(x.core.wallet(x.alice).credits,initial-20);assert.equal(x.core.audit(admin).ok,true);
    checks.push('C# handshake/version/credential and scoped commands; malformed input, lost registration/execution/acknowledgment, original replay, account/command isolation, failed intent and actual live grant revocation after commit');
  }finally{host.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));x.core.close();}
}
async function hook(service){
  const remote=createRemoteTransferPolicy({scope:'transfer',providerId,url:service.url+'/transfer-policy',token,allowLoopbackHttp:true});
  const input=()=>({protocol:'digital-card-transfer-policy@1',operation:'canTransfer',scope:'transfer',phase:'review',requestId:randomUUID(),...remote.grant(),commandId:'a'.repeat(64),inputDigest:'b'.repeat(64),snapshotDigest:'c'.repeat(64),deadline:Date.now()+30000,context:{channel:'trade',legs:[{fromUserId:'alice',toUserId:'bob',copyIds:[randomUUID()],versions:[1]}]}});
  try{const request=input(),echo=structuredClone(request);delete echo.context;assert.deepEqual(await remote.evaluate(request),{...echo,status:'allowed'});const denied=input();denied.context.legs[0].toUserId='other';assert.equal((await remote.evaluate(denied)).status,'denied');
    for(const patch of [{providerId:'other'},{operation:'pay'},{generation:true},{snapshotDigest:'bad'},{context:null},{phase:null},{context:{...request.context,channel:null}},{extraAuthority:true}])await post(service,'/transfer-policy',{...request,...patch},400);
    await post(service,'/transfer-policy',request,403,{authorization:'Bearer revoked-fixture-credential'});await post(service,'/transfer-policy','{"protocol":1,"protocol":2}',400);
    const arrived=deferred(),release=deferred();const proxy=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const response=await fetch(service.url+'/transfer-policy',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:Buffer.concat(chunks)});assert.equal(response.status,200);const body=Buffer.from(await response.arrayBuffer());arrived.resolve();await release.promise;res.writeHead(200,{'content-type':'application/json'});res.end(body);});await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const late=createRemoteTransferPolicy({scope:'transfer',providerId,url:'http://127.0.0.1:'+proxy.address().port,token,allowLoopbackHttp:true});
    try{const pending=late.evaluate({...input(),...late.grant()});const rejected=assert.rejects(pending,error=>error.code==='POLICY_DISABLED');await arrived.promise;late.setEnabled(false);release.resolve();await rejected;}finally{release.resolve();late.close();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
    checks.push('C# canTransfer real bridge allow/deny, strict identities and malformed input, credential refusal and live provider disable after real response');
  }finally{remote.close();}
}
async function events(initialService){
  let service=initialService,core,store,lose=true,now=Date.parse('2026-10-01T00:00:00Z');const path=join(root,'framework.sqlite'),clock=()=>new Date(now).toISOString(),attempts=[];
  const subscriptions=[{id:'opened-only',handler:'example.record',events:['card.opened']}];
  const handler=job=>createRemoteActionHandler({url:service.url+'/actions',pluginId:'example.receiver',handlerId:'example.record',token,fetchImpl:async(...args)=>{attempts.push(JSON.parse(args[1].body));const response=await fetch(...args);if(lose){lose=false;assert.equal(response.status,200);await response.arrayBuffer();throw Error('Consumed acknowledgment lost');}return response;}})(job);
  const options={clock,eventSubscriptions:subscriptions,actionOptions:{retryMs:1000},actionHandlers:{'example.record':handler}};
  try{store=new SQLiteStore(path);const x=fixture({store,...options});core=x.core;const copy=x.open()[0],job=core.actionJobs(admin).items[0];assert.equal(core.actionJobs(admin).total,1);assert.equal((await core.dispatchActions(admin,{limit:1}))[0].status,'pending');const saved=JSON.parse(await readFile(journal));assert.equal(Object.keys(saved.receipts).length,1);const receipt=saved.receipts[job.id];assert.equal(receipt.payload.source.eventId,receipt.payload.params.event.id);assert.equal(receipt.payload.params.event.data.copyId,copy.id);assert.equal(receipt.payload.beneficiaryId,x.alice.userId);assert.equal(core.fulfillments(x.bob).total,0);
    core.close();core=null;await stop(service.child);service=await start();now+=2000;store=new SQLiteStore(path);core=new CardFramework({store,...options});assert.equal((await core.dispatchActions(admin,{limit:1}))[0].status,'succeeded');assert.deepEqual(attempts[1],attempts[0]);assert.deepEqual(JSON.parse(await readFile(journal)),saved);assert.equal(core.inventory(x.alice).length,1);assert.equal(core.inventory(x.bob).length,0);assert.equal(core.audit(admin).ok,true);
    const golden=JSON.parse(await readFile(new URL('./fixtures/action-delivery.json',import.meta.url)));const send=(value,status=200,headers={})=>post(service,'/actions',value,status,{'idempotency-key':golden.jobId,...headers});await send(golden);await send(JSON.stringify(golden).replace('1.25','1.250'));await send({...golden,params:{...golden.params,label:'changed'}},409);
    for(const patch of [{protocol:'wrong'},{pluginId:'wrong'},{handlerId:'wrong'},{actor:{role:'admin'}},{source:null},{params:[]}])await send({...golden,...patch},400);
    await send(golden,403,{authorization:'Bearer revoked-fixture-credential'});await send(golden,400,{'idempotency-key':'forged-job'});await send('{"protocol":1,"protocol":2}',400);await send(Buffer.from([0xff,0xfe]),400);await send(JSON.stringify(golden).replace('1.25','1e4000'),400);await send(JSON.stringify(golden).replace('1.25','"\\ud800"'),400);
    const boundary='b'.repeat(128),unicode={...golden,jobId:'unicode-beneficiary',beneficiaryId:'外部:account/自由 𝄞'},reserved={...golden,jobId:'__proto__'};
    await send({...golden,jobId:'b'.repeat(129)},400,{'idempotency-key':'b'.repeat(129)});await send({...golden,jobId:'𝄞'.repeat(65)},400);
    await send({...golden,jobId:boundary},200,{'idempotency-key':boundary});await send(unicode,200,{'idempotency-key':unicode.jobId});await send(reserved,200,{'idempotency-key':reserved.jobId});
    const final=JSON.parse(await readFile(journal));assert.equal(Object.keys(final.receipts).length,5);await stop(service.child);service=await start(journal,{PLUGIN_MAX_RECEIPTS:'1'});await send(golden);await send({...golden,jobId:boundary},200,{'idempotency-key':boundary});await send(unicode,200,{'idempotency-key':unicode.jobId});await send(reserved,200,{'idempotency-key':reserved.jobId});await send({...golden,jobId:'capacity-refused'},507,{'idempotency-key':'capacity-refused'});assert.deepEqual(JSON.parse(await readFile(journal)),final);
    checks.push('C# committed event scope and stable job/event/beneficiary; consumed reply loss, framework and receiver restart, one durable receipt, golden Unicode/exact decimal replay, malformed/forged/conflicting terms and retained capacity');
  }finally{core?.close();await stop(service.child);}
}
async function byteCapacity(){
  const path=join(root,'byte-capacity.json'),limit=4194304;
  const canonical=value=>value&&typeof value==='object'?(Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}'):JSON.stringify(value);
  const make=jobId=>{const payload={protocol:'digital-card-action@1',pluginId:'example.receiver',handlerId:'example.record',jobId,beneficiaryId:'collector',source:{type:'fixture'},params:{blob:'x'.repeat(60000)}};return {digest:createHash('sha256').update(canonical(payload)).digest('hex'),payload};};
  const receipts=Object.fromEntries(Array.from({length:69},(_,n)=>{const key='byte-known-'+n;return [key,make(key)];})),saved=JSON.stringify({version:1,receipts}),candidate=make('byte-refused');
  assert(Buffer.byteLength(saved)<=limit);assert(Buffer.byteLength(JSON.stringify({version:1,receipts:{...receipts,'byte-refused':candidate}}))>limit);await writeFile(path,saved);const service=await start(path);
  try{await post(service,'/actions',candidate.payload,507,{'idempotency-key':candidate.payload.jobId});const known=receipts['byte-known-0'].payload;await post(service,'/actions',known,200,{'idempotency-key':known.jobId});await post(service,'/actions',candidate.payload,507,{'idempotency-key':candidate.payload.jobId});assert.equal(await readFile(path,'utf8'),saved);checks[checks.length-1]+='; exact UTF16 job bounds, Unicode beneficiary/reserved job replay and deterministic byte-capacity refusal retaining original replay';}finally{await stop(service.child);}
}
async function numericReadback(){
  const path=join(root,'numeric-readback.json'),known={protocol:'digital-card-action@1',pluginId:'example.receiver',handlerId:'example.record',jobId:'numeric-known',beneficiaryId:null,source:{type:'fixture'},params:{}},candidate={...known,jobId:'numeric-candidate',params:{number:0}},raw=JSON.stringify(candidate).replace('"number":0','"number":'+'1'.repeat(200)+'e400');let service=await start(path);
  try{await post(service,'/actions',known,200,{'idempotency-key':known.jobId});await post(service,'/actions',raw,200,{'idempotency-key':candidate.jobId});await post(service,'/actions',known,200,{'idempotency-key':known.jobId});await stop(service.child);service=await start(path);await post(service,'/actions',known,200,{'idempotency-key':known.jobId});await post(service,'/actions',raw,200,{'idempotency-key':candidate.jobId});checks[checks.length-1]+='; numeric journal admission remains restart-readable';}finally{await stop(service.child);}
}
async function aggregateReadback(){
  const path=join(root,'aggregate-readback.json'),limit=1000000;
  const canonical=value=>value&&typeof value==='object'?(Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}'):JSON.stringify(value);
  const count=value=>1+(value&&typeof value==='object'?Object.values(value).reduce((sum,item)=>sum+count(item),0):0);
  const make=jobId=>{const payload={protocol:'digital-card-action@1',pluginId:'example.receiver',handlerId:'example.record',jobId,beneficiaryId:null,source:{type:'fixture'},params:{numbers:Array(19000).fill(0)}};assert(count(payload)<20000);return {digest:createHash('sha256').update(canonical(payload)).digest('hex'),payload};};
  const receipts=Object.fromEntries(Array.from({length:52},(_,n)=>{const key='nodes-known-'+n;return [key,make(key)];})),saved=JSON.stringify({version:1,receipts}),candidate=make('nodes-refused');
  assert(count({version:1,receipts})<limit);assert(count({version:1,receipts:{...receipts,'nodes-refused':candidate}})>limit);assert(Buffer.byteLength(JSON.stringify({version:1,receipts:{...receipts,'nodes-refused':candidate}}))<4194304);await writeFile(path,saved);let service=await start(path);
  try{const known=receipts['nodes-known-0'].payload;await post(service,'/actions',candidate.payload,507,{'idempotency-key':candidate.payload.jobId});await post(service,'/actions',known,200,{'idempotency-key':known.jobId});await post(service,'/actions',candidate.payload,507,{'idempotency-key':candidate.payload.jobId});assert.equal(await readFile(path,'utf8'),saved);await stop(service.child);service=await start(path);await post(service,'/actions',known,200,{'idempotency-key':known.jobId});assert.equal(await readFile(path,'utf8'),saved);checks[checks.length-1]+='; aggregate journal-node refusal preserves original replay and restart';}finally{await stop(service.child);}
}
try{
  await mkdir(output);await writeFile(records,JSON.stringify({actors:[{id:'alice',recipientIds:['bob'],allowListingReservation:true},{id:'bob',recipientIds:['alice'],allowListingReservation:false}]}));
  const properties=['-p:BaseIntermediateOutputPath='+intermediate,'-p:MSBuildProjectExtensionsPath='+intermediate,'-p:UseAppHost=false','-p:UseSharedCompilation=false','-p:NuGetAudit=false'];
  const restore=await processResult(dotnet,['restore',project,'--configfile',config,...properties]);assert.equal(restore.code,0,restore.out+restore.errors);
  const compile=await processResult(dotnet,['build',project,'--no-restore','--configuration','Release','--output',output,...properties]);assert.equal(compile.code,0,compile.out+compile.errors);await control();const service=await start();await hook(service);await events(service);await byteCapacity();await numericReadback();await aggregateReadback();
  console.log(JSON.stringify({language:'C#',checks,status:'passed'},null,2));
}finally{for(const child of processes)await stop(child);if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe conformance cleanup target');await rm(root,{recursive:true,force:true});}
