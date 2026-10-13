import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import * as pw from 'playwright';
import {fixture,admin} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
import {authorizePresentation} from '../src/access.js';
import {createPresentationStore} from '../src/presentation/service.js';
import {createPresentationHandler} from '../src/presentation/node-http.js';
import {importPackage} from '../src/presentation/package.js';

// Real authoring, archive publication and catalog admission; the trusted identity
// resolver supplies the artist's explicit grants, then the collector's account.
const output=resolve(process.argv[2]??'test-results/portable-card-art'),engine=process.env.BROWSER_ENGINE??'chromium';
await mkdir(output,{recursive:true});
const temp=await mkdtemp(resolve(tmpdir(),'portable-card-art-')),x=fixture();
const artist={...x.alice,role:'artist',permissions:['catalog.read','catalog.preview','catalog.publish','card-policies.read','art.import','art.publish']};
let actor=artist,api,presentationHTTP,browser;
const checks=[],errors=[],requests=[];
const oldCopy=x.open()[0],oldInventory=structuredClone(x.core.inventory(x.alice));
const before=structuredClone(x.core.operatorCatalog(admin));
const server=createServer(async(request,response)=>{
  try{
    requests.push({method:request.method,path:new URL(request.url,'http://localhost').pathname});
    if(await api?.(request,response)||await presentationHTTP?.(request,response))return;
    if(request.url==='/artist-harness'){
      response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
      response.end('<!doctype html><html lang="en"><title>Portable card artist</title><style>body{font:16px system-ui;margin:24px}button,input{font:inherit}main{min-height:600px}</style><main id="root"></main></html>');return;
    }
    if(await serveReference(request,response))return;response.writeHead(404);response.end();
  }catch(error){response.writeHead(500);response.end(error.message);}
});
try{
  const packagePath=process.env.CARD_ART_PACKAGE?resolve(process.env.CARD_ART_PACKAGE):resolve(temp,'generated.dcard');
  if(!process.env.CARD_ART_PACKAGE){
    const stdout=execFileSync(process.env.PYTHON??'python',[fileURLToPath(new URL('../examples/plugins/python-card-art.py',import.meta.url)),packagePath],{windowsHide:true,timeout:10000,maxBuffer:16384});
    assert.equal(stdout.length,0,'Generator success must be silent');
  }
  const generated=await importPackage(new Uint8Array(await readFile(packagePath)));
  const front=generated.scenes.get(generated.manifest.faces.front.scene),emblem=front.nodes.find(node=>node.id==='front-emblem');
  assert.equal(emblem.x,0);assert.equal(emblem.material.kind,'foil');assert(emblem.bindings.rotation);assert(emblem.bindings['material.angle']);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  api=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,exposeOperators:true,requirePrincipal:true});
  const store=await createPresentationStore({root:resolve(temp,'store'),authorize:authorizePresentation,validatePublication:(principal,{archive})=>x.core.registerCardPresentation(principal,archive)});
  presentationHTTP=createPresentationHandler({store,resolveIdentity:()=>actor,allowedOrigin:origin});
  try{browser=await pw[engine].launch({headless:process.env.HEADED!=='1'});}catch(error){if(engine!=='chromium')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/artist-harness');
  await page.evaluate(async()=>{
    const [{createClient},{renderStudio}]=await Promise.all([import('/src/client.js'),import('/src/studio-ui.js')]);
    const client=createClient(),model={me:await client.me(),catalog:await client.operatorCatalog()};
    window.artistView=renderStudio(model,{client});document.querySelector('#root').append(window.artistView.node);
  });
  const idle=()=>page.waitForFunction(()=>document.querySelector('.dcard-studio')?.getAttribute('aria-busy')!=='true');
  await page.getByRole('button',{name:'Open visual card editor',exact:true}).click();
  await page.getByRole('button',{name:'Open card',exact:true}).waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Open visual card editor'&&!button.disabled));
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open card',exact:true}).click();await(await chooser).setFiles(packagePath);
  await page.getByRole('button',{name:'Front emblem',exact:true}).waitFor();await idle();
  assert.equal(await page.getByLabel('Card title',{exact:true}).inputValue(),generated.manifest.title);
  await page.getByRole('button',{name:'Front emblem',exact:true}).click();await idle();
  await page.getByLabel('x',{exact:true}).fill('42');await page.getByLabel('x',{exact:true}).press('Tab');await idle();
  await page.getByLabel('Card title',{exact:true}).fill('Celestial Study · published');await page.getByLabel('Card title',{exact:true}).press('Tab');await idle();
  await page.getByRole('button',{name:'Capture posters',exact:true}).click();await idle();
  await page.getByText('Both face posters captured from the renderer.',{exact:true}).waitFor();
  assert.deepEqual(x.core.operatorCatalog(admin),before,'Editing/capture must not publish the catalog');
  checks.push('Generated portable archive opens through file chooser, retains foil/motion, and allows native layer editing and two-face capture');

  await page.getByRole('button',{name:'Publish',exact:true}).click();
  const reviewed=page.getByRole('button',{name:'Publish reviewed card',exact:true});await reviewed.waitFor();
  assert.deepEqual(x.core.operatorCatalog(admin),before,'Catalog admission requires the explicit reviewed publication');
  assert.equal(requests.filter(request=>request.path==='/api/operator/import/commit').length,0);
  await reviewed.click();await idle();await page.getByText('Card published.',{exact:true}).waitFor();
  const published=x.core.operatorCatalog(admin),card=published.cards.find(card=>card.id==='dawn'),ref=card.presentation;
  assert.equal(card.name,'Celestial Study · published');assert.equal(published.version,before.version+1);assert(ref);
  assert.notEqual(ref.digest,generated.digest);assert.equal(ref.baseURL,origin+'/presentations/'+ref.digest+'/files/');
  assert.equal(requests.filter(request=>request.method==='POST'&&request.path==='/api/operator/import/commit').length,1);
  assert(requests.some(request=>request.method==='POST'&&/^\/presentations\/imports\/[^/]+\/publish$/.test(request.path)));
  const archiveResponse=await fetch(origin+'/presentations/'+ref.digest+'/download');assert.equal(archiveResponse.status,200);
  const saved=await importPackage(new Uint8Array(await archiveResponse.arrayBuffer()));assert.equal(saved.digest,ref.digest);
  const savedEmblem=saved.scenes.get(saved.manifest.faces.front.scene).nodes.find(node=>node.id==='front-emblem');
  assert.equal(savedEmblem.x,42);assert.deepEqual(savedEmblem.material,emblem.material);assert.deepEqual(savedEmblem.bindings,emblem.bindings);
  for(const side of ['front','back']){
    const originalPoster=generated.manifest.assets.find(asset=>asset.id===generated.manifest.faces[side].poster),capturedPoster=saved.manifest.assets.find(asset=>asset.id===saved.manifest.faces[side].poster);
    assert.notEqual(capturedPoster.sha256,originalPoster.sha256,'Published '+side+' poster must be the actual capture');
  }
  assert.deepEqual(x.core.inventory(x.alice).find(copy=>copy.id===oldCopy.id),oldInventory.find(copy=>copy.id===oldCopy.id));
  checks.push('Actual archive upload/publication and policy preview precede one explicit authorized catalog commit; published archive preserves edited layer and captured posters');

  const newCopy=x.open()[0],inventory=x.core.inventory(x.alice),newView=inventory.find(copy=>copy.id===newCopy.id);
  assert.deepEqual(newView.definition.presentation,ref);assert.equal(newView.definition.name,card.name);
  assert.deepEqual(inventory.find(copy=>copy.id===oldCopy.id).definition,oldInventory.find(copy=>copy.id===oldCopy.id).definition);
  actor=x.alice;
  await page.evaluate(async()=>{
    window.artistView.dispose();document.querySelector('#root').replaceChildren();
    const [{createClient},{mountFramework}]=await Promise.all([import('/src/client.js'),import('/src/ui.js')]);
    window.collectorView=mountFramework(document.querySelector('#root'),{client:createClient(),sections:['collection']});await window.collectorView.ready;
  });
  const portable=page.locator('.dc-collection-grid dc-portable-card');await portable.waitFor();
  await page.waitForFunction(()=>{const image=document.querySelector('.dc-collection-grid dc-portable-card img');return image?.complete&&image.naturalWidth>0;});
  assert.equal(await portable.getAttribute('aria-label'),card.name+', common');
  await portable.press('Enter');
  const inspector=page.locator('.dc-inspector-dialog'),stage=inspector.locator('.dc-3d-stage'),canvas=inspector.locator('canvas');
  await page.waitForFunction(()=>{const canvas=document.querySelector('.dc-inspector-dialog canvas');return canvas?.width>1&&canvas.height>1;});
  const nextFrame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await nextFrame();const neutral=await canvas.screenshot({path:resolve(output,'collector-front.png')});
  await stage.focus();await stage.press('ArrowRight');assert.equal(await stage.getAttribute('data-yaw'),'15');await nextFrame();
  const tilted=await canvas.screenshot({path:resolve(output,'collector-tilted.png')});assert(!neutral.equals(tilted),'Native keyboard rotation must alter the interactive artwork');
  await inspector.getByRole('button',{name:'Flip',exact:true}).click();assert.equal(await stage.getAttribute('data-yaw'),'195');await nextFrame();
  const back=await canvas.screenshot({path:resolve(output,'collector-back.png')});assert(!tilted.equals(back),'Reverse face must visibly differ');
  assert(requests.some(request=>request.path.startsWith('/presentations/'+ref.digest+'/files/')));
  assert.equal(await inspector.getByText('Preview unavailable',{exact:true}).count(),0);
  await inspector.getByRole('button',{name:'Close inspection',exact:true}).click();await page.evaluate(()=>window.collectorView.dispose());
  assert.equal(await page.locator('#root').evaluate(root=>root.childNodes.length),0);
  checks.push('New issued copy retains the published digest; existing copy stays unchanged; default collector poster and keyboard-driven foil/rotation/reverse-face inspection use the real hosted archive');
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'result.json'),JSON.stringify({engine,checks,errors},null,2));console.log(JSON.stringify({engine,checks,errors}));
}finally{
  await browser?.close();server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));x.core.close();await rm(temp,{recursive:true,force:true});
}
