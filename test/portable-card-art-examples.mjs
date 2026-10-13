import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';
import {importPackage,publicInputs} from '@digital-card/framework/presentation';
import {writeZip} from '../src/presentation/package.js';
import {canonical,sha256,utf8} from '../src/presentation/data.js';
import {evaluate} from '../src/presentation/motion.js';

const python=process.env.PYTHON??'python',go=process.env.GO??'go';
const pythonSource=fileURLToPath(new URL('../examples/plugins/python-card-art.py',import.meta.url)),goSource=fileURLToPath(new URL('../examples/plugins/go-card-art/main.go',import.meta.url));
function run(executable,args,environment={}){
 return new Promise((fulfill,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off',...environment}});let stdout='',stderr='',settled=false;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value);};
  const timer=setTimeout(()=>{child.kill();finish(reject,Error('Card artwork generator timed out'));},60000);
  const collect=(name,data)=>{if(name==='stdout')stdout+=data;else stderr+=data;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>16384){child.kill();finish(reject,Error('Generator diagnostic output exceeded its bound'));}};
  child.stdout.on('data',data=>collect('stdout',data));child.stderr.on('data',data=>collect('stderr',data));child.once('error',error=>finish(reject,error));child.once('close',code=>code===0?finish(fulfill,{stdout,stderr}):finish(reject,Error('Card artwork generator failed: '+stderr)));
 });
}
function pixelBytes(bytes){
 const png=Buffer.from(bytes);assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);const chunks=[];let width,height;
 for(let offset=8;offset<png.length;){const length=png.readUInt32BE(offset),kind=png.toString('ascii',offset+4,offset+8),payload=png.subarray(offset+8,offset+8+length);if(kind==='IHDR'){width=payload.readUInt32BE(0);height=payload.readUInt32BE(4);assert.equal(payload[8],8);assert.equal(payload[9],6);}if(kind==='IDAT')chunks.push(payload);offset+=12+length;}
 assert.equal(width,192);assert.equal(height,288);const rows=inflateSync(Buffer.concat(chunks)),pixels=Buffer.alloc(width*height*4);assert.equal(rows.length,height*(width*4+1));for(let y=0;y<height;y++){assert.equal(rows[y*(width*4+1)],0);pixels.set(rows.subarray(y*(width*4+1)+1,(y+1)*(width*4+1)),y*width*4);}return pixels;
}
function check(pkg){
 assert.equal(pkg.manifest.id,'example.celestial-card');assert.equal(pkg.manifest.contractVersion,'0.1.0');assert.equal(pkg.manifest.profile,'portable');assert.equal(pkg.manifest.assets.length,7);assert.deepEqual({...pkg.manifest.canvas},{width:600,height:900});assert.equal(pkg.files.size,11);
 for(const side of ['front','back']){const scene=pkg.scenes.get('scenes/'+side+'.json');assert.deepEqual(scene.nodes.map(node=>node.id),[side+'-background',side+'-emblem']);const poster=pixelBytes(pkg.files.get('assets/'+side+'-poster.png'));assert(poster.every((value,index)=>index%4!==3||value===255));assert(new Set(Array.from(poster.values())).size>20);}
 assert.notDeepEqual(pixelBytes(pkg.files.get('assets/front-poster.png')),pixelBytes(pkg.files.get('assets/back-poster.png')));
 const mask=pixelBytes(pkg.files.get('assets/foil-mask.png'));assert(mask.some((value,index)=>index%4===3&&value===0));assert(mask.some((value,index)=>index%4===3&&value===255));
 const emblem=pkg.scenes.get('scenes/front.json').nodes[1];assert.equal(emblem.material.kind,'foil');assert.equal(emblem.material.seed,17);assert.equal(emblem.material.maskAsset,'foil-mask');
 for(const tilt of [-100,-1,0,1,100]){assert.equal(evaluate(emblem.bindings.rotation,{'tilt.x':tilt}),Math.max(-1,Math.min(1,tilt))*6);assert.equal(evaluate(emblem.bindings['material.angle'],{'tilt.x':tilt}),Math.max(-1,Math.min(1,tilt))*35);}
 assert.deepEqual(publicInputs(pkg.manifest,{'private.code':'synthetic-private','holderId':'synthetic-holder'}),{});
}
// Reindex deliberately altered archives to exercise import validation beyond
// integrity alone. Example authors do not invoke this framework test helper.
async function reindex(files){
 const descriptor={format:'digital-card-integrity',version:1,files:[]};for(const [path,data]of [...files].filter(([path])=>path!=='integrity.json').sort(([a],[b])=>a<b?-1:a>b?1:0))descriptor.files.push({path,bytes:data.length,sha256:await sha256(data)});
 files.set('integrity.json',utf8(canonical({...descriptor,digest:'sha256:'+await sha256(utf8('digital-card-package-v1\n'+canonical(descriptor)))})));return writeZip(files);
}

