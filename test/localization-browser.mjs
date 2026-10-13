import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import * as pw from 'playwright';
import {serveReference} from '../src/static.js';
import {fixture} from './helpers.js';
import {validateLocalizationBundle,createLocalization} from '../src/localization.js';

// This browser boundary uses the supported client interface with deterministic
// responses. Backend allocation, payment and transport have separate tests.
const bundle=validateLocalizationBundle(JSON.parse(execFileSync(process.env.PYTHON??'python',[fileURLToPath(new URL('../examples/plugins/python-localization.py',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:32768})));
const output=resolve(process.argv[2]??'test-results/localization'),engine=process.env.BROWSER_ENGINE??'chromium',errors=[];
const source=fixture();let catalog;
try{catalog=structuredClone(source.core.catalog());}finally{source.core.close();}
catalog.products=[catalog.products.find(product=>product.id==='common')];
const product=catalog.products[0];product.allocationStrategy={algorithm:'weighted-deck@3',version:3,deckScope:'purchase-slot'};
const currency=catalog.currencies.find(currency=>currency.id===product.price.currencyId).name,t=createLocalization({locale:bundle.locale,messages:bundle.messages}).text;
await mkdir(output,{recursive:true});
const server=createServer(async(request,response)=>{
  try{
    if(request.url==='/localization-harness'){
      response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
      response.end('<!doctype html><html lang="en"><title>Collector localization</title><style>body{font:16px system-ui}main{min-height:600px;margin:24px}button,input{font:inherit}</style><main id="spanish" lang="de" dir="rtl"></main><main id="english"></main><main id="literal"></main></html>');return;
    }
    if(await serveReference(request,response))return;response.writeHead(404);response.end();
  }catch{response.writeHead(500);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  try{browser=await pw[engine].launch({headless:process.env.HEADED!=='1'});}catch(error){if(engine!=='chromium')throw error;browser=await pw.chromium.launch({headless:process.env.HEADED!=='1',channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/localization-harness');
  const markup='<img src=x onerror="window.localizationExecuted=true"> < 3 > 1';
  await page.evaluate(async({catalog,bundle,markup})=>{
    const {mountFramework}=await import('/src/ui.js');
    function clientFixture(principal){
      const product=catalog.products[0],variant=catalog.variants.find(variant=>variant.id===product.slots[0].pool[0].variantId),definition=catalog.cards.find(card=>card.id===variant.cardId);
      const cards=[true,false].map((isNew,index)=>({id:principal+'-copy-'+index,definition,variant,rarityId:variant.rarityId,serialNumber:index+1,editionTotal:100,bindings:{},isNew}));
      const calls={quotes:[],purchases:[],opens:[]},packs=[],wallet={credits:10000,gems:10000};
      const client={principal:()=>principal,requestKey:()=>crypto.randomUUID(),catalog:async()=>structuredClone(catalog),me:async()=>({userId:principal,displayName:'Collector'}),wallet:async()=>structuredClone(wallet),inventory:async()=>cards,albums:async()=>[],trades:async()=>[],packs:async()=>structuredClone(packs),availability:async()=>({variants:[],products:[]}),pity:async()=>({}),
        quote:async input=>{calls.quotes.push(structuredClone(input));return {productId:product.id,quantity:input.quantity,productRevision:product.revision,catalogVersion:catalog.version,adminRevision:0,price:{currencyId:product.price.currencyId,amount:product.price.amount*input.quantity},allocationDigest:'a'.repeat(64)};},
        purchase:async input=>{calls.purchases.push(structuredClone(input));packs.push({id:principal+'-pack',product,createdAt:'2026-10-12T01:02:03Z',openedAt:null});wallet[input.price.currencyId]-=input.price.amount;return {packs:structuredClone(packs),paid:input.price};},
        openPack:async input=>{calls.opens.push(structuredClone(input));packs[0].openedAt='2026-10-12T02:00:00Z';return {id:input.packId,cards};}
      };return {client,calls,wallet};
    }
    window.localizationFixtures=['spanish','english','literal'].map(clientFixture);
    window.localizationMounts=window.localizationFixtures.map((fixture,index)=>mountFramework(document.querySelector('#'+['spanish','english','literal'][index]),{client:fixture.client,sections:['wallet','shop','packs'],navigation:'tabs',...(index===1?{}:{locale:bundle.locale,messages:index===2?{...bundle.messages,'shop.title':markup}:bundle.messages})}));
    await Promise.all(window.localizationMounts.map(mount=>mount.ready));
  },{catalog,bundle,markup});
  const spanish=page.locator('#spanish'),english=page.locator('#english'),literal=page.locator('#literal');
  assert.equal(await spanish.getAttribute('lang'),'es');assert.equal(await spanish.getAttribute('dir'),'ltr');assert.equal(await english.getAttribute('lang'),'en');assert.equal(await english.getAttribute('dir'),'ltr');
  assert.equal(await literal.locator('.dc-section h2').textContent(),markup);assert.equal(await literal.locator('.dc-section h2 img').count(),0);assert.equal(await page.evaluate(()=>window.localizationExecuted),undefined);
  assert.equal(await english.locator('nav button').count(),3,await english.textContent());
  assert.equal(await english.locator('[data-view="wallet"]').textContent(),'Wallet');
  await english.locator('[data-view="wallet"]').click();assert(await english.getByRole('heading',{name:'Your wallet',exact:true}).isVisible());
  assert.equal(await spanish.locator('[data-view="wallet"]').textContent(),t('nav.wallet'));
  await spanish.locator('[data-view="wallet"]').click();assert(await spanish.getByRole('heading',{name:t('wallet.title'),exact:true}).isVisible());
  assert((await spanish.textContent()).includes(new Intl.NumberFormat('es').format(10000)));
  assert.equal(await spanish.locator('[data-view="shop"]').textContent(),t('nav.shop'));await spanish.locator('[data-view="shop"]').click();
  await spanish.getByRole('button',{name:t('shop.reviewButton',{amount:product.price.amount,currency}),exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#spanish').getAttribute('aria-busy')!=='true');
  assert.equal(await spanish.locator('.dc-status').textContent(),t('shop.reviewReady'));
  assert.deepEqual(await page.evaluate(()=>window.localizationFixtures[0].calls.quotes),[{productId:'common',quantity:1}]);assert.equal(await page.evaluate(()=>window.localizationFixtures[0].calls.purchases.length),0);
  await spanish.getByRole('button',{name:t('shop.buyReviewed',{amount:product.price.amount,currency}),exact:true}).click();
  await spanish.getByRole('button',{name:t('packs.open'),exact:true}).waitFor();
  const submitted=await page.evaluate(()=>window.localizationFixtures[0].calls.purchases);assert.equal(submitted.length,1);assert.equal(submitted[0].allocationDigest,'a'.repeat(64));assert.equal(submitted[0].quantity,1);assert.deepEqual(submitted[0].price,product.price);assert.equal(typeof submitted[0].key,'string');
  await spanish.getByRole('button',{name:t('packs.open'),exact:true}).click();
  await spanish.getByRole('button',{name:t('opener.next'),exact:true}).waitFor();
  assert((await spanish.textContent()).includes(t('opener.progress',{revealed:0,total:2})));
  await spanish.getByRole('button',{name:t('opener.next'),exact:true}).click();assert(await spanish.getByText(t('opener.new'),{exact:true}).isVisible());
  await spanish.getByRole('button',{name:t('opener.all'),exact:true}).click();assert(await spanish.getByRole('heading',{name:t('opener.complete'),exact:true}).isVisible());assert(await spanish.getByText(t('opener.duplicate'),{exact:true}).isVisible());assert.equal(await spanish.locator('.dc-result-card').count(),2);
  await spanish.getByRole('button',{name:t('opener.replay'),exact:true}).click();assert.equal(await spanish.locator('.dc-result-card').count(),0);assert(await spanish.getByText(t('opener.card',{number:1}),{exact:true}).isVisible());
  assert.deepEqual(await page.evaluate(()=>window.localizationFixtures.map(({calls})=>({purchases:calls.purchases.length,opens:calls.opens.length}))),[{purchases:1,opens:1},{purchases:0,opens:0},{purchases:0,opens:0}]);
  await page.evaluate(()=>window.localizationMounts[0].dispose());assert.equal(await spanish.getAttribute('lang'),'de');assert.equal(await spanish.getAttribute('dir'),'rtl');assert.equal(await spanish.locator('*').count(),0);assert(await english.getByRole('heading',{name:'Your wallet',exact:true}).isVisible());
  await page.evaluate(()=>window.localizationMounts.slice(1).forEach(mount=>mount.dispose()));
  assert.equal(await english.getAttribute('lang'),null);assert.equal(await english.getAttribute('dir'),null);assert.equal(await literal.getAttribute('lang'),null);assert.equal(await literal.getAttribute('dir'),null);assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.deepEqual(errors,[]);
  await writeFile(join(output,'results.json'),JSON.stringify({engine,boundary:'Real browser UI and command persistence with deterministic supported client fixture',checks:['actual Python Spanish bundle','independent English mount','review before purchase and exact digest','packs opening reveal and replay','literal markup text','root language and direction cleanup'],pageErrors:errors},null,2));
  console.log('Collector localization browser workflow passed ('+engine+')');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
