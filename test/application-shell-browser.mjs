import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import * as pw from 'playwright';
import {fixture} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
import {programHeaders} from '../src/presentation/program.js';
import {validateApplicationShell} from '../src/application-shell.js';
const engine=process.env.BROWSER_ENGINE??'chromium',output=resolve(process.argv[2]??'test-results/application-shell'),languages=(process.env.DC_SHELL_LANGUAGES??'python,go').split(',');
if(languages.some(language=>!['python','go'].includes(language)))throw new Error('Unsupported shell generator');
await mkdir(output,{recursive:true});const temp=await mkdtemp(resolve(tmpdir(),'application-shell-')),manifests=new Map(),checks=[],errors=[],failedRequests=[];let requestPhase='exercise';const walletCases=[],conversionCalls=[];let dropExecuteReply=false,lostExecuteReplies=0,holdWalletReply=false,releaseWalletReply,walletReplyCaptured;
const x=fixture();x.open('common');x.open('rare');let actor={...x.alice,role:'admin'},api,hostOrigin,browser,holdExecute=false,releaseExecute,capabilitiesOverride;
const convert=x.core.convert.bind(x.core);x.core.convert=(principal,input)=>{const result=convert(principal,input);conversionCalls.push({userId:principal.userId,input:structuredClone(input),result:structuredClone(result)});return result;};
const capabilities=x.core.capabilities.bind(x.core);x.core.capabilities=(...args)=>capabilitiesOverride??capabilities(...args);
const programServer=createServer(async(req,res)=>{try{
  for(const [key,value]of Object.entries(programHeaders(hostOrigin)))res.setHeader(key,value);res.setHeader('access-control-allow-origin','*');
  const path=new URL(req.url,'http://localhost').pathname,asset=/^\/(shop|collection|trading|marketplace)\/(index.html|[a-z-]+\.css)$/.exec(path);
  if(asset){res.setHeader('content-type',path.endsWith('.html')?'text/html':'text/css');res.end(await readFile(resolve(temp,asset[1],asset[2])));return;}
  req.url='/src/presentation'+path;if(await serveReference(req,res,{production:true}))return;res.writeHead(404).end();
}catch{res.writeHead(500).end();}});
const hostServer=createServer(async(req,res)=>{try{
  if(holdExecute&&req.url==='/api/command-intents/execute')await new Promise(resolve=>releaseExecute=resolve);
  if(dropExecuteReply&&req.url==='/api/command-intents/execute'){
    dropExecuteReply=false;res.end=()=>{
      lostExecuteReplies++;
      // Deliver response bytes before truncation so transport retries cannot hide the lost result.
      res.flushHeaders();res.write('{"result":',()=>res.destroy());return res;
    };
  }
  if(holdWalletReply&&req.url==='/api/wallet'){
    holdWalletReply=false;const end=res.end.bind(res);res.end=(...args)=>{releaseWalletReply=()=>end(...args);walletReplyCaptured?.();return res;};
  }
  if(await api?.(req,res))return;
  const path=new URL(req.url,'http://localhost').pathname;
  if(manifests.has(path)){res.setHeader('content-type','application/json');res.end(JSON.stringify(manifests.get(path)));return;}
  if(path==='/shell-harness'){res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Application shell</title><style>body{margin:8px}dialog{max-height:90vh;max-width:90vw;overflow:auto}</style></head><body><main id="root" lang="fr" dir="rtl"></main><main id="second"></main></body></html>');return;}
  if(await serveReference(req,res,{production:true}))return;res.writeHead(404).end();
}catch{res.writeHead(500).end();}});
try{
  for(const language of languages)for(const topology of ['rail','header']){
    const source=fileURLToPath(new URL('../examples/application-shell/generate.'+(language==='python'?'py':'go'),import.meta.url));
    const bytes=execFileSync(language==='python'?process.env.PYTHON??'python':process.env.GO??'go',language==='python'?[source,topology]:['run',source,topology],{windowsHide:true,timeout:60000,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off'}});
    const value=validateApplicationShell(JSON.parse(bytes));manifests.set('/examples/application-shell/'+language+'-'+topology+'.json',value);
  }
  for(const view of ['shop','collection','trading','marketplace'])execFileSync(process.env.PYTHON??'python',[fileURLToPath(new URL('../examples/plugins/python-'+view+'-view.py',import.meta.url)),resolve(temp,view)],{windowsHide:true,timeout:10000});
  await new Promise(resolve=>hostServer.listen(0,'127.0.0.1',resolve));hostOrigin='http://127.0.0.1:'+hostServer.address().port;
  await new Promise(resolve=>programServer.listen(0,'127.0.0.1',resolve));const programOrigin='http://127.0.0.1:'+programServer.address().port;
  api=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:hostOrigin,requirePrincipal:true,exposeOperators:true});
  try{browser=await pw[engine].launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});}catch(error){if(engine!=='chromium'||process.platform!=='win32')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1280,height:1200},reducedMotion:'reduce',hasTouch:true});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  page.on('requestfailed',request=>{failedRequests.push({phase:requestPhase,method:request.method(),path:new URL(request.url()).pathname,resourceType:request.resourceType(),error:request.failure()?.errorText});if(failedRequests.length>20)failedRequests.shift();});
  page.on('response',response=>{if(response.status()>=400&&response.url().includes('/src/'))errors.push('Module '+response.status()+' '+response.url());});await page.goto(hostOrigin+'/shell-harness');
  await page.evaluate(async({programOrigin,first})=>{
    const [{mountFramework},{createClient},{loadApplicationShell}]=await Promise.all([import('/src/ui.js'),import('/src/client.js'),import('/src/application-shell.js')]);
    const test=window.shellTest={mountFramework,loadApplicationShell,client:createClient(),adapters:{},models:{},diagnostics:[]};
    const NativeChannel=MessageChannel;window.MessageChannel=class extends NativeChannel{constructor(){super();const post=this.port1.postMessage.bind(this.port1);this.port1.postMessage=(message,...args)=>{if(message.content?.profile){test.lastSnapshot={profile:message.content.profile,id:message.content.snapshotId};}post(message,...args);};this.port1.addEventListener('message',event=>{if(event.data.intent)test.lastIntent={intent:event.data.intent,id:event.data.snapshotId};});}};
    for(const [name,view,module]of [['shop','shop','shop'],['collection','collection','collection'],['trades','trading','trading'],['marketplace','marketplace','marketplace']]){
      const [adapter,display]=await Promise.all([import('/src/presentation/program-'+module+'-view.js'),import('/src/presentation/'+module+'-display.js')]);
      const capital=module[0].toUpperCase()+module.slice(1),fields=(display[module+'DisplayFields']??['cardName','line','rarity','finish','tags','stats']).filter(field=>field!=='preview'),entry={approved:true,url:programOrigin+'/'+view+'/index.html',version:'1',intents:display[module+'Intents'],[module+'Display']:{profile:'dc.'+module+'-display@1',fields}};
      const renderer=adapter['createProgram'+capital+'View']({programId:'example.'+module,registry:new Map([['example.'+module,entry]]),displayFields:fields,viewportHeight:600,maxMessagesPerSecond:1000,onDiagnostic:event=>test.diagnostics.push(event)});test.adapters[name]=renderer;
    }
    test.views=Object.fromEntries(Object.entries(test.adapters).map(([name,view])=>[name,(model,context)=>{test.models[name]=model;const result=view(model,context);test.instances??={};test.instances[name]=result;return result;}]));
    test.options={client:test.client,sections:['shop','packs','collection','marketplace','trades','wallet','admin'],navigation:'tabs',views:test.views,shell:loadApplicationShell(first)};
    test.app=mountFramework(document.querySelector('#root'),test.options);await test.app.ready;await test.app.shellReady;
  },{programOrigin,first:[...manifests.keys()][0]});
  const nav=page.locator('#root [data-dc-region="navigation"]'),content=page.locator('#root .dc-content'),recovery=page.locator('#root [data-dc-region="recovery"]');
  const ready=async name=>{const profile=name==='trades'?'trading':name;await page.locator('#root dc-program-'+profile).frameLocator('iframe').locator('html[data-dc-'+profile+'-state="ready"]').waitFor();};
  const navigate=async name=>{await nav.locator('[data-view="'+name+'"]').click();if(['shop','collection','marketplace','trades'].includes(name))await ready(name);};
  async function waitForInvokerFocus(invoker,dialogSelector){
    const frame=await invoker.ownerFrame();assert(frame);const frameElement=await frame.frameElement(),deadline=Date.now()+15000;
    const remaining=()=>Math.max(1,deadline-Date.now());
    try{
      await page.waitForFunction(element=>document.activeElement===element,frameElement,{timeout:remaining()});
      await frame.waitForFunction(button=>button.isConnected&&document.activeElement===button,invoker,{timeout:remaining()});
      assert(await invoker.evaluate(button=>button===document.activeElement));
    }catch(error){
      const outer=await page.evaluate(selector=>{const active=document.activeElement,dialog=document.querySelector(selector);return {active:{tag:active?.tagName,view:active?.dataset.view},dialog:{open:dialog?.open??false,modal:dialog?.matches(':modal')??false}};},dialogSelector).catch(()=>null);
      const inner=await invoker.evaluate(button=>({active:{tag:document.activeElement?.tagName,inspect:document.activeElement?.hasAttribute('data-dc-item-inspect'),review:document.activeElement?.hasAttribute('data-dc-product-review')},focused:document.hasFocus(),invoker:{connected:button.isConnected,disabled:button.disabled,active:button===document.activeElement},events:window.shellFocusEvents})).catch(()=>null);
      console.error(JSON.stringify({focusReturn:{outer,inner}}));throw error;
    }finally{await invoker.dispose();await frameElement.dispose();}
  }
  await page.addInitScript(()=>{window.shellFocusEvents=[];for(const type of ['focus','blur','focusin','focusout'])window.addEventListener(type,event=>{window.shellFocusEvents.push({type,target:event.target===window?'window':event.target?.tagName,active:document.activeElement?.tagName,inspect:document.activeElement?.hasAttribute('data-dc-item-inspect')});if(window.shellFocusEvents.length>24)window.shellFocusEvents.shift();},true);});
  await page.evaluate(()=>shellTest.app.setShell(null));await navigate('collection');let defaultFrame=page.locator('#root dc-program-collection').frameLocator('iframe');const defaultInspectInvoker=await defaultFrame.locator('[data-dc-item-inspect]').first().elementHandle();assert(defaultInspectInvoker);await defaultInspectInvoker.click();const defaultInspector=page.locator('#root dialog.dc-inspector-dialog');await defaultInspector.waitFor();assert(await defaultInspector.evaluate(node=>node.open&&node.matches(':modal')));await defaultInspector.press('Escape');await defaultInspector.waitFor({state:'hidden'});await waitForInvokerFocus(defaultInspectInvoker,'#root dialog.dc-inspector-dialog');
  await navigate('shop');let defaultShop=page.locator('#root dc-program-shop').frameLocator('iframe');await defaultShop.locator('[data-dc-shop-search]').fill('common');await defaultShop.getByText('common',{exact:true}).waitFor();await defaultShop.locator('[data-dc-product-handle]').nth(1).waitFor({state:'detached'});const defaultReviewInvoker=await defaultShop.locator('[data-dc-product-review]:not([disabled])').first().elementHandle();assert(defaultReviewInvoker);await defaultReviewInvoker.click();await page.locator('#root dialog.dc-shop-review').getByRole('button',{name:'Close purchase review',exact:true}).click();await waitForInvokerFocus(defaultReviewInvoker,'#root dialog.dc-shop-review');
  async function assertTopology(manifest,narrow){
    const expected=[];let index=0;
    function visit(spec,parent=null){if(spec.name==='overlays')return;const id=++index;expected.push({id,parent,type:spec.type,name:spec.name,text:spec.text,level:spec.level,layout:{...spec.layout,...(narrow?spec.narrow:spec.wide)}});for(const child of spec.children??[])visit(child,id);}
    visit(manifest.tree);
    const mismatches=await page.evaluate(expected=>{const wrapper=document.querySelector('#root [data-dc-shell]'),actual=[...wrapper.querySelectorAll('[data-dc-shell-node]')],errors=[];if(actual.length!==expected.length)errors.push('node count');for(let i=0;i<expected.length;i++){const spec=expected[i],item=actual[i];if(!item||Number(item.dataset.dcShellNode)!==spec.id){errors.push('node order '+spec.id);continue;}const parent=item.parentElement.closest('[data-dc-shell-node]');if((parent?Number(parent.dataset.dcShellNode):null)!==spec.parent)errors.push('parent '+spec.id);if(spec.name&&item.dataset.dcRegion!==spec.name)errors.push('region '+spec.id);if(spec.text!==undefined&&(item.textContent!==spec.text||item.tagName!==(spec.type==='text'?'P':'H'+(spec.level??2))))errors.push('literal '+spec.id);const style=getComputedStyle(item);if(['row','column','grid'].includes(spec.type)){const flow=spec.layout.flow??spec.type;if(style.display!==(flow==='grid'?'grid':'flex')||(flow!=='grid'&&style.flexDirection!==flow))errors.push('flow '+spec.id);if(flow==='grid'&&spec.layout.columns!==undefined&&style.gridTemplateColumns.split(' ').length!==spec.layout.columns)errors.push('columns '+spec.id);}for(const key of ['gap','padding'])if(spec.layout[key]!==undefined&&style[key]!==spec.layout[key]+'px')errors.push(key+' '+spec.id);}return errors;},expected);
    assert.deepEqual(mismatches,[]);
    const regions=await page.locator('#root [data-dc-shell] [data-dc-region]').evaluateAll(nodes=>nodes.map(node=>node.dataset.dcRegion));assert.deepEqual(regions,expected.filter(node=>node.name).map(node=>node.name));
  }
  const currencies=x.core.catalog().currencies,formatWallet=new Intl.NumberFormat('en',{maximumFractionDigits:20});
  async function assertNativeWallet(principal){
    const expected=currencies.map(currency=>({name:currency.name,amount:formatWallet.format(x.core.wallet(principal)[currency.id]??0)}));
    assert.deepEqual(await page.locator('#root .dc-wallet-grid .dc-balance').evaluateAll(items=>items.map(item=>({name:item.querySelector('span').textContent,amount:item.querySelector('strong').textContent}))),expected);
    assert.deepEqual(await page.locator('#root [data-dc-region="balances"] > div').evaluateAll(items=>items.map(item=>({name:item.querySelector('span').textContent,amount:item.querySelector('strong').textContent}))),expected);
    assert.equal(await page.locator('#root [data-dc-region="account"] > strong').textContent(),x.core.me(principal).displayName);
  }
  async function captureWalletRefresh(){
    let timer;const captured=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Wallet reply was not captured')),15000);walletReplyCaptured=()=>{clearTimeout(timer);resolve();};});
    holdWalletReply=true;releaseWalletReply=undefined;
    await page.evaluate(()=>{shellTest.walletRefresh=shellTest.app.refresh();});
    try{await captured;}finally{clearTimeout(timer);walletReplyCaptured=undefined;}
    assert.equal(typeof releaseWalletReply,'function');
  }
  async function qualifyWalletConversion(url){
    requestPhase='wallet-conversion '+url.split('/').at(-1);
    await navigate('wallet');await assertNativeWallet(x.alice);const bobBefore=structuredClone(x.core.wallet(x.bob));
    await captureWalletRefresh();actor={...x.bob,role:'admin'};await page.evaluate(()=>shellTest.app.refresh());await assertNativeWallet(x.bob);
    releaseWalletReply();await page.evaluate(()=>shellTest.walletRefresh);await assertNativeWallet(x.bob);
    actor={...x.alice,role:'admin'};await page.evaluate(()=>shellTest.app.refresh());await assertNativeWallet(x.alice);
    const before=structuredClone(x.core.wallet(x.alice)),eventCount=()=>x.core.events({role:'admin'},{limit:1000}).filter(event=>event.type==='currency.converted').length,eventsBefore=eventCount(),callsBefore=conversionCalls.length,lostBefore=lostExecuteReplies;
    const chooseConversion=async()=>{await page.getByLabel('Amount to spend',{exact:true}).fill('300');await page.getByLabel('From',{exact:true}).selectOption('credits');await page.getByLabel('To',{exact:true}).selectOption('gems');};
    await chooseConversion();dropExecuteReply=true;await page.getByRole('button',{name:'Convert currencies',exact:true}).click();await page.locator('#root .dc-status.dc-error').waitFor();await page.waitForFunction(()=>!document.querySelector('#root').hasAttribute('aria-busy'));
    assert.equal(lostExecuteReplies,lostBefore+1);assert.equal(x.core.wallet(x.alice).credits,before.credits-300);assert.equal(x.core.wallet(x.alice).gems,(before.gems??0)+3);assert.equal(eventCount(),eventsBefore+1);
    const original=conversionCalls[callsBefore],pending=x.core.commandIntents(actor,{command:'convert'}).items;assert.equal(pending.length,1);assert.equal(pending[0].input.key,original.input.key);assert.equal(pending[0].state,'completed');
    await page.evaluate(()=>shellTest.app.refresh());await recovery.getByRole('button',{name:'Recover currency conversion',exact:true}).click();await recovery.getByRole('button',{name:'Recover currency conversion',exact:true}).waitFor({state:'detached'});await page.waitForFunction(()=>!document.querySelector('#root').hasAttribute('aria-busy'));
    assert.equal(eventCount(),eventsBefore+1);assert.equal(x.core.wallet(x.alice).credits,before.credits-300);assert.equal(new Set(conversionCalls.slice(callsBefore).map(call=>call.input.key)).size,1);assert(conversionCalls.slice(callsBefore).every(call=>call.result.id===original.result.id));await assertNativeWallet(x.alice);
    await chooseConversion();await page.getByRole('button',{name:'Convert currencies',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#root').hasAttribute('aria-busy')&&document.querySelector('#root .dc-status').classList.contains('is-success'));
    assert.equal(eventCount(),eventsBefore+2);assert.equal(x.core.wallet(x.alice).credits,before.credits-600);assert.equal(x.core.wallet(x.alice).gems,(before.gems??0)+6);const repeated=conversionCalls.at(-1);assert.notEqual(repeated.input.key,original.input.key);assert.notEqual(repeated.result.id,original.result.id);assert.deepEqual({...repeated.input,key:original.input.key},original.input);assert.deepEqual(x.core.wallet(x.bob),bobBefore);await assertNativeWallet(x.alice);
    await captureWalletRefresh();await page.evaluate(()=>shellTest.app.dispose());assert.equal(await page.locator('#root').evaluate(root=>root.childElementCount),0);actor={...x.bob,role:'admin'};
    await page.evaluate(async url=>{shellTest.app=shellTest.mountFramework(document.querySelector('#root'),{...shellTest.options,shell:shellTest.loadApplicationShell(url)});await shellTest.app.ready;await shellTest.app.shellReady;},url);await navigate('wallet');await assertNativeWallet(x.bob);
    releaseWalletReply();await page.evaluate(()=>shellTest.walletRefresh);await assertNativeWallet(x.bob);actor={...x.alice,role:'admin'};await page.evaluate(()=>shellTest.app.refresh());await assertNativeWallet(x.alice);
    walletCases.push({manifest:url.split('/').at(-1),principalSwitch:true,staleWalletReplyIgnored:true,lostReplyRecovered:true,oneRecoveredConversion:true,deliberateSecondConversion:true,bobWalletUnchanged:true,disposeRemount:true});
    checks.push(url.split('/').at(-1)+': actual native wallet/current-principal privacy, stale reply fencing, dropped HTTP conversion reply/original intent recovery with one debit, deliberate second conversion, dispose/remount');requestPhase='exercise';
  }
  for(const [url,manifest]of manifests){
    await page.evaluate(async url=>{await shellTest.app.setShell(shellTest.loadApplicationShell(url));},url);
    assert.equal(await page.locator('#root [data-dc-shell]').count(),1);assert.equal(await page.locator('#root [data-dc-region="overlays"]').evaluate(node=>node.parentElement.id),'root');
    await assertTopology(manifest,false);
    await qualifyWalletConversion(url);
    await navigate('collection');const frame=page.locator('#root dc-program-collection').frameLocator('iframe');
    const inspectInvoker=await frame.locator('[data-dc-item-inspect]').first().elementHandle();assert(inspectInvoker);await inspectInvoker.click();const inspector=page.locator('#root dialog.dc-inspector-dialog');await inspector.waitFor();assert(await inspector.evaluate(node=>node.open&&node.matches(':modal')));await inspector.press('Escape');await inspector.waitFor({state:'hidden'});await waitForInvokerFocus(inspectInvoker,'#root dialog.dc-inspector-dialog');
    for(let index=0;index<2;index++)await frame.locator('[data-dc-item-select]').nth(index).check();await frame.locator('[data-dc-collection-intent="compare"]').click();await inspector.waitFor();assert(await inspector.evaluate(node=>node.matches(':modal')));await inspector.press('Escape');
    const beforeReview=x.core.wallet(x.alice).credits;await navigate('shop');const shopFrame=page.locator('#root dc-program-shop').frameLocator('iframe');await shopFrame.locator('[data-dc-shop-search]').fill('common');await shopFrame.getByText('common',{exact:true}).waitFor();await shopFrame.locator('[data-dc-product-handle]').nth(1).waitFor({state:'detached'});const reviewInvoker=await shopFrame.locator('[data-dc-product-review]:not([disabled])').first().elementHandle();assert(reviewInvoker);await reviewInvoker.click();const review=page.locator('#root dialog.dc-shop-review');await review.waitFor();assert.equal(x.core.wallet(x.alice).credits,beforeReview);assert(await review.evaluate(node=>node.matches(':modal')));await review.getByRole('button',{name:'Close purchase review',exact:true}).click();await waitForInvokerFocus(reviewInvoker,'#root dialog.dc-shop-review');
    await navigate('trades');await navigate('marketplace');await navigate('collection');
    const before=x.core.wallet(x.alice).credits,intent=x.core.registerCommandIntent(actor,{command:'purchase',input:x.core.quote(actor,{productId:'common',quantity:1})});x.core.executeCommandIntent(actor,{id:intent.id});
    await page.evaluate(()=>shellTest.app.refresh());await ready('collection');assert.equal(await recovery.locator('button').count(),1);assert.equal(await recovery.evaluate(node=>!!node.closest('.dc-content')),false);
    holdExecute=true;await recovery.getByRole('button',{name:'Recover pack purchase',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#root').getAttribute('aria-busy')==='true');assert.equal(await page.locator('#root [role="status"]').textContent(),'Working…');
    holdExecute=false;releaseExecute?.();await recovery.locator('button').waitFor({state:'detached'});assert.equal(x.core.wallet(x.alice).credits,before-10);x.core.acknowledgeCommandIntent(actor,{id:intent.id});
    const collectionNav=nav.locator('[data-view="collection"]');await collectionNav.focus();await page.evaluate(async()=>{shellTest.navIdentity=document.querySelector('#root [data-view="collection"]');shellTest.topology=document.querySelector('#root [data-dc-shell]');await shellTest.app.refresh();});assert.deepEqual(await page.evaluate(()=>({node:shellTest.navIdentity===document.querySelector('#root [data-view="collection"]'),topology:shellTest.topology===document.querySelector('#root [data-dc-shell]'),focus:document.activeElement===shellTest.navIdentity})),{node:true,topology:true,focus:true});
    await page.setViewportSize({width:390,height:844});await navigate('wallet');assert(await nav.locator('[data-view="wallet"]').isVisible());await nav.locator('[data-view="collection"]').tap();await ready('collection');assert.equal(await page.locator('#root').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
    await assertTopology(manifest,true);await page.setViewportSize({width:1280,height:1200});
    checks.push(url.split('/').at(-1)+': production loader/composer, native wrapped/reordered chrome, protected recovery with one debit, embedded shop/collection/trading/marketplace, modal/focus, stable refresh, touch narrow layout');
  }
  await navigate('admin');await page.locator('#root [data-admin-tab="website"]').click();const purchases=page.locator('#root [aria-label="Pack purchases"]');await purchases.uncheck();await nav.locator('[data-view="collection"]').click();await page.locator('#root .da-leave').waitFor();await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await nav.locator('[data-view="admin"]').getAttribute('aria-current'),'page');await nav.locator('[data-view="collection"]').click();await page.getByRole('button',{name:'Discard draft and continue',exact:true}).click();await ready('collection');
  await page.evaluate(async()=>{shellTest.second=shellTest.mountFramework(document.querySelector('#second'),{client:shellTest.client,sections:['wallet','packs'],navigation:'tabs',shell:shellTest.loadApplicationShell('/examples/application-shell/python-header.json')});await shellTest.second.ready;await shellTest.second.shellReady;});assert.equal(await page.locator('[data-dc-shell]').count(),2);assert.notEqual(await page.locator('#root [data-dc-shell]').getAttribute('data-dc-shell'),await page.locator('#second [data-dc-shell]').getAttribute('data-dc-shell'));
  const pending=x.core.registerCommandIntent(actor,{command:'purchase',input:x.core.quote(actor,{productId:'common',quantity:1})});x.core.executeCommandIntent(actor,{id:pending.id});await page.evaluate(async()=>{await shellTest.app.setShell({profile:'invalid'});await shellTest.app.refresh();});assert.equal(await page.locator('#root [data-dc-shell]').count(),0);await recovery.getByRole('button',{name:'Recover pack purchase',exact:true}).click();await recovery.locator('button').waitFor({state:'detached'});x.core.acknowledgeCommandIntent(actor,{id:pending.id});
  await page.evaluate(async()=>{shellTest.resolveLate=null;shellTest.late=shellTest.app.setShell(new Promise(resolve=>shellTest.resolveLate=resolve));});actor={...x.bob,role:'admin'};await page.evaluate(()=>shellTest.app.refresh());await page.evaluate(async()=>{shellTest.resolveLate(await shellTest.loadApplicationShell('/examples/application-shell/python-rail.json'));shellTest.lateResult=await shellTest.late;});assert.equal(await page.evaluate(()=>shellTest.lateResult),false);
  const disabledCapabilities=x.core.capabilities(actor);capabilitiesOverride={...disabledCapabilities,available:Object.fromEntries(Object.keys(disabledCapabilities.available).map(key=>[key,false])),draining:[],history:Object.fromEntries(Object.keys(disabledCapabilities.history).map(key=>[key,false]))};await page.evaluate(()=>shellTest.app.refresh());assert.equal(await nav.locator('[data-view="shop"]').count(),0);assert.equal(await nav.locator('[aria-current="page"]').getAttribute('data-view'),'collection');
  await page.evaluate(async()=>{shellTest.second.dispose();await shellTest.app.setShell(shellTest.loadApplicationShell('/examples/application-shell/python-header.json'));shellTest.app.dispose();for(const adapter of Object.values(shellTest.adapters))adapter.dispose();});assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.locator('#root').getAttribute('lang'),'fr');assert.equal(await page.locator('#root').getAttribute('dir'),'rtl');
  requestPhase='remount';
  await page.evaluate(async()=>{shellTest.remount=shellTest.mountFramework(document.querySelector('#root'),{client:shellTest.client,sections:['collection','wallet'],navigation:'sections',shell:shellTest.loadApplicationShell('/examples/application-shell/python-rail.json')});await shellTest.remount.ready;await shellTest.remount.shellReady;});assert.equal(await page.locator('#root [data-dc-region="account"]').isVisible(),false);assert.equal(await page.locator('#root .dc-content > section').count(),1);await page.evaluate(()=>shellTest.remount.dispose());
  checks.push('Native admin dirty leave cancellation/approval, two independent instances/styles, invalid fallback recovery, late account fencing, capability active fallback, sections mode, remount/dispose/lang/dir cleanup');assert.deepEqual(errors,[]);
  await writeFile(resolve(output,'report.json'),JSON.stringify({engine,languages,checks,walletCases,errors},null,2)+'\n');console.log(JSON.stringify({engine,languages,checks,walletCases},null,2));
}catch(error){console.error({failedRequests});console.error(await browser?.contexts()[0]?.pages()[0]?.evaluate(()=>({status:document.querySelector('[role="status"]')?.textContent,active:document.querySelector('[aria-current="page"]')?.dataset.view,diagnostics:window.shellTest?.diagnostics,snapshot:window.shellTest?.lastSnapshot,intent:window.shellTest?.lastIntent})).catch(()=>null));throw error;}
finally{holdExecute=false;releaseExecute?.();releaseWalletReply?.();await browser?.close();x.core.close();for(const server of [hostServer,programServer]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(temp,{recursive:true,force:true});}