test('independent Python and Go writers produce deterministic interoperable layered card art',async t=>{
 const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'portable-card-art-'));t.after(async()=>{assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});});
 const executable=join(directory,process.platform==='win32'?'card-art.exe':'card-art');assert.deepEqual(await run(go,['build','-trimpath','-o',executable,goSource],{GOCACHE:join(directory,'go-cache')}),{stdout:'',stderr:''});
 const packages=[];
 for(const [language,command,args]of [['python',python,[pythonSource]],['go',executable,[]]]){
  const first=join(directory,language+'.dcard'),second=join(directory,language+'-repeat.dcard');assert.deepEqual(await run(command,[...args,first]),{stdout:'',stderr:''});assert.deepEqual(await run(command,[...args,second]),{stdout:'',stderr:''});const bytes=new Uint8Array(await readFile(first));assert(bytes.length<65536);assert.deepEqual(bytes,new Uint8Array(await readFile(second)),language+' export must be deterministic');const pkg=await importPackage(bytes);check(pkg);packages.push(pkg);
 }
 const comparable=manifest=>({...manifest,assets:manifest.assets.map(({bytes,sha256,...asset})=>asset)});assert.deepEqual(comparable(packages[0].manifest),comparable(packages[1].manifest));assert.deepEqual(packages[0].scenes,packages[1].scenes);for(const asset of packages[0].manifest.assets)assert.deepEqual(pixelBytes(packages[0].files.get(asset.path)),pixelBytes(packages[1].files.get(asset.path)),asset.id+' intended raster content');
 const original=packages[0],files=()=>new Map([...original.files].map(([path,data])=>[path,new Uint8Array(data)]));
 const damaged=files();damaged.get('assets/front-poster.png')[40]^=1;await assert.rejects(importPackage(writeZip(damaged)),error=>error.code==='INTEGRITY');
 const undeclared=files();undeclared.set('assets/undeclared.js',utf8('synthetic undeclared payload'));await assert.rejects(importPackage(await reindex(undeclared)),error=>error.code==='PACKAGE');
 const unsafe=files(),manifest=structuredClone(original.manifest);manifest.assets[0].path='assets/../outside.png';unsafe.set('card.json',utf8(canonical(manifest)));await assert.rejects(importPackage(await reindex(unsafe)),error=>error.code==='PATH');
 const graph=files(),scene=structuredClone(original.scenes.get('scenes/front.json'));let expression=0;for(let depth=0;depth<20;depth++)expression=['add',1,expression];scene.nodes[1].bindings.rotation=expression;graph.set('scenes/front.json',utf8(canonical(scene)));await assert.rejects(importPackage(await reindex(graph)),error=>error.code==='GRAPH_LIMIT');
 const privateInput=files(),privateScene=structuredClone(original.scenes.get('scenes/front.json'));privateScene.nodes[1].bindings.rotation=['input','private.code'];privateInput.set('scenes/front.json',utf8(canonical(privateScene)));await assert.rejects(importPackage(await reindex(privateInput)),error=>error.code==='INPUT');
 const archive=writeZip(original.files);await assert.rejects(importPackage(archive,{limits:{compressed:archive.length-1}}),error=>error.code==='LIMIT');
});
