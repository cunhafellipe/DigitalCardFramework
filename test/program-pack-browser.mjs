import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import * as pw from 'playwright';
import {fixture,admin} from './helpers.js';
import {CardFramework} from '../src/index.js';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
import {programHeaders} from '../src/presentation/program.js';

const output=resolve(process.argv[2]??'test-results/program-pack'),engine=process.env.BROWSER_ENGINE??'chromium';
await mkdir(output,{recursive:true});
const temp=await mkdtemp(resolve(tmpdir(),'program-pack-')),checks=[],errors=[],calls={quotes:[],purchases:[],openings:[]};
const seed=fixture({change(catalog){const product=catalog.products.find(product=>product.id==='common');product.allocationStrategy={algorithm:'weighted-deck@1',version:1,deckScope:'purchase-slot'};product.slots[0].count=2;product.slots[0].pool[0].weight=4;product.duplicatePolicy={scope:'none',fallback:'allow'};catalog.products=[product,catalog.products.find(product=>product.id==='rare')];}});
const catalog=seed.c,x={};seed.core.close();
let browser,api,hostOrigin,allocator;
const programServer=createServer(async(request,response)=>{
  try{
    for(const [key,value]of Object.entries(programHeaders(hostOrigin)))response.setHeader(key,value);response.setHeader('access-control-allow-origin','*');
    const path=new URL(request.url,'http://localhost').pathname;
    if(path==='/'||path==='/index.html'){response.setHeader('content-type','text/html');response.end(await readFile(resolve(temp,'index.html')));return;}
    if(path==='/card.css'){response.setHeader('content-type','text/css');response.end(await readFile(resolve(temp,'card.css')));return;}
    if(['/program-bootstrap.js','/program.js','/editor-display.js','/data.js','/album-display.js','/opener-display.js','/media.js'].includes(path)){response.setHeader('content-type','text/javascript');response.end(await readFile(new URL('../src/presentation'+path,import.meta.url)));return;}
    response.writeHead(404);response.end();
  }catch(error){response.writeHead(500);response.end(error.message);}
});
const hostServer=createServer(async(request,response)=>{
  try{
    if(await api?.(request,response))return;
    if(request.url==='/pack-harness'){response.setHeader('content-type','text/html');response.end('<!doctype html><html lang="en"><title>Reviewed program packs</title><style>body{font:16px system-ui;margin:20px}main{min-height:500px}.probes{height:230px;margin:20px}.probes dc-program-pack{width:300px;display:block}</style><main id="root"></main><section class="probes" id="probes"></section></html>');return;}
    if(await serveReference(request,response))return;response.writeHead(404);response.end();
  }catch(error){response.writeHead(500);response.end(error.message);}
});
try{
  assert.equal(execFileSync(process.env.PYTHON??'python',[fileURLToPath(new URL('../examples/plugins/python-program-card.py',import.meta.url)),'--pack',temp],{windowsHide:true,timeout:10000,maxBuffer:16384}).length,0);
  await new Promise(resolve=>hostServer.listen(0,'127.0.0.1',resolve));hostOrigin='http://127.0.0.1:'+hostServer.address().port;
  await new Promise(resolve=>programServer.listen(0,'127.0.0.1',resolve));const programOrigin='http://127.0.0.1:'+programServer.address().port;
  const token='synthetic-pack-allocation-credential';
  allocator=spawn(process.execPath,[fileURLToPath(new URL('../examples/plugins/node-allocation-provider.mjs',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,ALLOCATION_PROVIDER_TOKEN:token,ALLOCATION_PROVIDER_ID:'example.allocation'}});allocator.stderr.resume();
  const port=await new Promise((fulfill,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Allocation receiver readiness timed out')),10000);allocator.once('error',error=>{clearTimeout(timer);reject(error);});allocator.once('exit',()=>{clearTimeout(timer);reject(Error('Allocation receiver exited before readiness'));});allocator.stdout.on('data',data=>{output+=data;if(output.includes('\n')){clearTimeout(timer);fulfill(Number(output.trim()));}});});assert(Number.isInteger(port)&&port>0&&port<=65535);
  x.core=new CardFramework({clock:()=> '2026-09-30T12:00:00.000Z',random:()=>0,remoteAllocation:{algorithm:'weighted-deck@1',scope:'catalog-purchase',providerId:'example.allocation',url:'http://127.0.0.1:'+port+'/allocate-packs',token,allowLoopbackHttp:true,timeoutMs:5000}});
  x.core.publishCatalog(admin,catalog);const user=x.core.registerUser(admin,{provider:'test',subject:'pack-collector',displayName:'Pack collector'});x.alice={userId:user.id};x.core.grantCurrency(admin,{userId:user.id,currencyId:'credits',amount:10000,reason:'Test funding',key:'fund'});
  // Observe while executing the real core, receiver and HTTP/durable-command boundaries.
  const quote=x.core.quote.bind(x.core);x.core.quote=(actor,input)=>{const result=quote(actor,input);calls.quotes.push(structuredClone(result));return result;};
  for(const [method,list]of [['purchaseAsync','purchases'],['openPack','openings']]){const original=x.core[method].bind(x.core);x.core[method]=(actor,input,...options)=>{calls[list].push(structuredClone(input));return original(actor,input,...options);};}
  api=createApiHandler({framework:x.core,resolveIdentity:()=>x.alice,allowedOrigin:hostOrigin,requirePrincipal:true});
  try{browser=await pw[engine].launch({headless:process.env.HEADED!=='1'});}catch(error){if(engine!=='chromium')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.goto(hostOrigin+'/pack-harness');
  await page.evaluate(async programOrigin=>{
    const [{createClient},{mountFramework},{createProgramPackRenderer}]=await Promise.all([import('/src/client.js'),import('/src/ui.js'),import('/src/presentation/program-pack-view.js')]);
    const client=createClient(),registry=new Map([['example.pack',{approved:true,version:'1.0.0',url:programOrigin+'/',title:'Celestial Archive pack',intents:['select']}]]);
    window.packTest={client,registry,createProgramPackRenderer,diagnostics:[],trace:[],throwCosmetic:false};
    window.packTest.record=event=>{const trace=window.packTest.trace;trace.push({event,time:performance.now(),hidden:document.hidden,busy:document.querySelector('#root').getAttribute('aria-busy'),active:document.activeElement?.textContent?.slice(0,100),ownedBounds:[...document.querySelectorAll('.dc-owned-pack dc-program-pack')].map(node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom,viewport:innerHeight})),openButtons:[...document.querySelectorAll('.dc-owned-pack button')].filter(button=>button.textContent==='Open pack').map(button=>({disabled:button.disabled,connected:button.isConnected,focused:document.activeElement===button})),frames:document.querySelectorAll('.dc-owned-pack iframe').length});if(trace.length>64)trace.shift();};document.addEventListener('visibilitychange',()=>window.packTest.record('visibility'));new MutationObserver(rows=>{if(rows.some(row=>[...row.addedNodes,...row.removedNodes].some(node=>node.nodeType===1&&(node.matches?.('iframe,.dc-owned-pack')||node.querySelector?.('iframe,.dc-owned-pack')))))window.packTest.record('frame-or-row-change');}).observe(document.querySelector('#root'),{childList:true,subtree:true});const renderer=window.packTest.renderer=createProgramPackRenderer({registry,products:{common:'example.pack'},onDiagnostic:event=>window.packTest.diagnostics.push(event)});
    const packRenderer=(product,options)=>{const selected=options.onSelect;const view=renderer(product,{...options,onSelect:model=>{window.packTest.record(options.small?'owned-onSelect-before':'shop-onSelect-before');selected?.(model);window.packTest.record(options.small?'owned-onSelect-after':'shop-onSelect-after');}});if(view.setPresentationInputs){const update=view.setPresentationInputs;view.setPresentationInputs=inputs=>{update(inputs);if(window.packTest.throwCosmetic)throw new Error('Cosmetic input failure');};}return view;};
    window.packTest.view=mountFramework(document.querySelector('#root'),{client,sections:['shop','packs'],navigation:'tabs',packRenderer});await window.packTest.view.ready;
  },programOrigin);
  const product=page.locator('.dc-product').filter({has:page.locator('dc-program-pack')}),program=product.locator('dc-program-pack'),native=page.locator('.dc-product').filter({has:page.getByRole('heading',{name:'rare',exact:true})});
  await program.frameLocator('iframe').locator('html[data-dc-side="front"]').waitFor();assert.equal(await program.frameLocator('iframe').locator('.crimp-top').count(),1);
  assert.equal(await native.locator('dc-program-pack').count(),0);assert.equal(await native.locator('.dc-pack-art').count(),1);
  await product.getByLabel('Packs',{exact:true}).fill('2');
  const review=product.getByRole('button',{name:'Review purchase · 20 Credits',exact:true});
  await program.frameLocator('iframe').getByRole('button',{name:'Select Celestial Archive pack',exact:true}).click();
  await page.waitForFunction(button=>document.activeElement===button,await review.elementHandle(),{timeout:20000});assert(await review.evaluate(button=>document.activeElement===button));assert.equal(calls.quotes.length,0);assert.equal(calls.purchases.length,0);assert.equal(calls.openings.length,0);
  await program.getByRole('button',{name:'Show pack back',exact:true}).click();await program.frameLocator('iframe').locator('html[data-dc-side="back"]').waitFor();
  await program.getByRole('button',{name:'Show pack front',exact:true}).click();await program.frameLocator('iframe').locator('html[data-dc-side="front"]').waitFor();
  await review.click();const buy=product.getByRole('button',{name:'Buy reviewed packs · 20 Credits',exact:true});await buy.waitFor();
  assert.equal(calls.quotes.length,1);assert.equal(calls.purchases.length,0);assert.equal(x.core.packs(x.alice).length,0);
  await buy.click();await page.getByRole('button',{name:'Open pack',exact:true}).first().waitFor();
  assert.equal(calls.purchases.length,1);const {key,...submitted}=calls.purchases[0];assert.equal(typeof key,'string');assert.deepEqual(submitted,calls.quotes[0]);
  assert.equal(x.core.packs(x.alice).length,2);assert.equal(x.core.wallet(x.alice).credits,9980);assert.equal(x.core.inventory(x.alice).length,0);
  checks.push('Generated structural pack appearance installs in real shop; selection only focuses review, native front/back works, reviewed allocation quote is submitted unchanged by one explicit authoritative purchase');

  const unopened=page.locator('.dc-owned-pack').filter({has:page.getByRole('button',{name:'Open pack',exact:true})}).first();await page.waitForFunction(()=>document.querySelector('#root').getAttribute('aria-busy')!=='true',null,{timeout:20000});await unopened.scrollIntoViewIfNeeded();
  await unopened.locator('dc-program-pack').frameLocator('iframe').locator('html[data-dc-side]').waitFor();
  await page.evaluate(()=>window.packTest.record('before-owned-click'));const ownedFrame=await(await unopened.locator('dc-program-pack iframe').elementHandle()).contentFrame();await ownedFrame.getByRole('button',{name:'Select Celestial Archive pack',exact:true}).click();assert(await unopened.locator('dc-program-pack iframe').evaluate((frame,current)=>frame===current,await ownedFrame.frameElement()),'Selecting a visible pack must retain its ready frame');const ownedSignal=await ownedFrame.locator('html').evaluate(root=>({side:root.dataset.dcSide})).catch(error=>({lostFrame:error.message}));await page.evaluate(signal=>{window.packTest.record('after-owned-click');window.packTest.trace.at(-1).signal=signal;},ownedSignal);
  await page.waitForFunction(button=>document.activeElement===button,await unopened.getByRole('button',{name:'Open pack',exact:true}).elementHandle(),{timeout:20000});assert(await unopened.getByRole('button',{name:'Open pack',exact:true}).evaluate(button=>document.activeElement===button));assert.equal(calls.openings.length,0);
  await page.evaluate(()=>{window.packTest.throwCosmetic=true;});await unopened.getByRole('button',{name:'Open pack',exact:true}).click();
  await page.getByRole('button',{name:'Reveal next',exact:true}).waitFor();assert.equal(calls.openings.length,1);assert.equal(x.core.inventory(x.alice).length,2);
  const committed=structuredClone(x.core.inventory(x.alice)),opened=page.locator('.dc-owned-pack').filter({has:page.getByRole('button',{name:'Replay pack',exact:true})}),sealed=page.locator('.dc-owned-pack').filter({has:page.getByRole('button',{name:'Open pack',exact:true})});
  const frameOf=async row=>(await row.locator('iframe').elementHandle()).contentFrame();
  await opened.locator('dc-program-pack').frameLocator('iframe').locator('html[data-dc-side]').waitFor();await sealed.locator('dc-program-pack').frameLocator('iframe').locator('html[data-dc-side]').waitFor();
  await page.getByRole('button',{name:'Reveal next',exact:true}).click();await(await frameOf(opened)).waitForFunction(()=>document.documentElement.style.getPropertyValue('--dc-reveal-progress')==='0.5');
  assert.equal(await sealed.locator('dc-program-pack').frameLocator('iframe').locator('html').evaluate(root=>root.style.getPropertyValue('--dc-reveal-progress')),'0');
  await page.getByRole('button',{name:'Reveal all',exact:true}).click();await(await frameOf(opened)).waitForFunction(()=>document.documentElement.style.getPropertyValue('--dc-reveal-progress')==='1');
  await page.getByRole('button',{name:'Replay reveal',exact:true}).click();await(await frameOf(opened)).waitForFunction(()=>document.documentElement.style.getPropertyValue('--dc-reveal-progress')==='0');
  assert.deepEqual(x.core.inventory(x.alice),committed);assert.equal(calls.openings.length,1);assert.equal(calls.purchases.length,1);assert.equal(x.core.wallet(x.alice).credits,9980);
  checks.push('Owned artwork selection only focuses Open; real opening commits two cards once, cosmetic progress follows only its receipt, throwing renderer inputs do not interrupt native reveal/replay or change allocation/payment');

  await page.evaluate(()=>window.packTest.renderer.setEnabled(false));assert.equal(await page.locator('#root iframe').count(),0);
  assert.equal(await page.locator('.dc-owned-pack dc-program-pack > .dc-pack-art').count(),2);await opened.locator('dc-program-pack').press('Enter');
  assert(await opened.getByRole('button',{name:'Replay pack',exact:true}).evaluate(button=>document.activeElement===button));
  await page.evaluate(()=>window.packTest.renderer.setEnabled(true));await opened.locator('dc-program-pack').frameLocator('iframe').locator('html[data-dc-side]').waitFor();
  await page.screenshot({path:resolve(output,'owned-program-packs.png'),fullPage:true});
  await page.evaluate(()=>{window.packTest.view.dispose();window.packTest.renderer.dispose();window.packTest.renderer.setEnabled(true);});assert.equal(await page.locator('#root iframe').count(),0);
  await page.evaluate(async()=>{
    const {createProgramPackRenderer,registry}=window.packTest,product=(await window.packTest.client.catalog()).products[0],preview=document.createElement('span');preview.textContent='Preserved preview';
    const renderer=window.packTest.fallbackRenderer=createProgramPackRenderer({registry:new Map([['example.pack',{...registry.get('example.pack'),approved:false}]]),products:{[product.id]:'example.pack'},onDiagnostic:event=>window.packTest.diagnostics.push(event)});
    window.packTest.fallback=renderer({...product,artwork:{front:'/missing-pack.png'}},{previewCards:[preview]});document.querySelector('#probes').append(window.packTest.fallback.node);
  });
  await page.waitForFunction(()=>window.packTest.diagnostics.some(event=>event.code==='PROGRAM_UNAVAILABLE'));
  assert.equal(await page.locator('#probes iframe').count(),0);await page.getByText('Preserved preview',{exact:true}).waitFor();
  const terminal=await page.evaluate(()=>{const {fallback,fallbackRenderer}=window.packTest;fallbackRenderer.dispose();const text=fallback.node.textContent;fallback.setSide('back');return fallback.node.textContent===text&&!fallback.node.querySelector('button');});assert(terminal);
  checks.push('Disabled and unapproved programs retain native pack previews; focus survives disable and terminal cleanup removes frames, subscriptions and host side controls');
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'result.json'),JSON.stringify({engine,checks,errors,trace:await page.evaluate(()=>window.packTest.trace)},null,2));console.log(JSON.stringify({engine,checks,errors}));
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page)await writeFile(resolve(output,'failure.json'),JSON.stringify({message:error.message,status:await page.locator('.dc-status').allTextContents(),errors,calls,trace:await page.evaluate(()=>window.packTest.trace),diagnostics:await page.evaluate(()=>window.packTest.diagnostics)},null,2));throw error;
}finally{await browser?.close();for(const server of [hostServer,programServer]){server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));}if(allocator&&allocator.exitCode===null&&allocator.signalCode===null){const ended=once(allocator,'exit');allocator.kill();await ended;}x.core?.close();await rm(temp,{recursive:true,force:true});}
