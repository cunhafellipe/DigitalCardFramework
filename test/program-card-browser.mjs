import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import * as pw from 'playwright';
import {fixture} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
import {programHeaders} from '../src/presentation/program.js';

const output=resolve(process.argv[2]??'test-results/program-card'),engine=process.env.BROWSER_ENGINE??'chromium';
await mkdir(output,{recursive:true});
const temp=await mkdtemp(resolve(tmpdir(),'program-card-')),x=fixture(),checks=[],errors=[];x.open();x.open('rare');
let browser,api,forbidden=0;
const programServer=createServer(async(request,response)=>{
  try{
    for(const [key,value]of Object.entries(programHeaders(hostOrigin)))response.setHeader(key,value);
    response.setHeader('access-control-allow-origin','*');
    if(request.url==='/silent'){response.setHeader('content-type','text/html');response.end('<!doctype html><title>Silent program</title>');return;}
    const path=new URL(request.url,'http://localhost').pathname;
    if(path==='/'||path==='/index.html'){response.setHeader('content-type','text/html');response.end(await readFile(resolve(temp,'index.html')));return;}
    if(path==='/card.css'){response.setHeader('content-type','text/css');response.end(await readFile(resolve(temp,'card.css')));return;}
    if(['/program-bootstrap.js','/program.js','/editor-display.js','/collection-display.js','/shop-display.js','/trading-display.js','/data.js','/album-display.js','/opener-display.js','/media.js'].includes(path)){response.setHeader('content-type','text/javascript');response.end(await readFile(new URL('../src/presentation'+path,import.meta.url)));return;}
    forbidden++;response.writeHead(404);response.end();
  }catch(error){response.writeHead(500);response.end(error.message);}
});
const hostServer=createServer(async(request,response)=>{
  try{
    if(await api?.(request,response))return;
    if(request.url==='/program-harness'){response.setHeader('content-type','text/html');response.end('<!doctype html><html lang="en"><title>Reviewed program cards</title><style>body{font:16px system-ui;margin:20px}main{min-height:600px}.probes dc-program-card{width:240px;height:360px;display:inline-block!important}.probes{display:flex;gap:12px}</style><main id="root"></main><section class="probes" id="probes"></section></html>');return;}
    if(await serveReference(request,response))return;response.writeHead(404);response.end();
  }catch(error){response.writeHead(500);response.end(error.message);}
});
let hostOrigin;
try{
  assert.equal(execFileSync(process.env.PYTHON??'python',[fileURLToPath(new URL('../examples/plugins/python-program-card.py',import.meta.url)),temp],{windowsHide:true,timeout:10000,maxBuffer:16384}).length,0);
  await new Promise(resolve=>hostServer.listen(0,'127.0.0.1',resolve));hostOrigin='http://127.0.0.1:'+hostServer.address().port;
  await new Promise(resolve=>programServer.listen(0,'127.0.0.1',resolve));const programOrigin='http://127.0.0.1:'+programServer.address().port;
  api=createApiHandler({framework:x.core,resolveIdentity:()=>x.alice,allowedOrigin:hostOrigin,requirePrincipal:true});
  try{browser=await pw[engine].launch({headless:process.env.HEADED!=='1'});}catch(error){if(engine!=='chromium')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(hostOrigin+'/program-harness');
  await page.evaluate(async programOrigin=>{
    const [{createClient},{mountFramework},{createProgramCardRenderer}]=await Promise.all([import('/src/client.js'),import('/src/ui.js'),import('/src/presentation/program-card-view.js')]);
    const registry=new Map([['example.dom-card',{approved:true,version:'1.0.0',url:programOrigin+'/',title:'Celestial Archive',intents:['select']}]]);
    window.programTest={registry,createProgramCardRenderer,diagnostics:[],renderer:createProgramCardRenderer({registry,cards:{dawn:'example.dom-card',aurora:'example.dom-card'},onDiagnostic:event=>window.programTest.diagnostics.push(event)})};
    window.programTest.channels=[];const NativeChannel=window.MessageChannel;
    window.MessageChannel=class extends NativeChannel{constructor(){super();window.programTest.channels.push(this);this.port1.addEventListener('message',event=>{this.received=event.data;});}};
    window.programTest.view=mountFramework(document.querySelector('#root'),{client:createClient(),sections:['collection'],cardRenderer:window.programTest.renderer});await window.programTest.view.ready;
  },programOrigin);
  const first=page.locator('.dc-collection-grid dc-program-card').first(),second=page.locator('.dc-collection-grid dc-program-card').nth(1);
  await first.frameLocator('iframe').locator('html[data-dc-side="front"]').waitFor();await second.frameLocator('iframe').locator('html[data-dc-side="front"]').waitFor();
  assert.equal(await first.frameLocator('iframe').locator('.planet').count(),1);assert.equal(await first.frameLocator('iframe').locator('.face-back').count(),1);
  assert.equal(await first.locator('iframe').getAttribute('sandbox'),'allow-scripts');
  await first.evaluate(node=>node.setPresentationInputs({tilt:{x:.75,y:-.4},revealProgress:.3,privateCopyId:'never-forwarded',binding:()=>{throw new Error('Private binding must never be evaluated');}}));
  const frameOf=async node=>(await node.locator('iframe').elementHandle()).contentFrame();
  await(await frameOf(first)).waitForFunction(()=>Number(document.documentElement.style.getPropertyValue('--dc-tilt-x'))===.75);
  assert.equal(await second.frameLocator('iframe').locator('html').evaluate(root=>root.style.getPropertyValue('--dc-tilt-x')),'0');
  const isolated=await first.frameLocator('iframe').locator('html').evaluate(async()=>{let parentBlocked=false,networkBlocked=false;try{parent.document.body;}catch{parentBlocked=true;}try{await fetch('/forbidden');}catch{networkBlocked=true;}return {parentBlocked,networkBlocked};});assert.deepEqual(isolated,{parentBlocked:true,networkBlocked:true});assert.equal(forbidden,0);
  await first.frameLocator('iframe').getByRole('button',{name:'Select Celestial Archive card',exact:true}).click();
  const inspector=page.locator('.dc-inspector-dialog'),inspectorCard=inspector.locator('dc-program-card');
  await inspectorCard.frameLocator('iframe').locator('html[data-dc-side="front"]').waitFor();
  const stage=inspector.locator('.dc-3d-stage');await stage.focus();await stage.press('ArrowRight');
  await page.waitForFunction(()=>document.querySelector('.dc-inspector-dialog .dc-3d-stage').dataset.yaw==='15');
  await(await frameOf(inspectorCard)).waitForFunction(()=>Number(document.documentElement.style.getPropertyValue('--dc-tilt-x'))>0);
  await inspector.getByRole('button',{name:'Flip',exact:true}).click();await inspectorCard.frameLocator('iframe').locator('html[data-dc-side="back"]').waitFor();
  await page.screenshot({path:resolve(output,'custom-inspection.png'),fullPage:true});
  await inspector.getByRole('button',{name:'Close inspection',exact:true}).click();
  checks.push('Actual default collector installs generated structural DOM renderer; independent sessions receive bounded inputs, granted selection opens native inspection, keyboard rotation and flip update custom faces without private data or network/parent access');

  const remount=await page.evaluate(()=>{
    const {renderer}=window.programTest,node=document.querySelector('.dc-collection-grid dc-program-card'),old=node.querySelector('iframe'),lateLoad=old.onload,lateMessage=window.programTest.channels.find(channel=>channel.port1.onmessage).port1.onmessage;
    renderer.setEnabled(false);const disabled=document.querySelectorAll('#root iframe').length===0&&node.querySelector('.dc-card:not(dc-program-card)').style.visibility!== 'hidden';
    renderer.setEnabled(true);lateLoad();lateMessage({data:{version:1,type:'intent',intent:'select',nonce:'obsolete'}});return {disabled,oldDetached:!old.isConnected};
  });assert.deepEqual(remount,{disabled:true,oldDetached:true});
  await first.frameLocator('iframe').locator('html[data-dc-side="front"]').waitFor();
  await page.evaluate(()=>window.programTest.renderer.setEnabled(false));await first.press('Enter');await inspector.waitFor();
  assert.equal(await inspector.locator('iframe').count(),0);await inspector.getByRole('button',{name:'Flip',exact:true}).click();assert.equal(await stage.getAttribute('data-yaw'),'180');
  await inspector.getByRole('button',{name:'Close inspection',exact:true}).click();await page.evaluate(()=>window.programTest.renderer.setEnabled(true));await first.frameLocator('iframe').locator('html[data-dc-side="front"]').waitFor();
  await first.evaluate(node=>{window.programTest.detached=node;node.remove();});assert.equal(await first.count(),1);
  await page.evaluate(()=>document.querySelector('.dc-collection-grid').append(window.programTest.detached));
  await page.locator('.dc-collection-grid dc-program-card').last().frameLocator('iframe').locator('html[data-dc-side="front"]').waitFor();
  await page.evaluate(()=>{window.programTest.view.dispose();window.programTest.renderer.dispose();window.programTest.renderer.setEnabled(true);});assert.equal(await page.locator('#root iframe').count(),0);
  checks.push('Explicit disable/reenable and detached-node remount create fresh sessions; retained obsolete load callback cannot consume the new port; framework and renderer disposal are terminal');

  await page.evaluate(async programOrigin=>{
    const {createProgramCardRenderer}=window.programTest,client=(await import('/src/client.js')).createClient();await client.me();const copies=await client.inventory();
    window.programTest.probeRenderer=createProgramCardRenderer({registry:new Map([['example.dom-card',{approved:true,version:'1.0.0',url:programOrigin+'/',intents:['select']}]]),cards:{dawn:'example.dom-card',aurora:'example.dom-card'},maxActivePrograms:1,onDiagnostic:event=>window.programTest.diagnostics.push(event)});
    window.programTest.probes=copies.map(copy=>window.programTest.probeRenderer(copy,{onSelect(){}}));document.querySelector('#probes').append(...window.programTest.probes);
  },programOrigin);
  await page.locator('#probes iframe').waitFor();await page.locator('#probes dc-program-card:has(iframe)').frameLocator('iframe').locator('html[data-dc-side]').waitFor();
  assert.equal(await page.locator('#probes iframe').count(),1);
  await page.locator('#probes dc-program-card:has(iframe)').evaluate(node=>node.remove());await page.locator('#probes dc-program-card').frameLocator('iframe').locator('html[data-dc-side]').waitFor();
  const rejected=await page.evaluate(()=>{
    const channel=window.programTest.channels.filter(channel=>channel.port1.onmessage&&channel.received?.type==='ready').at(-1);
    channel.port1.onmessage({data:{version:1,type:'intent',intent:'select',nonce:'wrong-session'}});
    return window.programTest.diagnostics.at(-1).code;
  });assert.equal(rejected,'PROGRAM_MESSAGE');assert.equal(await page.locator('#probes iframe').count(),0);
  await page.evaluate(()=>{window.programTest.probeRenderer.setEnabled(false);window.programTest.probeRenderer.setEnabled(true);});
  await page.locator('#probes dc-program-card').frameLocator('iframe').locator('html[data-dc-side]').waitFor();
  const unauthorized=await page.evaluate(()=>{
    const channel=window.programTest.channels.filter(channel=>channel.port1.onmessage&&channel.received?.type==='ready').at(-1);
    channel.port1.onmessage({data:{version:1,type:'intent',intent:'purchase',nonce:channel.received.nonce}});
    return window.programTest.diagnostics.at(-1).code;
  });assert.equal(unauthorized,'PROGRAM_INTENT');assert.equal(await page.locator('#probes iframe').count(),0);
  await page.evaluate(()=>window.programTest.probeRenderer.dispose());assert.equal(await page.locator('#probes iframe').count(),0);
  await page.evaluate(async programOrigin=>{
    const {createProgramCardRenderer}=window.programTest,client=(await import('/src/client.js')).createClient();await client.me();const copy=(await client.inventory())[0];
    const registry=new Map([['example.silent',{approved:true,version:'1.0.0',url:programOrigin+'/silent'}],['example.denied',{approved:false,version:'1.0.0',url:programOrigin+'/'}]]);
    window.programTest.failureRenderer=createProgramCardRenderer({registry,cards:{[copy.cardId]:'example.silent'},handshakeTimeout:100,onDiagnostic:event=>window.programTest.diagnostics.push(event)});
    window.programTest.deniedRenderer=createProgramCardRenderer({registry,cards:{[copy.cardId]:'example.denied'},onDiagnostic:event=>window.programTest.diagnostics.push(event)});
    document.querySelector('#probes').replaceChildren(window.programTest.failureRenderer(copy,{}),window.programTest.deniedRenderer(copy,{}));
  },programOrigin);
  await page.waitForFunction(()=>window.programTest.diagnostics.some(event=>event.code==='PROGRAM_TIMEOUT')&&window.programTest.diagnostics.some(event=>event.code==='PROGRAM_UNAVAILABLE'));
  assert.equal(await page.locator('#probes iframe').count(),0);assert.equal(await page.locator('#probes .dc-card:not(dc-program-card)').count(),2);
  await page.evaluate(()=>{window.programTest.failureRenderer.dispose();window.programTest.deniedRenderer.dispose();});
  checks.push('Capacity stays bounded and waiting visible node starts after release; nonce/intent violations terminate only their session; silent/unapproved programs preserve native fallback without executable registration');
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'result.json'),JSON.stringify({engine,checks,errors},null,2));console.log(JSON.stringify({engine,checks,errors}));
}finally{await browser?.close();for(const server of [hostServer,programServer]){server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));}x.core.close();await rm(temp,{recursive:true,force:true});}
