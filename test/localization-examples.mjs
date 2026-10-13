import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {localizationProtocol,localizationKeys,englishMessages,validateLocalizationBundle,createLocalization} from '../src/localization.js';

const python=process.env.PYTHON??'python',go=process.env.GO??'go';
const pythonSource=fileURLToPath(new URL('../examples/plugins/python-localization.py',import.meta.url)),goSource=fileURLToPath(new URL('../examples/plugins/go-localization/main.go',import.meta.url));
function run(executable,args,environment={}){
 return new Promise((fulfill,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off',...environment}});let stdout='',stderr='',settled=false;
  const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value);};
  const timer=setTimeout(()=>{child.kill();finish(reject,Error('Localization generator timed out'));},60000);
  const collect=(name,chunk)=>{if(name==='stdout')stdout+=chunk;else stderr+=chunk;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>65536){child.kill();finish(reject,Error('Localization generator output exceeded its bound'));}};
  child.stdout.on('data',chunk=>collect('stdout',chunk));child.stderr.on('data',chunk=>collect('stderr',chunk));child.once('error',error=>finish(reject,error));child.once('close',code=>code===0?finish(fulfill,{stdout,stderr}):finish(reject,Error('Localization generator failed: '+stderr)));
 });
}
function check(result){
 assert.equal(result.stderr,'');assert(result.stdout.endsWith('\n'));assert(Buffer.byteLength(result.stdout)<=32768);
 const parsed=JSON.parse(result.stdout),bundle=validateLocalizationBundle(parsed);
 assert.equal(bundle.protocol,localizationProtocol);assert.equal(bundle.locale,'es');assert.deepEqual(Object.keys(bundle.messages).sort(),Object.keys(localizationKeys).sort());assert.deepEqual(Object.keys(bundle.messages).sort(),Object.keys(englishMessages).sort());assert(Object.isFrozen(bundle));assert(Object.isFrozen(bundle.messages));
 for(const [key,metadata]of Object.entries(localizationKeys)){
  const value=bundle.messages[key];if(metadata.plural){assert.deepEqual(Object.keys(value).sort(),['one','other']);assert(Object.isFrozen(value));}
  const forms=metadata.plural?Object.values(value):[value];for(const form of forms){const placeholders=[...new Set([...form.matchAll(/\{([a-z][a-zA-Z0-9]*)\}/g)].map(match=>match[1]))].sort();assert.deepEqual(placeholders,metadata.placeholders,key);assert(form.trim().length>0);}
 }
 const local=createLocalization({locale:bundle.locale,messages:bundle.messages});assert.equal(local.text('nav.wallet'),'Cartera');assert.equal(local.text('account.cards',{count:1}),'1 carta');assert.equal(local.text('account.cards',{count:2}),'2 cartas');assert.equal(local.text('shop.review',{count:1,amount:10,currency:'credits'}),'Revisa 1 sobre por 10 credits.');assert.match(local.text('shop.activation',{count:2}),/no confirma la activación/);assert.match(local.text('shop.activationDelivered',{count:1}),/estaba pendiente de activación al entregarse/);assert.match(local.text('allocation.retryOriginal'),/compra original/);assert.match(local.text('packs.replaying'),/Sin cargos adicionales/);
 const expectedNumber=new Intl.NumberFormat('es',{maximumFractionDigits:20}).format(12345.5);assert.equal(local.number(12345.5),expectedNumber);
 assert.equal(local.text('nav.collection'),'Colección');assert.equal(local.text('collection.matchingCopies',{count:1}),'1 copia coincidente');assert.equal(local.text('collection.matchingCopies',{count:2}),'2 copias coincidentes');assert.equal(local.text('inspector.serial',{serial:2,total:100}),'2 de 100');assert.equal(local.text('inspector.piecesMissing',{count:1}),'Falta 1 pieza');assert.equal(local.text('inspector.piecesMissing',{count:2}),'Faltan 2 piezas');assert.equal(local.text('inspector.close'),'Cerrar inspección');assert.match(local.text('inspector.activationPending'),/todavía no puede usarse/);
 parsed.messages['nav.wallet']='Changed';assert.equal(bundle.messages['nav.wallet'],'Cartera');return bundle;
}
test('Python emits a complete validated Spanish collector bundle with exact placeholders',async()=>{
 const first=await run(python,[pythonSource]),second=await run(python,[pythonSource]);check(first);check(second);assert.equal(first.stdout,second.stdout);
});
test('Go emits exactly the same installable Spanish bundle as Python',async t=>{
 const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'localization-example-'));t.after(async()=>{assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});});const executable=join(directory,process.platform==='win32'?'localization.exe':'localization');
 assert.deepEqual(await run(go,['build','-trimpath','-o',executable,goSource],{GOCACHE:join(directory,'go-cache')}),{stdout:'',stderr:''});const goOutput=await run(executable,[]),pythonOutput=await run(python,[pythonSource]);assert(goOutput.stdout===pythonOutput.stdout,'Both generators must emit identical UTF-8 JSON');assert.deepEqual(check(goOutput),check(pythonOutput));
});
