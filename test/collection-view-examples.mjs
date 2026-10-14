import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import * as pw from 'playwright';
import {collectionDisplayFields,collectionDisplayLabelKeys,collectionIntents,validateCollectionDisplay} from '../src/presentation/collection-display.js';
import {programHeaders} from '../src/presentation/program.js';

const python=process.env.PYTHON??'python',go=process.env.GO??'go';
function run(command,args,environment={}){
 return new Promise((fulfill,reject)=>{
  const child=spawn(command,args,{windowsHide:true,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off',...environment},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Collection generator timed out'));},60000);
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);if(code===0)fulfill({stdout,stderr});else reject(Error('Collection generator failed: '+stderr));});
 });
}
async function inspect(directory){
 assert.deepEqual((await readdir(directory)).sort(),['collection.css','index.html']);
 const html=await readFile(join(directory,'index.html'),'utf8'),css=await readFile(join(directory,'collection.css'),'utf8');
 assert(Buffer.byteLength(html)+Buffer.byteLength(css)<16384);assert(html.endsWith('\n')&&css.endsWith('\n'));
 const window=new Window({settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
 try{
  window.document.write(html);const document=window.document;
  assert.equal(document.documentElement.lang,'en');assert.equal(document.scripts.length,1);assert.equal(document.scripts[0].type,'module');assert.equal(document.scripts[0].getAttribute('src'),'/program-collection-bootstrap.js');assert.equal(document.scripts[0].textContent,'');
  assert.equal(document.querySelector('link').getAttribute('href'),'collection.css');
  for(const key of ['mode','search','line','rarity','finish','sort','show','inserts']){const input=document.querySelector('[data-dc-collection-query="'+key+'"]');assert(input?.disabled);assert(input.closest('label')?.textContent.trim());}
  for(const key of ['discoveries','definitions','copies','matching','selected'])assert(document.querySelector('[data-dc-collection-count="'+key+'"]'));
  assert.equal(document.querySelector('[data-dc-collection-items]').childElementCount,0);const template=document.querySelector('template[data-dc-collection-item-template]').content;
  for(const key of ['name','line','rarity','finish','tags','stats','metadata','copies','status','preview','select','inspect','favorite','wishlist'])assert(template.querySelector('[data-dc-item-'+key+']'));
  assert.equal(template.querySelector('img').getAttribute('src'),null);assert.equal(template.querySelector('input').type,'checkbox');
  for(const key of ['more','previous','clear','compare','tradeup-review'])assert(document.querySelector('button[data-dc-collection-intent="'+key+'"]').disabled);
  assert(document.querySelector('select[data-dc-collection-recipe]').disabled);
  for(const kind of ['lines','rarities','recipes']){const search=document.querySelector('[data-dc-collection-options-search="'+kind+'"]');assert(search?.disabled);assert(search.closest('label').textContent.trim());assert.equal(search.maxLength,200);for(const direction of [-1,1])assert(document.querySelector('button[data-dc-collection-options-page="'+kind+'"][data-dc-direction="'+direction+'"]').disabled);}
  for(const root of [document,template]){assert.equal(root.querySelectorAll('style,[style],iframe,object,embed,form').length,0);for(const element of root.querySelectorAll('*'))for(const attribute of element.attributes)assert(!/^on/i.test(attribute.name));for(const button of root.querySelectorAll('button')){assert.equal(button.type,'button');assert(button.textContent.trim());}}
  assert(css.includes(':focus-visible')&&css.includes('prefers-reduced-motion')&&css.includes('@media')&&css.includes('[hidden]'));assert(!/@import|url\s*\(/i.test(css));
 }finally{await window.happyDOM.abort();}
 return {html,css};
}
const uuid=number=>'00000000-0000-4000-8000-'+String(number).padStart(12,'0');
function snapshot(){
 const labels=Object.fromEntries(collectionDisplayLabelKeys.map(key=>[key,key.replace(/[A-Z]/g,letter=>' '+letter.toLowerCase())]));Object.assign(labels,{title:'Collection',search:'Search',browse:'Browse',selected:'Select',inspect:'Inspect',favorite:'Favorite',unfavorite:'Unfavorite',addWishlist:'Add to wishlist',onWishlist:'On wishlist',more:'More cards',previous:'Previous page',compare:'Compare',clear:'Clear selection',recipe:'Recipe',tradeUp:'Review trade-up'});
 return validateCollectionDisplay({profile:'dc.collection-display@1',snapshotId:uuid(1),fields:[...collectionDisplayFields],locale:'en',dir:'ltr',labels,query:{mode:'owned',search:'',line:'',rarity:'',finish:'',sort:'newest',show:'all',inserts:false},options:{lines:[{handle:uuid(2),label:'Sky'}],rarities:[{handle:uuid(3),label:'Common'}],recipes:[{handle:uuid(4),label:'Two dawns'}]},optionWindows:Object.fromEntries(['lines','rarities','recipes'].map(kind=>[kind,{search:'',page:0,hasMore:true}])),counts:{discoveries:1,definitions:2,copies:2,matching:49,selected:0},page:0,hasMore:true,selected:[],tradeUps:true,busy:false,items:[{handle:uuid(5),position:0,selected:false,favorite:false,wished:false,discovered:true,copies:2,reserved:false,available:true,name:'Dawn <card>',line:'Sky',rarity:'Common',finish:'standard',tags:['bright'],stats:{power:7},metadata:{season:'spring'}}],previews:[]});
}
async function browserConformance(outputs){
 let browser;const errors=[];const host=createServer(async(request,response)=>{
  try{const path=new URL(request.url,'http://localhost').pathname;if(path==='/'){response.setHeader('content-type','text/html');response.end('<!doctype html><html><title>Collection example test</title><main id="root"></main></html>');return;}if(/^\/src\/presentation\/[a-z-]+\.js$/.test(path)){response.setHeader('content-type','text/javascript');response.end(await readFile(new URL('..'+path,import.meta.url)));return;}response.writeHead(404);response.end();}catch{response.writeHead(500);response.end();}
 });
 let active=0,hostOrigin;const program=createServer(async(request,response)=>{
  try{for(const [key,value]of Object.entries(programHeaders(hostOrigin)))response.setHeader(key,value);response.setHeader('access-control-allow-origin','*');const path=new URL(request.url,'http://localhost').pathname;if(path==='/'){response.setHeader('content-type','text/html');response.end(outputs[active].html);return;}if(path==='/collection.css'){response.setHeader('content-type','text/css');response.end(outputs[active].css);return;}if(/^\/[a-z-]+\.js$/.test(path)){response.setHeader('content-type','text/javascript');response.end(await readFile(new URL('../src/presentation'+path,import.meta.url)));return;}response.writeHead(404);response.end();}catch{response.writeHead(500);response.end();}
 });
 try{
  await new Promise(resolve=>host.listen(0,'127.0.0.1',resolve));hostOrigin='http://127.0.0.1:'+host.address().port;await new Promise(resolve=>program.listen(0,'127.0.0.1',resolve));const programOrigin='http://127.0.0.1:'+program.address().port;
  const engine=process.env.BROWSER_ENGINE??'chromium';try{browser=await pw[engine].launch({headless:true});}catch(error){if(engine!=='chromium')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  for(active=0;active<outputs.length;active++){
   const page=await browser.newPage({viewport:{width:360,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));await page.goto(hostOrigin+'/');
   await page.evaluate(async({programOrigin,display,intents})=>{const {mountProgram}=await import('/src/presentation/program.js');window.collectionExample={intents:[],display};const registry=new Map([['example.collection',{approved:true,version:'1.0.0',url:programOrigin+'/',intents,collectionDisplay:{profile:display.profile,fields:display.fields}}]]);window.collectionExample.mount=mountProgram(document.querySelector('#root'),{programId:'example.collection',registry,collectionDisplay:display,onCollectionIntent:value=>window.collectionExample.intents.push(value)});},{programOrigin,display:snapshot(),intents:[...collectionIntents]});
   const frame=page.frameLocator('iframe');await frame.locator('html[data-dc-collection-state="ready"]').waitFor();assert.equal(await frame.locator('[data-dc-item-name]').textContent(),'Dawn <card>');assert.equal(await frame.locator('[data-dc-item-stats]').textContent().then(text=>text.includes('7')),true);
   assert(await frame.locator('[data-dc-item-select]').getAttribute('aria-label'),'Selection has a card-specific accessible name');
   const expectIntent=async(action,intent,check=()=>{})=>{const before=await page.evaluate(()=>window.collectionExample.intents.length);await action();await page.waitForFunction(count=>window.collectionExample.intents.length>count,before);const value=await page.evaluate(()=>window.collectionExample.intents.at(-1));assert.equal(value.intent,intent);check(value);};
   for(const [key,value]of [['mode','catalog'],['line',uuid(2)],['rarity',uuid(3)],['finish','holo'],['sort','name'],['show','favorites'],['inserts','yes']])await expectIntent(()=>frame.locator('[data-dc-collection-query="'+key+'"]').selectOption(value),'collection-query',message=>assert.equal(message.query[key],key==='inserts'?true:value));
   await expectIntent(async()=>{await frame.locator('[data-dc-collection-query="search"]').fill('spring');await frame.locator('[data-dc-collection-query="search"]').press('Enter');},'collection-query',message=>assert.equal(message.query.search,'spring'));
   for(const kind of ['lines','rarities','recipes']){
    await expectIntent(()=>frame.locator('[data-dc-collection-options-search="'+kind+'"]').fill('sky'),'collection-options',message=>{assert.equal(message.kind,kind);assert.equal(message.search,'sky');assert.equal(message.page,0);});
    await expectIntent(()=>frame.locator('[data-dc-collection-options-page="'+kind+'"][data-dc-direction="1"]').click(),'collection-options',message=>{assert.equal(message.kind,kind);assert.equal(message.page,1);});
   }
   await page.evaluate(()=>{const state=window.collectionExample,display=structuredClone(state.display);display.query.line=display.options.lines[0].handle;display.query.rarity=display.options.rarities[0].handle;display.options.lines.unshift({handle:'00000000-0000-4000-8000-000000000007',label:'Another line'});display.options.rarities.unshift({handle:'00000000-0000-4000-8000-000000000008',label:'Another rarity'});for(const window of Object.values(display.optionWindows)){window.search='sky';window.page=1;window.hasMore=false;}state.display=display;state.mount.setCollectionDisplay(display);});
   await frame.locator('[data-dc-collection-query="line"] option').filter({hasText:'Another line'}).waitFor({state:'attached'});
   assert.equal(await frame.locator('[data-dc-collection-query="line"]').inputValue(),uuid(2),'Current line stays pinned while browsing another option window');
   assert.equal(await frame.locator('[data-dc-collection-query="rarity"]').inputValue(),uuid(3),'Current rarity stays pinned while browsing another option window');
   for(const kind of ['lines','rarities','recipes']){assert.equal(await frame.locator('[data-dc-collection-options-page="'+kind+'"][data-dc-direction="1"]').isDisabled(),true);await expectIntent(()=>frame.locator('[data-dc-collection-options-page="'+kind+'"][data-dc-direction="-1"]').click(),'collection-options',message=>{assert.equal(message.kind,kind);assert.equal(message.search,'sky');assert.equal(message.page,0);});}
   for(const [selector,intent]of [['inspect','collection-inspect'],['favorite','collection-favorite']])await expectIntent(()=>frame.locator('[data-dc-item-'+selector+']').click(),intent,message=>assert.equal(message.handle,uuid(5)));
   await page.evaluate(()=>{const state=window.collectionExample;state.display.query.mode='catalog';state.mount.setCollectionDisplay(state.display);});
   await expectIntent(()=>frame.locator('[data-dc-item-wishlist]').click(),'collection-wishlist',message=>assert.equal(message.handle,uuid(5)));
   await page.evaluate(()=>{const state=window.collectionExample;state.display.query.mode='owned';state.mount.setCollectionDisplay(state.display);});
   await expectIntent(()=>frame.locator('[data-dc-item-select]').check(),'collection-select',message=>assert.equal(message.selected,true));
   await page.evaluate(()=>{const state=window.collectionExample,display=structuredClone(state.display);display.selected=[display.items[0].handle,'00000000-0000-4000-8000-000000000006'];display.counts.selected=2;display.items[0].selected=true;display.items[0].favorite=true;display.items[0].wished=true;state.display=display;state.mount.setCollectionDisplay(display);});await frame.locator('[data-dc-item-select]:checked').waitFor();await frame.locator('[data-dc-item-favorite]').filter({hasText:/^Unfavorite$/}).waitFor();assert.equal(await frame.locator('[data-dc-item-favorite]').textContent(),'Unfavorite');
   await expectIntent(()=>frame.locator('[data-dc-collection-intent="compare"]').click(),'collection-compare');
   await expectIntent(()=>frame.locator('[data-dc-collection-intent="clear"]').click(),'collection-clear');
   await frame.locator('[data-dc-collection-recipe]').selectOption(uuid(4));await expectIntent(()=>frame.locator('[data-dc-collection-intent="tradeup-review"]').click(),'collection-tradeup-review',message=>assert.equal(message.recipe,uuid(4)));
   await expectIntent(()=>frame.locator('[data-dc-collection-intent="more"]').click(),'collection-more',message=>assert.equal(message.direction,1));
   await page.evaluate(()=>{const state=window.collectionExample,display=structuredClone(state.display);display.page=1;display.items[0].position=48;display.hasMore=false;state.mount.setCollectionDisplay(display);});await expectIntent(()=>frame.locator('[data-dc-collection-intent="previous"]').click(),'collection-more',message=>assert.equal(message.direction,-1));
   assert.equal(await frame.locator('body').evaluate(body=>body.scrollWidth<=innerWidth),true,'Layout fits a narrow viewport');await frame.locator('[data-dc-item-inspect]').focus();await expectIntent(()=>frame.locator('[data-dc-item-inspect]').press('Enter'),'collection-inspect');
   await page.evaluate(()=>window.collectionExample.mount.dispose());assert.equal(await page.locator('iframe').count(),0);await page.close();
  }
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([new Promise(resolve=>host.close(resolve)),new Promise(resolve=>program.close(resolve))]);}
}
test('Independent Python and Go collection generators install through the public bootstrap with complete controls',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'collection-view-examples-'));t.after(()=>rm(directory,{recursive:true,force:true}));const executable=join(directory,process.platform==='win32'?'collection-view.exe':'collection-view');
 assert.deepEqual(await run(go,['build','-trimpath','-o',executable,fileURLToPath(new URL('../examples/plugins/go-collection-view/main.go',import.meta.url))],{GOCACHE:join(directory,'go-cache')}),{stdout:'',stderr:''});const outputs=[];
 for(const [name,command,args]of [['python',python,[fileURLToPath(new URL('../examples/plugins/python-collection-view.py',import.meta.url))]],['go',executable,[]]]){const first=join(directory,name),repeat=join(directory,name+'-repeat');assert.deepEqual(await run(command,[...args,first]),{stdout:'',stderr:''});assert.deepEqual(await run(command,[...args,repeat]),{stdout:'',stderr:''});const output=await inspect(first);assert.deepEqual(output,await inspect(repeat));outputs.push(output);}
 assert.deepEqual(outputs[0],outputs[1]);await browserConformance(outputs);
});
