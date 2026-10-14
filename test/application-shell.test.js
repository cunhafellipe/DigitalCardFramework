import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import Ajv from 'ajv/dist/2020.js';
import {applicationShellProfile,applicationShellSchema,validateApplicationShell,loadApplicationShell} from '../src/application-shell.js';
import {mountFramework} from '../src/ui.js';
import {fixture} from './helpers.js';
const region=name=>({type:'region',name}),shell=()=>({profile:applicationShellProfile,tree:{type:'column',children:[{type:'heading',text:'Literal <workspace>'},region('navigation'),{type:'row',narrow:{flow:'column'},children:[region('status'),region('recovery'),{type:'column',children:[region('content')]}]},region('overlays')]}});
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const generated=new Map();
test('independent Python and Go authors generate complete distinct topologies accepted by schema and runtime',()=>{
  const schema=new Ajv({strict:false}).compile(applicationShellSchema);
  for(const language of ['python','go'])for(const topology of ['rail','header']){
    const filename=fileURLToPath(new URL('../examples/application-shell/generate.'+(language==='python'?'py':'go'),import.meta.url));
    const bytes=execFileSync(language==='python'?process.env.PYTHON??'python':process.env.GO??'go',language==='python'?[filename,topology]:['run',filename,topology],{windowsHide:true,timeout:60000,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off'}});
    const value=JSON.parse(bytes);generated.set(language+'-'+topology,value);assert(schema(value),JSON.stringify(schema.errors));assert.deepEqual(validateApplicationShell(value),value);
  }
  for(const language of ['python','go'])assert.notDeepEqual(generated.get(language+'-rail'),generated.get(language+'-header'));
  assert.notDeepEqual(generated.get('python-rail'),generated.get('go-rail'));
});
test('runtime rejects executable or unknown fields, missing or duplicated protected regions and nested overlay mounts',()=>{
  const edits=[value=>value.html='x',value=>value.tree.children.push({type:'script',text:'x'}),value=>value.tree.children[0].text='\ud800',value=>value.tree.children[0].text='x'.repeat(501),value=>value.tree.children[0].layout={color:'url(x)'},value=>value.tree.layout={gap:65},value=>value.tree.narrow={flow:'none'},value=>value.tree.layout={columns:13},value=>value.tree.layout={grow:2},value=>value.tree.layout={padding:-1},value=>value.tree.layout={align:'unsafe'},value=>value.tree.layout={justify:'unsafe'},value=>value.tree.children.push(region('content')),value=>value.tree.children.at(-1).layout={padding:1},value=>value.tree.children.splice(-1,1),value=>value.tree.children[2].children.splice(0,1),value=>value.tree.children[2].children.splice(1,1),value=>value.tree.children[2].children.splice(2,1),value=>value.tree.children[2].children.push(value.tree.children.pop()),value=>value.tree.children[1].groups=[{entries:[{section:'shop',approved:true}]}],value=>value.tree.children[1].groups=[{entries:[{section:'shop'},{section:'shop'}]}],value=>value.tree.children[1].groups=[{entries:[{section:'x'.repeat(81)}]}]];
  for(const edit of edits){const value=shell();edit(value);assert.throws(()=>validateApplicationShell(value));}
  const cycle=shell();cycle.tree.children.unshift(cycle.tree);assert.throws(()=>validateApplicationShell(cycle));
  const shared=shell();shared.tree.children.unshift(shared.tree.children[0]);assert.throws(()=>validateApplicationShell(shared));
  let reads=0;const getter=shell();Object.defineProperty(getter,'profile',{enumerable:true,get(){reads++;return applicationShellProfile;}});assert.throws(()=>validateApplicationShell(getter));assert.equal(reads,0);
  const arrayGetter=shell();Object.defineProperty(arrayGetter.tree.children,0,{enumerable:true,get(){reads++;return region('account');}});assert.throws(()=>validateApplicationShell(arrayGetter));assert.equal(reads,0);
  const over=shell();over.tree.children.unshift(...Array.from({length:60},()=>({type:'text',text:''})));assert.throws(()=>validateApplicationShell(over));
  const deep=shell();let target=deep.tree.children[2].children[2];for(let i=0;i<7;i++){target.children=[{type:'column',children:target.children}];target=target.children[0];}assert.throws(()=>validateApplicationShell(deep));
  const oversized=shell();oversized.tree.children[1].groups=Array.from({length:16},(_,i)=>({label:'"'.repeat(500),entries:Array.from({length:4},(_,j)=>({section:'custom.'+i+'.'+j,label:'"'.repeat(500)}))}));assert.throws(()=>validateApplicationShell(oversized));
});
test('loader bounds streamed UTF-8 before parsing, rejects unsafe URLs and honours abort',async()=>{
  const value=shell();assert.deepEqual(await loadApplicationShell('https://example.test/shell.json',{fetch:async()=>new Response(JSON.stringify(value))}),value);
  let cancelled=false;const oversized=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(32769));},cancel(){cancelled=true;}});
  await assert.rejects(loadApplicationShell('https://example.test/shell.json',{fetch:async()=>new Response(oversized)}));assert(cancelled);
  const credentialURL=new URL('https://example.test/shell.json');credentialURL.username='test-account';credentialURL.password='test-password';
  for(const url of ['javascript:alert(1)','file:///shell.json',credentialURL])await assert.rejects(loadApplicationShell(url,{fetch:()=>assert.fail('Unsafe URL dispatched')}));
  await assert.rejects(loadApplicationShell('https://example.test/shell.json',{fetch:async()=>new Response(new Uint8Array([0xff]))}));
  const controller=new AbortController();controller.abort();await assert.rejects(loadApplicationShell('https://example.test/shell.json',{signal:controller.signal,fetch:async()=>new Response('{}')}));
});
async function mounted(run,{manifest=shell(),sections=['shop','collection','wallet','packs'],navigation='tabs',nativeAdmin=false}={}){
  const window=new Window(),x=fixture();globalThis.document=window.document;globalThis.sessionStorage=window.sessionStorage;
  const root=document.createElement('main');root.setAttribute('lang','fr');root.setAttribute('dir','rtl');document.body.append(root);let actor=x.alice,key=0,capabilities=null,renders=0,disposes=0,refreshes=0;
  const client={requestKey:()=>`shell-${++key}`,capabilities:async()=>capabilities,me:async()=>({...x.core.me(actor),role:nativeAdmin?'admin':'user'}),catalog:async()=>{refreshes++;return x.core.catalog(actor);}};
  for(const name of ['wallet','packs','inventory','albums','trades','commandIntents','registerCommandIntent','executeCommandIntent','acknowledgeCommandIntent','adminOverview','adminUsers','adminUser','adminHistory','configureAdmin','administerCards'])client[name]=async input=>x.core[name](nativeAdmin?{...actor,role:'admin'}:actor,input);
  const views=Object.fromEntries(sections.filter(name=>name!=='admin').map(name=>[name,()=>{renders++;const node=document.createElement('section');node.textContent=name;node.dataset.testView=name;return {node,dispose:()=>disposes++};}]));
  const app=mountFramework(root,{client,shell:manifest,sections,navigation,views});
  try{await app.ready;await app.shellReady;await run({...x,window,root,client,app,setActor:value=>actor=value,setCapabilities:value=>capabilities=value,get renders(){return renders;},get disposes(){return disposes;},get refreshes(){return refreshes;}});}
  finally{app.dispose();assert.equal(root.getAttribute('lang'),'fr');assert.equal(root.getAttribute('dir'),'rtl');x.core.close();await window.happyDOM.abort();delete globalThis.document;delete globalThis.sessionStorage;}
}
test('stable topology and navigation identity survive refresh and switching; all host navigation remains operable',()=>mounted(async x=>{
  const topology=x.root.querySelector('[data-dc-shell]'),nav=x.root.querySelector('nav'),button=nav.querySelector('[data-view="collection"]'),content=x.root.querySelector('.dc-content'),overlay=x.root.querySelector('[data-dc-region="overlays"]');
  button.focus();await x.app.refresh();assert.equal(x.root.querySelector('[data-dc-shell]'),topology);assert.equal(nav.querySelector('[data-view="collection"]'),button);assert.equal(document.activeElement,button);
  const grouped=shell();grouped.tree.children[1].groups=[{label:'Explore <literal>',entries:[{section:'collection',label:'Cards <literal>'},{section:'unavailable'},{section:'admin'}]}];grouped.tree.children[1].arrangement='vertical';await x.app.setShell(grouped);
  assert.equal(x.root.querySelector('.dc-content'),content);assert.equal(x.root.querySelector('[data-dc-region="overlays"]'),overlay);assert.equal(document.activeElement,button);assert.equal(button.textContent,'Cards <literal>');assert.equal(nav.querySelector('[data-view="admin"]'),null);assert.equal(nav.querySelectorAll('button').length,4);
  button.click();assert.equal(content.textContent,'collection');await x.app.setShell(null);assert.equal(content.textContent,'collection');assert.equal(nav.querySelector('[data-view="collection"]'),button);assert.equal(overlay.parentElement,x.root);assert(!overlay.closest('[data-dc-shell]'));
  assert.equal(await x.app.setShell({profile:'unsupported'}),false);assert.equal(x.root.querySelector('[data-dc-shell]'),null);
  const noNavigation=shell();noNavigation.tree.children.splice(1,1);await x.app.setShell(noNavigation);assert.equal(x.root.querySelector('[data-dc-shell]'),null);assert(nav.querySelector('[data-view="shop"]'));
}));
test('optional account regions and sections semantics preserve effective sequence and capability fallback',()=>mounted(async x=>{
  assert.equal(x.root.querySelector('[data-dc-region="account"]'),null);assert.deepEqual([...x.root.querySelectorAll('[data-test-view]')].map(node=>node.dataset.testView),['shop','collection','wallet','packs']);
  x.setCapabilities({available:{packs:false,directSales:false,resale:false,trading:false},draining:[],history:{}});await x.app.refresh();assert.deepEqual([...x.root.querySelectorAll('[data-test-view]')].map(node=>node.dataset.testView),['collection']);
  assert.equal(x.root.querySelector('[data-view="shop"]'),null);
},{navigation:'sections'}));
test('late loads are fenced by newer installation, principal changes and disposal',()=>mounted(async x=>{
  let resolve;const pending=x.app.setShell(new Promise(done=>resolve=done));await x.app.setShell(null);resolve(shell());assert.equal(await pending,false);assert.equal(x.root.querySelector('[data-dc-shell]'),null);
  let accountResolve;const accountPending=x.app.setShell(new Promise(done=>accountResolve=done));x.setActor(x.bob);await x.app.refresh();accountResolve(shell());assert.equal(await accountPending,false);
  let disposeResolve;const disposal=x.app.setShell(new Promise(done=>disposeResolve=done));x.app.dispose();disposeResolve(shell());assert.equal(await disposal,false);assert.equal(x.root.children.length,0);
}));
test('pending original-command recovery remains independent of replaceable content in portable and fallback shells',()=>mounted(async x=>{
  const profiles=['rail','header'].map(topology=>JSON.parse(execFileSync(process.env.PYTHON??'python',[fileURLToPath(new URL('../examples/application-shell/generate.py',import.meta.url)),topology],{windowsHide:true})));
  for(const manifest of [shell(),...profiles,null,{profile:'invalid'}]){
    const before=x.core.wallet(x.alice).credits,intent=x.core.registerCommandIntent(x.alice,{command:'purchase',input:x.core.quote(x.alice,{productId:'common',quantity:1})});x.core.executeCommandIntent(x.alice,{id:intent.id});
    await x.app.setShell(manifest);await x.app.refresh();const recovery=x.root.querySelector('[data-dc-region="recovery"]');assert(!recovery.closest('.dc-content'));assert.match(recovery.textContent,/Recover pack purchase/);assert(!JSON.stringify(manifest).includes(intent.id));
    recovery.querySelector('button').click();await settle();assert.equal(x.core.wallet(x.alice).credits,before-10);assert.equal(recovery.children.length,0);assert.match(x.root.querySelector('[role="status"]').textContent,/Original result recovered/);x.core.acknowledgeCommandIntent(x.alice,{id:intent.id});
  }
}));
test('native administrator leave review keeps cancellation and approved post-leave refresh',()=>mounted(async x=>{
  x.root.querySelector('[data-view="admin"]').click();await settle();const website=x.root.querySelector('[data-admin-tab="website"]');website.click();const purchase=x.root.querySelector('[aria-label="Pack purchases"]');purchase.checked=false;purchase.dispatchEvent(new x.window.Event('change',{bubbles:true}));
  x.root.querySelector('[data-view="collection"]').click();assert(x.root.querySelector('.da-leave'));[...x.root.querySelectorAll('button')].find(button=>button.textContent==='Keep editing').click();assert(x.root.querySelector('[aria-label="Pack purchases"]'));assert.equal(x.root.querySelector('[data-view="admin"]').getAttribute('aria-current'),'page');
  const before=x.refreshes;x.root.querySelector('[data-view="collection"]').click();[...x.root.querySelectorAll('button')].find(button=>button.textContent==='Discard draft and continue').click();await settle();assert.equal(x.root.querySelector('.dc-content').textContent,'collection');assert(x.refreshes>before);
},{sections:['collection','admin'],nativeAdmin:true}));
test('public schema is kept synchronized with the runtime export',()=>{assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/application-shell.schema.json',import.meta.url),'utf8')),applicationShellSchema);});
