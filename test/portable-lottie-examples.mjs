import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';
import {importPackage} from '@digital-card/framework/presentation';
import {readZip,writeZip} from '../src/presentation/package.js';
import {inspectDotLottie} from '../src/presentation/advanced-media.js';
import {canonical,sha256,utf8} from '../src/presentation/data.js';
import {normalizedInputs} from '../src/presentation/motion.js';

const python=process.env.PYTHON??'python',go=process.env.GO??'go';
const pythonSource=fileURLToPath(new URL('../examples/plugins/python-lottie-card.py',import.meta.url)),goSource=fileURLToPath(new URL('../examples/plugins/go-lottie-card/main.go',import.meta.url));
function run(executable,args,environment={}){
 return new Promise((fulfill,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off',...environment}});let stdout='',stderr='',settled=false;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value);};
  const timer=setTimeout(()=>{child.kill();finish(reject,Error('Vector card generator timed out'));},60000);
  const collect=(name,data)=>{if(name==='stdout')stdout+=data;else stderr+=data;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>16384){child.kill();finish(reject,Error('Generator diagnostics exceeded their bound'));}};
  child.stdout.on('data',data=>collect('stdout',data));child.stderr.on('data',data=>collect('stderr',data));child.once('error',error=>finish(reject,error));child.once('close',code=>code===0?finish(fulfill,{stdout,stderr}):finish(reject,Error('Vector card generator failed: '+stderr)));
 });
}
function raster(bytes){
 const png=Buffer.from(bytes),chunks=[];for(let offset=8;offset<png.length;){const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8);if(type==='IDAT')chunks.push(png.subarray(offset+8,offset+8+length));offset+=12+length;}return inflateSync(Buffer.concat(chunks));
}
async function check(pkg,clock){
 assert.equal(pkg.manifest.id,'example.starfield');assert.equal(pkg.manifest.contractVersion,'0.1.0');assert.equal(pkg.manifest.profile,'portable');assert.equal(pkg.manifest.assets.length,4);assert.deepEqual(pkg.manifest.capabilities.optional.map(value=>({...value})),[{id:'dc.dotlottie@0.1',fallback:'poster'}]);
 const node=pkg.scenes.get('scenes/front.json').nodes[1];assert.equal(node.type,'adapter');assert.equal(node.adapter,'dc.dotlottie');assert.deepEqual({...node.data},{asset:'star-animation',animation:'stars',clock,duration:2});assert.equal(node.width,300);assert.equal(node.height,450);assert.equal(pkg.scenes.get('scenes/front.json').nodes[0].asset,'background');
 const passive=await inspectDotLottie(pkg.files.get('assets/star-animation.lottie'),readZip);assert.equal(passive.files.size,2);assert.deepEqual(passive.manifest.animations.map(value=>({...value})),[{id:'stars'}]);const animation=JSON.parse(new TextDecoder().decode(passive.files.get('a/stars.json')));assert.deepEqual(animation.assets,[]);assert.equal(animation.fr,30);assert.equal(animation.op,60);assert.equal(animation.w,300);assert.equal(animation.h,450);assert.equal(animation.layers.length,3);
 for(const layer of animation.layers){assert.equal(layer.ty,4);assert.equal(layer.shapes[0].ty,'sh');assert.equal(layer.ks.p.a,1);assert.deepEqual(layer.ks.p.k.map(frame=>frame.t),[0,30,60]);assert.notDeepEqual(layer.ks.p.k[0].s,layer.ks.p.k[2].s);assert.equal(layer.shapes[0].ks.k.v.length,8);assert.equal(layer.shapes[1].ty,'fl');}
 assert.equal(normalizedInputs({tilt:{x:-1,y:0}}).angle,0);assert.equal(normalizedInputs({tilt:{x:1,y:0}}).angle,1);assert.equal(normalizedInputs({tilt:{x:100,y:0}}).angle,1);
 return {passive,animation};
}
// Reindex a modified nested animation to exercise the existing passive importer
// rather than failing only its outer package hash.
async function alteredPackage(pkg,change){
 const files=new Map(pkg.files),nested=await readZip(files.get('assets/star-animation.lottie'));change(nested);const dot=writeZip(nested),manifest=structuredClone(pkg.manifest),asset=manifest.assets.find(value=>value.id==='star-animation');asset.bytes=dot.length;asset.sha256=await sha256(dot);files.set(asset.path,dot);files.set('card.json',utf8(canonical(manifest)));
 const descriptor={format:'digital-card-integrity',version:1,files:[]};for(const [path,data]of [...files].filter(([path])=>path!=='integrity.json').sort(([a],[b])=>a<b?-1:a>b?1:0))descriptor.files.push({path,bytes:data.length,sha256:await sha256(data)});files.set('integrity.json',utf8(canonical({...descriptor,digest:'sha256:'+await sha256(utf8('digital-card-package-v1\n'+canonical(descriptor)))})));return writeZip(files);
}
test('independent Python and Go vector cards import with deterministic equivalent passive keyframes',async t=>{
 const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'portable-lottie-'));t.after(async()=>{assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});});const executable=join(directory,process.platform==='win32'?'lottie-card.exe':'lottie-card');assert.deepEqual(await run(go,['build','-trimpath','-o',executable,goSource],{GOCACHE:join(directory,'go-cache')}),{stdout:'',stderr:''});
 const packages=[];
 for(const clock of [false,true]){
  const outputs=[];for(const [language,command,args]of [['python',python,[pythonSource]],['go',executable,[]]]){const first=join(directory,language+(clock?'-clock':'-angle')+'.dcard'),second=first+'.repeat',mode=clock?['--clock']:[];assert.deepEqual(await run(command,[...args,...mode,first]),{stdout:'',stderr:''});assert.deepEqual(await run(command,[...args,...mode,second]),{stdout:'',stderr:''});const bytes=new Uint8Array(await readFile(first));assert(bytes.length<65536);assert.deepEqual(bytes,new Uint8Array(await readFile(second)),language+' repeated archive');const pkg=await importPackage(bytes);outputs.push({pkg,...await check(pkg,clock)});packages.push(pkg);}
  const comparable=manifest=>({...manifest,assets:manifest.assets.map(({bytes,sha256,...asset})=>asset)});assert.deepEqual(comparable(outputs[0].pkg.manifest),comparable(outputs[1].pkg.manifest));assert.deepEqual(outputs[0].pkg.scenes,outputs[1].pkg.scenes);assert.deepEqual(outputs[0].animation,outputs[1].animation);assert.deepEqual(outputs[0].passive.manifest,outputs[1].passive.manifest);for(const name of ['front','back','background'])assert.deepEqual(raster(outputs[0].pkg.files.get('assets/'+name+'.png')),raster(outputs[1].pkg.files.get('assets/'+name+'.png')),name+' poster/background pixels');
 }
 const original=packages[0];await assert.rejects(importPackage(await alteredPackage(original,files=>{const manifest=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));manifest.stateMachines=[{id:'not-passive'}];files.set('manifest.json',utf8(canonical(manifest)));})),error=>error.code==='LOTTIE_STATE');
 await assert.rejects(importPackage(await alteredPackage(original,files=>{const animation=JSON.parse(new TextDecoder().decode(files.get('a/stars.json')));animation.layers[0].ks.p.x='synthetic expression';files.set('a/stars.json',utf8(canonical(animation)));})),error=>error.code==='LOTTIE_EXPRESSION');
 await assert.rejects(importPackage(await alteredPackage(original,files=>{const animation=JSON.parse(new TextDecoder().decode(files.get('a/stars.json')));animation.assets=[{id:'external',u:'https://example.invalid/',p:'image.png'}];files.set('a/stars.json',utf8(canonical(animation)));})),error=>error.code==='LOTTIE_URI');
});
