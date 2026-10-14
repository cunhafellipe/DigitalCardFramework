import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import * as playwright from 'playwright';
import {fixture} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
import {localizationSchema,validateLocalizationBundle,createLocalization} from '../src/localization.js';

const output=resolve(process.argv[2]??'test-results/admin');
const engine=process.env.BROWSER_ENGINE??'chromium';
const bundle=validateLocalizationBundle(JSON.parse(execFileSync(process.env.PYTHON??'python',[fileURLToPath(new URL('../examples/plugins/python-localization.py',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:localizationSchema.maximumBytes+1})));
const localization=createLocalization({locale:bundle.locale,messages:bundle.messages}),t=(key,values)=>localization.text(key,values);
const x=fixture();
let api;
const server=createServer(async(req,res)=>{
  try {
    if(await api?.(req,res))return;
    if(new URL(req.url,'http://localhost').pathname==='/host/config'){
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({brand:'Digital Card Framework',mode:'production',loginUrl:'/auth/login'}));return;
    }
    if(new URL(req.url,'http://localhost').pathname==='/harness'){
      const localized=new URL(req.url,'http://localhost').searchParams.get('locale')==='es';
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Administration</title><style>body{margin:0;background:#101725;color:#edf1f7;font:16px system-ui}#root{max-width:1240px;margin:auto;padding:20px}*{box-sizing:border-box}</style></head><body><main id="root"></main><script type="module">
import {createClient} from '/src/client.js';
import {mountAdminPanel} from '/src/admin-ui.js';
const baseClient=createClient();window.inputs=[];window.executions=[];window.loseNext=false;
const client={...baseClient,executeCommandIntent:async input=>{window.executions.push(structuredClone(input));const result=await baseClient.executeCommandIntent(input);window.inputs.push(structuredClone(result.intent.input));if(window.loseNext){window.loseNext=false;throw new Error('<provider response lost>');}return result;}};const me=await client.me();
const bundle=${localized?JSON.stringify(bundle).replaceAll('<','\\u003c'):'null'};
window.panel=mountAdminPanel(document.querySelector('#root'),{client,namespace:me.userId,...(bundle?{locale:bundle.locale,messages:bundle.messages}:{})});
if(bundle){const other=document.createElement('aside');other.id='english';document.body.append(other);window.englishPanel=mountAdminPanel(other,{client,namespace:me.userId});await window.englishPanel.ready;}
await window.panel.ready;window.ready=true;
</script></body></html>`);
      return;
    }
    if(await serveReference(req,res))return;
    res.writeHead(404).end();
  } catch(error){res.writeHead(500).end(error.message);}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
api=createApiHandler({framework:x.core,resolveIdentity:()=>({...x.alice,role:'admin'}),allowedOrigin:origin,exposeOperators:true,requirePrincipal:true});
let browser;
const errors=[],checks=[];
try {
  await mkdir(output,{recursive:true});
  try {browser=await playwright[engine].launch({headless:true});}
  catch(error){if(engine!=='chromium'||process.platform!=='win32')throw error;browser=await playwright.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/harness');
  await page.waitForFunction(()=>window.ready);
  await page.screenshot({path:resolve(output,engine+'-overview.png'),fullPage:true});
  const labels=await page.locator('button').allTextContents();
  await writeFile(resolve(output,engine+'-controls.json'),JSON.stringify(labels,null,2));
  checks.push('Panel loads through authenticated public client and reference static serving');
  const save=async()=>{await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.locator('.da-review').waitFor({state:'hidden'});};
  await page.locator('[data-admin-tab=lines]').click();
  await page.getByRole('button',{name:'Manage Sky Atlas',exact:true}).click();
  await page.getByRole('button',{name:'Edit common',exact:true}).click();
  await page.getByLabel('Regular price',{exact:true}).fill('20');
  await page.getByLabel('Discount (%)',{exact:true}).fill('25');
  await page.getByRole('button',{name:'Review changes',exact:true}).click();
  assert.match(await page.locator('.da-review').innerText(),/25/);
  await save();assert.equal(x.core.quote(x.bob,{productId:'common',quantity:1}).price.amount,15);
  await page.getByRole('button',{name:'Advanced',exact:true}).click();
  await page.screenshot({path:resolve(output,engine+'-pack-settings.png'),fullPage:true});
  checks.push('Reviewed pack price and discount apply through the server; advanced controls render');
  await page.locator('[data-admin-tab=people]').click();
  await page.getByRole('button',{name:'Manage Bob',exact:true}).click();
  await page.getByLabel('Allow selling',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Review changes',exact:true}).click();await save();
  assert.equal(x.core.adminUser({...x.alice,role:'admin'},{userId:x.bob.userId}).user.restrictions.sellingBlocked,true);
  await page.getByRole('button',{name:'Give cards',exact:true}).click();
  await page.getByLabel('Card to give',{exact:true}).selectOption('dawn.standard');
  await page.getByLabel('Reason for this inventory change',{exact:true}).fill('Community welcome');
  await page.getByRole('button',{name:'Review changes',exact:true}).click();await save();
  await page.getByRole('button',{name:'Back to person',exact:true}).click();
  await page.getByRole('button',{name:'Remove cards',exact:true}).click();
  await page.locator('.da-checkbox-row input:not(:disabled)').first().check();
  await page.getByLabel('Reason for this inventory change',{exact:true}).fill('Correct duplicate welcome gift');
  await page.getByRole('button',{name:'Review changes',exact:true}).click();
  await page.screenshot({path:resolve(output,engine+'-inventory-review.png'),fullPage:true});
  await save();
  assert.equal(x.core.adminUser({...x.alice,role:'admin'},{userId:x.bob.userId}).inventory.items.length,0);
  checks.push('Account selling restriction, card grant and exact-copy removal complete through reviewed forms');
  await page.locator('[data-admin-tab=website]').click();
  await page.getByLabel('Pack purchases',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Review changes',exact:true}).click();await save();
  assert.equal(x.core.adminOverview({...x.alice,role:'admin'}).site.packPurchasesPaused,true);
  await page.locator('[data-admin-tab=activity]').click();
  await page.getByText('Community welcome',{exact:true}).waitFor();
  checks.push('Website pause persists and named administration history loads');
  await page.locator('[data-admin-tab=overview]').click();
  await page.getByRole('button',{name:'Basic',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile horizontal overflow');
  await page.screenshot({path:resolve(output,engine+'-mobile.png'),fullPage:true});
  checks.push('390 px mobile layout has no horizontal overflow');
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.panel.dispose());
  assert.equal((await page.locator('#root').innerText()).trim(),'');
  checks.push('Disposal removes the panel');
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(origin+'/');
  await page.locator('[data-view=admin]').click();
  await page.getByRole('heading',{name:'A clear view of your community',exact:true}).waitFor();
  await page.screenshot({path:resolve(output,engine+'-default-website.png'),fullPage:true});
  await page.locator('[data-admin-tab=website]').click();
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Default website mobile horizontal overflow');
  await page.screenshot({path:resolve(output,engine+'-default-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  checks.push('Default website mounts the panel with inherited styling on desktop and mobile');
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/harness?locale=es');await page.waitForFunction(()=>window.ready);
  const panel=page.locator('#root');assert.equal(await panel.locator('.dc-admin').getAttribute('lang'),'es');assert.equal(await page.locator('#english .dc-admin').getAttribute('lang'),'en');
  await panel.getByRole('button',{name:t('admin.advanced'),exact:true}).click();
  await panel.locator('[data-admin-tab=lines]').click();await panel.getByRole('button',{name:t('admin.manage',{name:'Sky Atlas'}),exact:true}).click();await panel.getByRole('button',{name:t('admin.edit',{name:'common'}),exact:true}).click();
  await panel.getByLabel(t('admin.regularPrice'),{exact:true}).fill('2000');assert.match(await panel.locator('.da-preview-price strong').innerText(),new RegExp(localization.number(1500)));
  await panel.locator('[data-admin-tab=people]').click();await panel.getByRole('button',{name:t('admin.discardDraftAndContinue'),exact:true}).click();
  await panel.getByRole('button',{name:t('admin.manage',{name:'Bob'}),exact:true}).click();await panel.getByRole('button',{name:t('admin.giveCards'),exact:true}).waitFor();
  assert.equal(await panel.getByLabel(t('admin.allowSelling'),{exact:true}).isChecked(),false);assert.equal(await page.locator('#english .da-brand strong').innerText(),'Admin control panel');
  await panel.locator('[data-admin-tab=website]').click();const before=x.core.adminOverview({...x.alice,role:'admin'}).revision,reason='0007 <audit> é ₹';
  await panel.getByLabel(t('admin.trading'),{exact:true}).uncheck();await panel.getByLabel(t('admin.reasonOptional'),{exact:true}).fill(reason);
  await panel.getByRole('button',{name:t('admin.reviewChanges'),exact:true}).click();assert.equal(x.core.adminOverview({...x.alice,role:'admin'}).revision,before);assert.equal(await panel.locator('.da-review audit').count(),0);assert((await panel.locator('.da-review').innerText()).includes(reason));
  await page.evaluate(()=>window.loseNext=true);await panel.getByRole('button',{name:t('admin.saveChanges'),exact:true}).click();await panel.getByRole('button',{name:t('admin.retrySameChange'),exact:true}).waitFor();
  assert.equal(x.core.adminOverview({...x.alice,role:'admin'}).revision,before+1);assert((await panel.innerText()).includes('<provider response lost>'));assert.equal(await panel.locator('provider').count(),0);await panel.getByRole('button',{name:t('admin.retrySameChange'),exact:true}).click();await panel.locator('.da-review').waitFor({state:'hidden'});
  const {inputs,executions}=await page.evaluate(()=>({inputs:window.inputs,executions:window.executions}));assert.equal(inputs.length,2);assert.deepEqual(inputs[0],inputs[1]);assert.deepEqual(executions[0],executions[1]);assert.deepEqual(inputs[0].changes,{tradingPaused:true});assert.equal(inputs[0].reason,reason);assert.equal(inputs[0].expectedRevision,before);assert.equal(x.core.adminOverview({...x.alice,role:'admin'}).revision,before+1);
  await panel.locator('[data-admin-tab=activity]').click();await panel.getByText(reason,{exact:true}).waitFor();const last=x.core.adminHistory({...x.alice,role:'admin'},{limit:1}).items[0];assert((await panel.innerText()).includes(localization.date(last.at)));assert((await panel.innerText()).includes('Alice'));
  await page.evaluate(()=>{window.panel.dispose();window.englishPanel.dispose();});assert.equal((await panel.innerText()).trim(),'');assert.equal((await page.locator('#english').innerText()).trim(),'');assert.deepEqual(errors,[]);
  checks.push('Python-authored Spanish administration covers advanced pricing, explicit draft discard, account controls, exact reviewed save/retry identity, authored reasons/errors, UTC history and independent English instance');
  await writeFile(resolve(output,engine+'-results.json'),JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({engine,checks,errors}));
} finally {
  await browser?.close();x.core.close();
  await new Promise(done=>{server.close(done);server.closeAllConnections();});
}
