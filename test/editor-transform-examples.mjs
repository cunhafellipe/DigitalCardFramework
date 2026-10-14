import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';
import {createProject,importPackage} from '@digital-card/framework/presentation';
import {createEditorTransforms} from '@digital-card/framework/presentation/editor-transforms';
import {readZip,writeZip} from '../src/presentation/package.js';
import {canonical,utf8} from '../src/presentation/data.js';
import {fixture,build} from './presentation-fixtures.mjs';

const python=process.env.PYTHON??'python',go=process.env.GO??'go';
const pythonSource=fileURLToPath(new URL('../examples/plugins/python-editor-transform.py',import.meta.url)),goSource=fileURLToPath(new URL('../examples/plugins/go-editor-transform/main.go',import.meta.url));
const tool={id:'example.grid-decoration',version:'1.0.0',title:'Grid and decorate',parameters:{columns:{label:'Columns',type:'number',default:2,minimum:1,maximum:8,step:1},gap:{label:'Gap',type:'number',default:12,minimum:0,maximum:100,step:1},padding:{label:'Padding',type:'number',default:20,minimum:0,maximum:200,step:1}},grants:{faces:['front'],newRasterAssets:true,capabilities:[]}};
function run(executable,args,environment={}){
 return new Promise((fulfill,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off',...environment}});let stdout='',stderr='',settled=false;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value);};const timer=setTimeout(()=>{child.kill();finish(reject,Error('Editor transform timed out'));},60000);
  const collect=(name,data)=>{if(name==='stdout')stdout+=data;else stderr+=data;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>16384){child.kill();finish(reject,Error('Transform diagnostics exceeded their bound'));}};
  child.stdout.on('data',data=>collect('stdout',data));child.stderr.on('data',data=>collect('stderr',data));child.once('error',error=>finish(reject,error));child.once('close',code=>code===0?finish(fulfill,{stdout,stderr}):finish(reject,Error('Editor transform failed: '+stderr)));
 });
}
function raster(bytes){const png=Buffer.from(bytes),chunks=[];for(let offset=8;offset<png.length;){const length=png.readUInt32BE(offset);if(png.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(png.subarray(offset+8,offset+8+length));offset+=12+length;}return inflateSync(Buffer.concat(chunks));}
test('actual Python and Go transforms compute layouts and generated art through public review/apply',async t=>{
 const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'editor-transform-'));t.after(async()=>{assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});});const executable=join(directory,process.platform==='win32'?'editor-transform.exe':'editor-transform');assert.deepEqual(await run(go,['build','-trimpath','-o',executable,goSource],{GOCACHE:join(directory,'go-cache')}),{stdout:'',stderr:''});
 const art=fixture(),node=(id,width,height,extra={})=>({id,type:'image',asset:'art',x:7,y:8,width,height,...extra});art.scenes.get('scenes/front.json').nodes=[node('locked',30,40,{locked:true}),node('portrait',100,200),node('landscape',200,100),node('square',80,80)];const pkg=await build(art),originalNodes=structuredClone(pkg.scenes.get('scenes/front.json').nodes);
 let results=[];
 for(const parameters of [{columns:2,gap:12,padding:20},{columns:3,gap:17,padding:15},{columns:1,gap:8,padding:10}]){
  const outcomes=[];
  for(const [language,command,args]of [['python',python,[pythonSource]],['go',executable,[]]]){
   const project=createProject(pkg),controller=createEditorTransforms({tools:[tool]});t.after(()=>controller.dispose());const job=await controller.prepare(project,{toolId:tool.id,parameters}),name=language+'-'+parameters.columns,input=join(directory,name+'.job'),output=join(directory,name+'.result'),repeat=output+'.repeat';await writeFile(input,job.archive);assert.deepEqual(await run(command,[...args,input,output]),{stdout:'',stderr:''});assert.deepEqual(await run(command,[...args,input,repeat]),{stdout:'',stderr:''});const bytes=new Uint8Array(await readFile(output));assert.deepEqual(bytes,new Uint8Array(await readFile(repeat)),language+' result must be deterministic');
   const files=await readZip(bytes);assert.deepEqual([...files.keys()].sort(),['result.dcard','result.json']);const result=await importPackage(files.get('result.dcard')),requestFiles=await readZip(job.archive),source=await importPackage(requestFiles.get('source.dcard'));assert.deepEqual(result.manifest.assets.slice(0,source.manifest.assets.length),source.manifest.assets);for(const asset of source.manifest.assets)assert.deepEqual(result.files.get(asset.path),source.files.get(asset.path));assert.deepEqual(result.scenes.get('scenes/back.json'),source.scenes.get('scenes/back.json'));
   const nodes=result.scenes.get('scenes/front.json').nodes;assert.deepEqual(nodes[0],source.scenes.get('scenes/front.json').nodes[0]);assert.deepEqual(nodes.slice(0,4).map(node=>node.id),['locked','portrait','landscape','square']);assert.equal(nodes.at(-1).id,'grid-decoration');assert.equal(nodes.at(-1).asset,'grid-decoration-art');assert.equal(result.manifest.assets.at(-1).path,'assets/grid-decoration-art.png');
   for(const node of nodes.slice(1,4)){assert(node.x>=parameters.padding);assert(node.y>=parameters.padding);assert(node.x+node.width<=1000-parameters.padding+1e-8);assert(node.y+node.height<=1500-parameters.padding+1e-8);}assert(Math.abs(nodes[1].height/nodes[1].width-2)<1e-8);assert(Math.abs(nodes[2].height/nodes[2].width-.5)<1e-8);if(parameters.columns===2){assert.equal(nodes[1].x,20);assert.equal(nodes[1].width,474);assert.equal(nodes[1].height,948);assert.equal(nodes[2].y,375.5);assert.equal(nodes[3].y,980);}
   const review=await controller.review(project,job.requestId,bytes);assert(Object.isFrozen(review));assert.equal(project.getRevision(),0);assert.deepEqual(project.scenes.get('scenes/front.json').nodes,originalNodes);controller.apply(project,review);assert.equal(project.getRevision(),1);assert.equal(project.undo.length,1);assert.equal(project.scenes.get('scenes/front.json').nodes.length,5);assert.equal(project.assets.size,pkg.manifest.assets.length+1);assert(project.undoEdit());assert.deepEqual(project.scenes.get('scenes/front.json').nodes,originalNodes);assert.equal(project.assets.size,pkg.manifest.assets.length);assert(project.redoEdit());assert.equal(project.scenes.get('scenes/front.json').nodes.length,5);assert.throws(()=>controller.apply(project,review),error=>error.code==='EDITOR_TRANSFORM');
   const rejectedProject=createProject(pkg),rejectedController=createEditorTransforms({tools:[tool]});t.after(()=>rejectedController.dispose());const rejectedJob=await rejectedController.prepare(rejectedProject,{toolId:tool.id,parameters});const invalidFiles=new Map(files),header=JSON.parse(new TextDecoder().decode(files.get('result.json')));header.requestId=rejectedJob.requestId;header.sourceDigest='sha256:'+'0'.repeat(64);invalidFiles.set('result.json',utf8(canonical(header)));await assert.rejects(rejectedController.review(rejectedProject,rejectedJob.requestId,writeZip(invalidFiles)),error=>error.code==='EDITOR_TRANSFORM');assert.equal(rejectedProject.getRevision(),0);assert.equal(rejectedProject.undo.length,0);
   outcomes.push(result);results.push(result);
  }
  assert.deepEqual(outcomes[0].scenes,outcomes[1].scenes);assert.deepEqual(raster(outcomes[0].files.get('assets/grid-decoration-art.png')),raster(outcomes[1].files.get('assets/grid-decoration-art.png')));
 }
 assert.notDeepEqual(results[0].scenes.get('scenes/front.json'),results[2].scenes.get('scenes/front.json'));
});
