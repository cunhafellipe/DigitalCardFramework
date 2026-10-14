import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import * as pw from 'playwright';
import {fixture,admin} from './helpers.js';
import {fixture as artworkFixture,build} from './presentation-fixtures.mjs';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
import {programHeaders} from '../src/presentation/program.js';

const output=resolve(process.argv[2]??'test-results/program-album'),engine=process.env.BROWSER_ENGINE??'chromium';
await mkdir(output,{recursive:true});
const temp=await mkdtemp(resolve(tmpdir(),'program-album-')),x=fixture(),pkg=await build(artworkFixture()),checks=[],errors=[];
let browser,api,hostOrigin,actor=x.alice,gate=false,posterArrived,paused=[];
const posterPath=pkg.manifest.assets.find(asset=>asset.id===pkg.manifest.faces.front.poster).path;
const programServer=createServer(async(request,response)=>{
  try{
    for(const [key,value]of Object.entries(programHeaders(hostOrigin)))response.setHeader(key,value);response.setHeader('access-control-allow-origin','*');
    const path=new URL(request.url,'http://localhost').pathname;
    if(path==='/'||path==='/index.html'){response.setHeader('content-type','text/html');response.end(await readFile(resolve(temp,'index.html')));return;}
    if(path==='/card.css'){response.setHeader('content-type','text/css');response.end(await readFile(resolve(temp,'card.css')));return;}
    if(['/program-album-bootstrap.js','/program.js','/editor-display.js','/collection-display.js','/shop-display.js','/trading-display.js','/marketplace-display.js','/album-display.js','/opener-display.js','/data.js','/media.js'].includes(path)){response.setHeader('content-type','text/javascript');response.end(await readFile(new URL('../src/presentation'+path,import.meta.url)));return;}
    response.writeHead(404);response.end();
  }catch(error){response.writeHead(500);response.end(error.message);}
});
const hostServer=createServer(async(request,response)=>{
  try{
    if(await api?.(request,response))return;
    if(request.url==='/album-harness'){response.setHeader('content-type','text/html');response.end('<!doctype html><html lang="en"><title>Reviewed album layouts</title><style>body{font:16px system-ui;margin:20px}main{min-height:100px}#probes{margin:20px}</style><main id="root"></main><section id="probes"></section></html>');return;}
    const path=new URL(request.url,'http://localhost').pathname,prefix='/pinned/';
    if(path.startsWith(prefix)){const asset=path.slice(prefix.length),bytes=pkg.files.get(asset);if(!bytes){response.writeHead(404);response.end();return;}response.setHeader('content-type',asset.endsWith('.png')?'image/png':'application/json');
      if(gate&&asset===posterPath){paused.push({response,bytes});posterArrived?.();return;}response.end(bytes);return;}
    if(await serveReference(request,response))return;response.writeHead(404);response.end();
  }catch(error){response.writeHead(500);response.end(error.message);}
});
try{
  assert.equal(execFileSync(process.env.PYTHON??'python',[fileURLToPath(new URL('../examples/plugins/python-program-card.py',import.meta.url)),'--album',temp],{windowsHide:true,timeout:10000,maxBuffer:16384}).length,0);
  await new Promise(resolve=>hostServer.listen(0,'127.0.0.1',resolve));hostOrigin='http://127.0.0.1:'+hostServer.address().port;
  await new Promise(resolve=>programServer.listen(0,'127.0.0.1',resolve));const programOrigin='http://127.0.0.1:'+programServer.address().port;
  api=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:hostOrigin,requirePrincipal:true});
  await x.core.registerCardPresentation(admin,pkg.archive);const catalog=x.core.operatorCatalog(admin);catalog.version++;catalog.cards.find(card=>card.id==='dawn').presentation={contract:'digital-card@0.1',digest:pkg.digest,baseURL:hostOrigin+'/pinned/'};x.core.publishCatalog(admin,catalog);
  const copies=[...x.open(),...x.open('unique')],layout={id:'journal',pageSize:1,debugSecret:'PRIVATE-LAYOUT',artwork:{pages:[{id:'first',title:'First <page>'},{id:'second',title:'Second page'}]}},placements=copies.map((copy,index)=>({copyId:copy.id,position:index,data:{pageId:index?'second':'first',privateNote:'PRIVATE-PLACEMENT'}}));
  const privateAlbum=x.core.saveAlbum(x.alice,{key:'private-album',name:'Private <album>',visibility:'private',layout,placements}),publicAlbum=x.core.saveAlbum(x.alice,{key:'public-album',name:'Public album',visibility:'public',layout,placements});
  const actual=x.core.viewAlbum(x.alice,privateAlbum.id);assert(JSON.stringify(actual).includes('PRIVATE-DEMO-CODE'));
  try{browser=await pw[engine].launch({headless:process.env.HEADED!=='1'});}catch(error){if(engine!=='chromium')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.goto(hostOrigin+'/album-harness');
  await page.evaluate(async programOrigin=>{
    const [{createClient},{mountFramework},{render3DInspector},{createProgramAlbumRenderer}]=await Promise.all([import('/src/client.js'),import('/src/ui.js'),import('/src/inspector-ui.js'),import('/src/presentation/program-album-view.js')]);
    window.albumTest={createClient,mountFramework,render3DInspector,createProgramAlbumRenderer,payloads:[],channels:[],inspected:[],diagnostics:[]};
    const send=MessagePort.prototype.postMessage;MessagePort.prototype.postMessage=function(value,...transfer){if(value?.type==='content')window.albumTest.payloads.push(structuredClone(value.content));return send.call(this,value,...transfer);};
    const NativeChannel=MessageChannel;window.MessageChannel=class extends NativeChannel{constructor(){super();window.albumTest.channels.push(this);this.port1.addEventListener('message',event=>{this.received=event.data;this.nonce=event.data.nonce;});}};
    const fields=['albumName','cardName','rarity','pageName','preview'],registry=window.albumTest.registry=new Map([['example.album',{approved:true,version:'1.0.0',url:programOrigin+'/',title:'Celestial album',intents:['select-item'],albumDisplay:{profile:'dc.album-display@1',fields}}]]);
    const renderer=window.albumTest.renderer=createProgramAlbumRenderer({registry,programId:'example.album',displayFields:fields,onDiagnostic:value=>window.albumTest.diagnostics.push(value)});
    window.albumTest.mount=async()=>{const client=window.albumTest.client=createClient();window.albumTest.view=mountFramework(document.querySelector('#root'),{client,sections:['albums'],layouts:{journal:window.albumTest.renderer},inspectorRenderer(copy,options){window.albumTest.inspected.push(copy.id);return render3DInspector(copy,options);}});await window.albumTest.view.ready;};await window.albumTest.mount();
  },programOrigin);
  const album=page.locator('.dc-album-preview dc-program-album'),frameOf=async node=>(await node.locator('iframe').elementHandle()).contentFrame();
  await page.getByLabel('Your albums',{exact:true}).selectOption(privateAlbum.id);await album.scrollIntoViewIfNeeded();
  await album.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();assert.equal(await album.frameLocator('iframe').locator('.album-item').count(),2);
  assert.equal(await album.frameLocator('iframe').locator('[data-dc-album-name]').textContent(),'Private <album>');assert.equal(await album.frameLocator('iframe').locator('.album-page').first().locator('[data-dc-page-name]').textContent(),'First <page>');
  await(await frameOf(album)).waitForFunction(()=>{const image=document.querySelector('img[src]');return image?.complete&&image.naturalWidth===2;});
  const payloads=await page.evaluate(()=>window.albumTest.payloads),serialized=JSON.stringify(payloads);for(const secret of ['PRIVATE-DEMO-CODE','PRIVATE-LAYOUT','PRIVATE-PLACEMENT',privateAlbum.id,x.alice.userId,...copies.map(copy=>copy.id),hostOrigin+'/pinned/'])assert(!serialized.includes(secret));
  for(const key of ['copyId','ownerId','bindings','codes','source','provenance','metadata','baseURL'])assert(!serialized.includes('"'+key+'":'));
  await album.frameLocator('iframe').locator('.item-select').filter({hasText:'Dawn'}).click();await page.locator('.dc-inspector-dialog').waitFor();assert.equal(await page.evaluate(()=>window.albumTest.inspected.at(-1)),copies[0].id);await page.getByRole('button',{name:'Close inspection',exact:true}).click();
  await album.scrollIntoViewIfNeeded();await album.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();
  await page.evaluate(()=>{const channel=window.albumTest.channels.filter(channel=>channel.port1.onmessage&&channel.nonce).at(-1);window.albumTest.stale={handler:channel.port1.onmessage,nonce:channel.nonce,snapshot:window.albumTest.payloads.at(-1),inspections:window.albumTest.inspected.length};});
  await page.getByRole('button',{name:'Move Dawn later',exact:true}).click();await page.getByRole('button',{name:'Preview album',exact:true}).click();await album.scrollIntoViewIfNeeded();await album.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();
  const freshness=await page.evaluate(()=>{const old=window.albumTest.stale,current=window.albumTest.payloads.at(-1);old.handler({data:{version:1,type:'intent',intent:'select-item',nonce:old.nonce,snapshotId:old.snapshot.snapshotId,handle:old.snapshot.items[0].handle}});return {fresh:current.snapshotId!==old.snapshot.snapshotId&&current.items.every(item=>!old.snapshot.items.some(old=>old.handle===item.handle)),noSelection:window.albumTest.inspected.length===old.inspections,order:current.items.map(item=>item.name)};});assert(freshness.fresh&&freshness.noSelection);assert.deepEqual(freshness.order,['One Solstice','Dawn']);
  checks.push('Actual private album and unsaved reorder render current full contents/pages; granted pinned raster bytes display, private records/IDs/URLs stay parent-side, current handles inspect the correct copy and obsolete sessions cannot select');

  await page.evaluate(()=>window.albumTest.renderer.setEnabled(false));assert.equal(await album.locator('iframe').count(),0);
  await album.getByRole('button',{name:/Dawn, common/}).click();assert.equal(await page.evaluate(()=>window.albumTest.inspected.at(-1)),copies[0].id);await page.getByRole('button',{name:'Close inspection',exact:true}).click();
  await page.evaluate(()=>{window.albumTest.renderer.setEnabled(true);});await album.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();
  await page.evaluate(()=>{const entry=window.albumTest.registry.get('example.album');window.albumTest.registry.set('example.album',{...entry,albumDisplay:{profile:'dc.album-display@1',fields:[]}});window.albumTest.renderer.setEnabled(false);window.albumTest.renderer.setEnabled(true);});
  await page.waitForFunction(()=>window.albumTest.diagnostics.some(value=>value.code==='PROGRAM_UNAVAILABLE'));assert.equal(await album.locator('iframe').count(),0);
  await album.getByRole('button',{name:/Dawn, common/}).click();assert.equal(await page.evaluate(()=>window.albumTest.inspected.at(-1)),copies[0].id);await page.getByRole('button',{name:'Close inspection',exact:true}).click();
  await page.evaluate(()=>{window.albumTest.renderer.dispose();window.albumTest.view.dispose();});actor=x.bob;
  await page.evaluate(async()=>{const fields=['albumName','cardName','rarity','pageName','preview'],entry=window.albumTest.registry.get('example.album');window.albumTest.registry.set('example.album',{...entry,albumDisplay:{profile:'dc.album-display@1',fields}});window.albumTest.renderer=window.albumTest.createProgramAlbumRenderer({registry:window.albumTest.registry,programId:'example.album',displayFields:fields});await window.albumTest.mount();});
  const denied=await page.evaluate(async id=>{try{await window.albumTest.client.viewAlbum(id);return false;}catch(error){return error.code==='NOT_FOUND';}},privateAlbum.id);assert(denied);
  await page.getByText('Visit public albums',{exact:true}).click();await page.getByRole('button',{name:'Explore',exact:true}).click();await page.getByRole('button',{name:'Public album · Alice',exact:true}).click();await album.scrollIntoViewIfNeeded();await album.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();assert.equal(await album.frameLocator('iframe').locator('.album-item').count(),2);
  checks.push('Disabled and denied-profile native card clicks reach correct host inspection; actual public viewer can render public album while private album remains inaccessible');

  await page.evaluate(()=>{window.albumTest.view.dispose();window.albumTest.renderer.dispose();});actor=x.alice;
  await page.evaluate(async privateId=>{
    const client=window.albumTest.client=window.albumTest.createClient();await client.me();const model=await client.viewAlbum(privateId),fields=['albumName','cardName','rarity','pageName','preview'];
    window.albumTest.largeRenderer=window.albumTest.createProgramAlbumRenderer({registry:window.albumTest.registry,programId:'example.album',displayFields:fields,fallbackRenderer(){const node=document.createElement('div');node.textContent='Native fallback';return node;}});
    window.albumTest.large=window.albumTest.largeRenderer({...model,layout:{},cards:Array.from({length:1000},(_,position)=>({placement:{position,data:{privateNote:'NEVER-SEND'}},copy:{...model.cards[0].copy,definition:{...model.cards[0].copy.definition,name:'Card '+position}}}))});document.querySelector('#probes').append(window.albumTest.large);
  },privateAlbum.id);
  const large=page.locator('#probes dc-program-album');await large.scrollIntoViewIfNeeded();await large.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();
  assert.equal(await large.frameLocator('iframe').locator('.album-item').count(),1000);await(await frameOf(large)).waitForFunction(()=>document.querySelectorAll('img[src]').length===1000);
  const batch=await page.evaluate(()=>{const snapshot=window.albumTest.payloads.findLast(value=>value.items.length===1000),messages=window.albumTest.payloads.filter(value=>value.snapshotId===snapshot.snapshotId);return {count:messages.length,initial:messages[0].previews.length,final:messages.at(-1).previews.length};});
  assert(batch.count===1||batch.count===2,'At most metadata plus one final preview batch');assert.equal(batch.final,1000);if(batch.count===2)assert.equal(batch.initial,0);
  await page.evaluate(()=>{window.albumTest.largeRenderer.dispose();document.querySelector('#probes').replaceChildren();});
  gate=true;const arrived=new Promise(resolve=>{posterArrived=resolve;});
  await page.evaluate(async privateId=>{const model=await window.albumTest.client.viewAlbum(privateId);window.albumTest.gateRenderer=window.albumTest.createProgramAlbumRenderer({registry:window.albumTest.registry,programId:'example.album',displayFields:['cardName','preview'],fallbackRenderer(){return document.createElement('div');}});window.albumTest.gateNode=window.albumTest.gateRenderer(model);document.querySelector('#probes').append(window.albumTest.gateNode);},privateAlbum.id);
  const gated=page.locator('#probes dc-program-album');await gated.scrollIntoViewIfNeeded();let timer;try{await Promise.race([arrived,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Preview request not observed')),10000);})]);}finally{clearTimeout(timer);}
  await page.evaluate(()=>{window.albumTest.gatedCount=window.albumTest.payloads.length;window.albumTest.gateRenderer.setEnabled(false);});gate=false;for(const item of paused)if(!item.response.destroyed)item.response.end(item.bytes);paused=[];
  await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});assert.equal(await page.evaluate(()=>window.albumTest.payloads.length),await page.evaluate(()=>window.albumTest.gatedCount));
  await page.evaluate(()=>window.albumTest.gateRenderer.setEnabled(true));await gated.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();await(await frameOf(gated)).waitForFunction(()=>{const image=document.querySelector('img[src]');return image?.complete&&image.naturalWidth>0;});
  await page.screenshot({path:resolve(output,'album-program.png'),fullPage:true});await page.evaluate(()=>{window.albumTest.gateRenderer.dispose();window.albumTest.gateRenderer.setEnabled(true);});assert.equal(await page.locator('#probes iframe').count(),0);
  checks.push('All 1000 projected placements render without truncation; optional previews arrive once per bounded batch; disabled late preview cannot update an obsolete session, fresh remount works and final disposal is terminal');
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'result.json'),JSON.stringify({engine,checks,errors},null,2));console.log(JSON.stringify({engine,checks,errors}));
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page)await writeFile(resolve(output,'failure.json'),JSON.stringify({message:error.message,errors},null,2));throw error;
}finally{await browser?.close();for(const item of paused)if(!item.response.destroyed)item.response.end(item.bytes);for(const server of [hostServer,programServer]){server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));}x.core.close();await rm(temp,{recursive:true,force:true});}
