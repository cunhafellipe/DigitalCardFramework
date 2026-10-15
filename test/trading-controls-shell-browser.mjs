import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import * as pw from 'playwright';
import {fixture,admin} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
import {validateApplicationShell} from '../src/application-shell.js';

const engine=process.env.BROWSER_ENGINE??'webkit',output=resolve(process.argv[2]??'test-results/trading-controls-shell');
const manifests=new Map(),cases=[],errors=[];
let x,actor,api,origin,browser,holdPolicy=false,releasePolicy,capturedPolicy;
const server=createServer(async(request,response)=>{
  try{
    if(holdPolicy&&request.url==='/api/operator/trading'){
      holdPolicy=false;const end=response.end.bind(response);
      response.end=(...args)=>{releasePolicy=()=>end(...args);capturedPolicy?.();return response;};
    }
    if(await api?.(request,response))return;
    const path=new URL(request.url,'http://localhost').pathname;
    if(manifests.has(path)){response.setHeader('content-type','application/json');response.end(JSON.stringify(manifests.get(path)));return;}
    if(path==='/trading-controls-shell'){response.setHeader('content-type','text/html');response.end('<!doctype html><html><head><title>Trading controls</title></head><body><main id="root"></main></body></html>');return;}
    if(await serveReference(request,response,{production:true}))return;response.writeHead(404).end();
  }catch{response.writeHead(500).end();}
});
try{
  for(const language of ['python','go'])for(const topology of ['rail','header']){
    const source=fileURLToPath(new URL('../examples/application-shell/generate.'+(language==='python'?'py':'go'),import.meta.url));
    const bytes=execFileSync(language==='python'?process.env.PYTHON??'python':process.env.GO??'go',language==='python'?[source,topology]:['run',source,topology],{windowsHide:true,timeout:60000,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off'}});
    manifests.set('/shell/'+language+'-'+topology+'.json',validateApplicationShell(JSON.parse(bytes)));
  }
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await pw[engine].launch({headless:true});
  for(const manifestPath of manifests.keys()){
    x=fixture();const copy=x.open('common')[0],policyCalls=[],lockCalls=[];
    const configure=x.core.configureTrading.bind(x.core),lock=x.core.setCardTransferLock.bind(x.core);
    x.core.configureTrading=(principal,input)=>{policyCalls.push({principal:structuredClone(principal),input:structuredClone(input)});return configure(principal,input);};
    x.core.setCardTransferLock=(principal,input)=>{lockCalls.push({principal:structuredClone(principal),input:structuredClone(input)});return lock(principal,input);};
    actor=x.alice;api=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,requirePrincipal:true,exposeOperators:true});
    const page=await browser.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/trading-controls-shell');
    await page.evaluate(async manifestPath=>{
      const [{mountFramework},{createClient},{loadApplicationShell}]=await Promise.all([import('/src/ui.js'),import('/src/client.js'),import('/src/application-shell.js')]);
      const test=window.tradingControlShell={client:createClient(),manifestPath};
      const configure=test.client.configureTrading.bind(test.client);test.client.configureTrading=input=>(test.lastPolicy=configure(input));
      test.mount=async()=>{
        test.app?.dispose();const me=await test.client.me();
        const sections=me.permissions?.includes('trading.manage')?['tradingControls','wallet']:['wallet'];
        test.app=mountFramework(document.querySelector('#root'),{client:test.client,sections,navigation:'tabs',shell:loadApplicationShell(manifestPath)});
        await test.app.ready;await test.app.shellReady;
      };
      await test.mount();
    },manifestPath);
    assert.equal(await page.locator('[data-view="tradingControls"]').count(),0);
    const post=async(path,input)=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-DC-Principal':x.alice.userId},body:JSON.stringify(input)});
    const initial=x.core.tradingPolicy();
    for(const [path,input]of [['/api/operator/trading',{key:'player-policy',expectedRevision:initial.revision,policy:initial.policy,role:'admin'}],['/api/operator/card-lock',{key:'player-lock',copyId:copy.id,locked:true,reason:'Denied',role:'admin'}]]){
      const denied=await post(path,input);assert.equal(denied.status,403);assert.equal((await denied.json()).code,'FORBIDDEN');
    }
    assert.deepEqual(x.core.tradingPolicy(),initial);assert.equal(x.core.inventory(x.alice).find(item=>item.id===copy.id).transferLock,undefined);assert.equal(policyCalls.length,0);assert.equal(lockCalls.length,0);
    actor={...x.alice,permissions:['trading.manage']};
    const unrelated=await fetch(origin+'/api/operator/admin');assert.equal(unrelated.status,403);
    await page.evaluate(()=>tradingControlShell.mount());
    const controls=page.locator('#root .dc-content > section'),json=controls.getByLabel('Trading policy JSON',{exact:true});
    await json.waitFor();assert.deepEqual(JSON.parse(await json.inputValue()),initial.policy);assert.equal(await page.locator('[data-view="tradingControls"]').count(),1);
    const changed={...initial.policy,cooldownSeconds:7};configure(admin,{key:'concurrent-policy',expectedRevision:initial.revision,policy:changed});
    const conflictResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operator/trading');
    await controls.getByRole('button',{name:'Apply trading policy',exact:true}).click();assert.equal((await conflictResponse).status(),409);
    await controls.getByRole('status').getByText('The details have changed. Reload and review them again.',{exact:true}).waitFor();
    assert.equal(policyCalls.at(-1).input.expectedRevision,initial.revision);assert.deepEqual(x.core.tradingPolicy().policy,changed);
    await page.evaluate(()=>tradingControlShell.app.refresh());await json.waitFor();assert.deepEqual(JSON.parse(await json.inputValue()),changed);
    const reviewed={...changed,cooldownSeconds:11};await json.fill(JSON.stringify(reviewed));await controls.getByRole('button',{name:'Apply trading policy',exact:true}).click();
    await controls.getByRole('status').getByText('Trading policy saved.',{exact:true}).waitFor();assert.equal(policyCalls.at(-1).input.expectedRevision,initial.revision+1);assert.deepEqual(x.core.tradingPolicy(),{revision:initial.revision+2,policy:reviewed});
    const reason='Authored <reason> 0007',until='2026-12-01T02:03:04.000Z';
    await controls.getByLabel('Individual copy ID',{exact:true}).fill(copy.id);await controls.getByLabel('Lock reason',{exact:true}).fill(reason);await controls.getByLabel('Lock expiry (ISO, optional)',{exact:true}).fill(until);
    await controls.getByRole('button',{name:'Lock this card',exact:true}).click();await controls.getByRole('status').getByText('Card locked.',{exact:true}).waitFor();
    const locked=lockCalls.at(-1);assert.deepEqual(locked.principal,actor);assert.deepEqual({...locked.input,key:'key'},{key:'key',copyId:copy.id,locked:true,reason,until});assert.equal(typeof locked.input.key,'string');
    const lockedCopy=x.core.inventory(x.alice).find(item=>item.id===copy.id);assert.equal(lockedCopy.tradable,false);assert.equal(lockedCopy.untradableReason,reason);
    await controls.getByRole('button',{name:'Remove lock',exact:true}).click();await controls.getByRole('status').getByText('Card lock removed.',{exact:true}).waitFor();
    const unlocked=lockCalls.at(-1);assert.deepEqual({...unlocked.input,key:'key'},{key:'key',copyId:copy.id,locked:false,reason,until});assert.notEqual(unlocked.input.key,locked.input.key);assert.equal(x.core.inventory(x.alice).find(item=>item.id===copy.id).tradable,true);
    const finalPolicy={...reviewed,cooldownSeconds:13};await json.fill(JSON.stringify(finalPolicy));
    let timer;const captured=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Committed policy response was not captured')),15000);capturedPolicy=resolve;});holdPolicy=true;
    await controls.getByRole('button',{name:'Apply trading policy',exact:true}).click();try{await captured;}finally{clearTimeout(timer);capturedPolicy=undefined;}
    assert.deepEqual(x.core.tradingPolicy(),{revision:initial.revision+3,policy:finalPolicy});
    await page.evaluate(()=>{tradingControlShell.disposedNode=document.querySelector('#root .dc-content > section');tradingControlShell.app.dispose();});assert.equal(await controls.count(),0);
    releasePolicy();releasePolicy=undefined;const committed=await page.evaluate(()=>tradingControlShell.lastPolicy);assert.equal(committed.revision,initial.revision+3);assert(await page.evaluate(()=>tradingControlShell.disposedNode.childElementCount===0));
    await page.evaluate(()=>tradingControlShell.mount());await json.waitFor();assert.deepEqual(JSON.parse(await json.inputValue()),finalPolicy);assert.equal(policyCalls.length,3);assert.equal(lockCalls.length,2);
    cases.push({manifest:manifestPath,playerDenials:2,scopedOperator:true,unrelatedAdminDenied:true,revisionConflictReload:true,exactLockUnlock:true,committedAfterDisposal:true});
    await page.evaluate(()=>tradingControlShell.app.dispose());await page.close();x.core.close();x=undefined;
  }
  assert.deepEqual(errors,[]);await mkdir(output,{recursive:true});await writeFile(resolve(output,'report.json'),JSON.stringify({engine,cases,errors},null,2)+'\n');console.log(JSON.stringify({engine,cases,errors},null,2));
}finally{releasePolicy?.();await browser?.close();x?.core.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
