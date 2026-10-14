import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as pw from 'playwright';
import {generatedExamples,numericModule,iconst,uint} from './wasm-pixels-fixtures.mjs';

const examples=await generatedExamples(),base=path.resolve(fileURLToPath(new URL('../',import.meta.url))),engine=process.env.BROWSER_ENGINE??'chromium';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const f64=value=>{const a=new Uint8Array(9);a[0]=0x44;new DataView(a.buffer).setFloat64(1,value,true);return [...a];};
const hangIfAngle=[0x20,2,...f64(0.7),0x64,0x04,0x40,0x03,0x40,0x0c,0,0x0b,0x0b];
function delayed(bytes) {
  let cursor=8;
  const read=()=>{let n=0,shift=0;for(;;){const b=bytes[cursor++];n|=(b&127)<<shift;if(!(b&128))return n;shift+=7;}};
  while(cursor<bytes.length){const start=cursor,id=bytes[cursor++],length=read(),end=cursor+length;if(id!==10){cursor=end;continue;}
    assert.equal(read(),1);read();const body=bytes.slice(cursor,end);assert.deepEqual([...body.slice(0,3)],[1,2,127]);
    const wait=[0x20,2,...f64(0.7),0x64,0x04,0x40,...iconst(30000000),0x21,11,0x03,0x40,0x20,11,...iconst(1),0x6b,0x22,11,0x0d,0,0x0b,0x0b];
    const next=[1,3,127,...wait,...body.slice(3)],payload=[1,...uint(next.length),...next];
    return Uint8Array.from([...bytes.slice(0,start),10,...uint(payload.length),...payload]);
  }throw Error('Missing WASM code');
}
const programs=new Map(examples.map(example=>[example.registry[0].url,example.bytes]));
const special={trap:numericModule({body:[0,0x0b]}),infinite:numericModule({body:[0x03,0x40,0x0c,0,0x0b,...iconst(64),0x0b]}),badoutput:numericModule({body:[...iconst(-1),0x0b]}),runtime:numericModule({initial:256,body:[...hangIfAngle,...iconst(64),0x0b]}),delayed:delayed(examples[0].bytes)};
for(const [name,bytes]of Object.entries(special))programs.set('/compute/'+name+'.wasm',bytes);
programs.set('/compute/slow.wasm',examples[0].bytes);
const registry=[...examples.flatMap(example=>example.registry),...Object.entries(special).map(([name,bytes])=>({id:'test.'+name,version:'1.0.0',url:'/compute/'+name+'.wasm',sha256:sha(bytes)})),{id:'test.slow',version:'1.0.0',url:'/compute/slow.wasm',sha256:sha(examples[0].bytes)},{id:'test.digest',version:'1.0.0',url:examples[0].registry[0].url,sha256:'0'.repeat(64)}];
const server=createServer(async(req,res)=>{
  try {
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(name==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><style>body{margin:0}.stage{display:flex;width:640px;height:260px;position:relative}.target{width:128px;height:192px;margin:12px}</style>');return;}
    if(programs.has(name)){if(name==='/compute/slow.wasm')await new Promise(r=>setTimeout(r,250));res.setHeader('content-type','application/wasm');res.end(programs.get(name));return;}
    const card=/^\/card\/(python|go)\/(.+)$/.exec(name),file=path.resolve(base,'.'+name);
    if(!file.startsWith(base+path.sep))throw Error();
    const bytes=card?examples.find(example=>example.id===card[1]).pkg.files.get(card[2]):await readFile(file);
    if(!bytes)throw Error();res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'image/png');res.end(bytes);
  } catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try {
  try {browser=await pw[engine].launch({headless:process.env.HEADED!=='1'});} catch(error) {if(engine!=='chromium'||process.platform!=='win32')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1000,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const result=await page.evaluate(async registry=>{
    const {wasmPixelAdapter}=await import('/src/presentation/wasm-pixels.js'),{createPlayerStage}=await import('/src/presentation/player.js'),{directoryResolver}=await import('/src/presentation/resolver.js');
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    function assert(value,message){if(!value)throw Error(message);}
    async function wait(condition,message,timeout=5000){const end=performance.now()+timeout;while(!condition()){assert(performance.now()<end,message);await pause(10);}}
    const rendered=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const workers={created:0,terminated:0},NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);workers.created++;this.stopped=false;}terminate(){if(!this.stopped){workers.terminated++;this.stopped=true;}super.terminate();}};
    const adapter=wasmPixelAdapter({programs:registry,deadlineMs:1500}),resolvers=[];
    async function stageViews(motion='respect-preference',dataOverrides=[]) {
      const root=document.createElement('div');root.className='stage';document.body.append(root);
      const stage=createPlayerStage({root,motion,adapters:[adapter]}),views=[],events=[];
      for(let i=0;i<2;i++) {
        const target=document.createElement('div');target.className='target';root.append(target);
        const resolver=await directoryResolver('/card/'+(i?'go':'python')+'/');resolvers.push(resolver);
        if(dataOverrides[i])for(const scene of resolver.scenes.values())Object.assign(scene.nodes[0].data,dataOverrides[i]);
        const view=stage.mount(target,{resolver},{onEvent:event=>events.push(event)});views.push(view);assert((await view.ready).mode==='interactive','Generator card did not mount');
      }
      return {root,stage,views,events,dispose(){for(const view of views)view.dispose();stage.dispose();root.remove();}};
    }
    async function pixel(blob) {const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);const value=[...canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data];bitmap.close();canvas.width=canvas.height=0;return value;}
    const live=await stageViews();live.views[0].setInputs({angle:0.2});live.views[1].setInputs({angle:0.8});
    const python=await pixel(await live.views[0].snapshot()),go=await pixel(await live.views[1].snapshot());
    assert(Math.abs(python[0]-51)<=1&&Math.abs(go[1]-204)<=1,'Independent angle pixels are incorrect');assert(python[3]===255&&go[3]===255,'Generated pixels are not opaque');
    await pause(180);const later=await pixel(await live.views[0].snapshot());assert(later[2]!==python[2],'Clock-driven pixels did not advance');
    adapter.setEnabled('example.python-gradient','1.0.0',false);await wait(()=>live.events.some(event=>event.type==='fallback'&&event.reason.includes('disabled')),'Active revocation did not fall back');
    const revokedWorkers=workers.created;live.views[0].setInputs({angle:0.7});await rendered();assert(!live.views[0].element.querySelector('img').hidden&&workers.created===revokedWorkers,'Disabled instance resumed on ordinary input');
    adapter.setEnabled('example.python-gradient','1.0.0',true);live.views[0].setInputs({angle:0.3});await rendered();assert(!live.views[0].element.querySelector('img').hidden&&workers.created===revokedWorkers,'Re-enabled instance resumed without remount');
    assert((await live.views[0].setQuality('lite')).mode==='interactive'&&live.views[0].element.querySelector('img').hidden,'Re-enabled program did not remount');live.dispose();
    const staticViews=await stageViews('static');staticViews.views[0].setInputs({angle:0.1,tilt:{x:0.9,y:0.9}});const still=await pixel(await staticViews.views[0].snapshot());await pause(120);staticViews.views[0].setInputs({angle:0.9});const stillLater=await pixel(await staticViews.views[0].snapshot());assert(JSON.stringify(still)===JSON.stringify(stillLater)&&Math.abs(still[0]-127)<=1&&still[2]===24,'Static motion pixels changed');staticViews.dispose();
    const captureViews=await stageViews('respect-preference',[{program:'test.delayed',clock:false},{clock:false}]);
    captureViews.views[0].setInputs({angle:0.9});await pause(20);captureViews.views[0].setInputs({angle:0.2});
    const captured=captureViews.views[0].snapshot();captureViews.views[0].setInputs({angle:0.6});
    const exact=await pixel(await captured);assert(Math.abs(exact[0]-51)<=1,'Snapshot returned stale or superseding inputs');
    const current=await pixel(await captureViews.views[0].snapshot());assert(Math.abs(current[0]-153)<=1,'Snapshot froze subsequent live inputs');captureViews.dispose();
    const direct=wasmPixelAdapter({programs:registry,deadlineMs:1500,maxWorkers:2}),frame=angle=>({inputs:{angle},activeTimeSeconds:0,staticMotion:false}),context=()=>({width:32,height:32,signal:new AbortController().signal,invalidate(){},initialFrame:frame(0.5)});
    const delayed=await direct.create(context(),{program:'test.delayed',version:'1.0.0'});
    delayed.update(frame(0.9));delayed.update(frame(0.1));delayed.update(frame(0.9));await wait(()=>Math.abs(delayed.canvas.getContext('2d').getImageData(0,0,1,1).data[0]-229)<=1,'Coalesced update did not reach final inputs');await rendered();
    const red=delayed.canvas.getContext('2d').getImageData(0,0,1,1).data[0];assert(Math.abs(red-229)<=1,'Coalesced update displayed obsolete queued inputs');delayed.dispose();
    const abort=new AbortController(),loading=direct.create({...context(),signal:abort.signal},{program:'test.slow',version:'1.0.0'});abort.abort();await loading.then(()=>{throw Error('Aborted create succeeded');},()=>{});
    const leased=await direct.create(context(),{program:'example.python-gradient',version:'1.0.0'}),pinned=await leased.settle(frame(0.3));leased.dispose();assert(pinned.canvas.width===0,'Disposed instance retained capture canvas');
    const first=await direct.create(context(),{program:'example.python-gradient',version:'1.0.0'}),second=await direct.create(context(),{program:'example.go-checker',version:'1.0.0'});
    await direct.create(context(),{program:'example.python-gradient',version:'1.0.0'}).then(()=>{throw Error('Worker capacity exceeded without refusal');},error=>assert(error.code==='WASM_LIMIT','Wrong capacity refusal'));
    first.dispose();second.dispose();
    const late=await direct.create(context(),{program:'test.delayed',version:'1.0.0'}),pending=late.settle(frame(0.9));late.dispose();await pending.then(()=>{throw Error('Late disposed capture succeeded');},()=>{});
    direct.dispose();
    const limited=wasmPixelAdapter({programs:registry,maxPixels:1024});await limited.create({...context(),width:512,height:768},{program:'example.python-gradient',version:'1.0.0'}).then(()=>{throw Error('Pixel limit silently reduced surface fidelity');},error=>assert(error.code==='WASM_LIMIT','Wrong pixel limit refusal'));limited.dispose();
    const failureReasons=[];
    for(const program of ['test.trap','test.infinite','test.badoutput','test.digest','test.runtime']) {
      const root=document.createElement('div');root.className='stage';document.body.append(root);const target=document.createElement('div');target.className='target';root.append(target);
      const failureAdapter=wasmPixelAdapter({programs:registry,deadlineMs:1500}),stage=createPlayerStage({root,adapters:[failureAdapter]}),resolver=await directoryResolver('/card/python/');resolvers.push(resolver);
      for(const scene of resolver.scenes.values())Object.assign(scene.nodes[0].data,{program,clock:false});
      const events=[],view=stage.mount(target,{resolver},{onEvent:event=>events.push(event)}),ready=await view.ready;
      if(program==='test.runtime'){assert(ready.mode==='interactive','Runtime trap fixture did not initialize');view.setInputs({angle:0.9});await wait(()=>events.some(event=>event.type==='fallback'),'Infinite runtime did not reach fallback',10000);}
      else assert(ready.mode==='poster','Invalid program did not use poster fallback');
      assert(events.some(event=>event.type==='fallback'),'Failure omitted fallback event');failureReasons.push(program);view.dispose();stage.dispose();failureAdapter.dispose();root.remove();
    }
    // A generation change while settling cannot publish stale capture pixels.
    const fencing=await stageViews('respect-preference',[{program:'test.delayed',clock:false},{clock:false}]);fencing.views[0].setInputs({angle:0.9});const stale=fencing.views[0].snapshot();fencing.views[0].setSide('back');await stale.then(()=>{throw Error('Changed generation capture succeeded');},()=>{});fencing.dispose();
    adapter.dispose();for(const resolver of resolvers)resolver.dispose();await pause(30);assert(workers.created===workers.terminated,'Pixel worker leaked after disposal');
    return {python,go,static:still,exactCapture:exact,failures:failureReasons,workers};
  },registry);
  assert.deepEqual(errors,[]);console.log(engine+': '+JSON.stringify(result));
} finally {await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
