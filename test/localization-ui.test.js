import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {fixture} from './helpers.js';
import {mountFramework,mountOpener,renderPack} from '../src/ui.js';
import {createRevealController,ApiError} from '../src/client.js';
import {createLocalization,englishMessages} from '../src/localization.js';

const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const find=(root,label)=>[...root.querySelectorAll('button')].find(button=>button.textContent.startsWith(label));
const click=(root,label)=>{const button=find(root,label);assert(button,'Missing '+label);assert(!button.hidden&&!button.disabled,'Unavailable '+label);button.click();return button;};
const markedMessages=()=>Object.fromEntries(Object.entries(englishMessages).map(([key,message])=>[key,typeof message==='string'?'‹'+message+'›':Object.fromEntries(Object.entries(message).map(([category,text])=>[category,'‹'+text+'›']))]));
function setup({deck=true,locale='fr',messages=markedMessages()}={}){
  const window=new Window({url:'http://localhost/'});globalThis.document=window.document;globalThis.sessionStorage=window.sessionStorage;
  const x=fixture(),catalog=structuredClone(x.core.catalog()),product=catalog.products.find(product=>product.id==='common');catalog.products=[product];
  if(deck)product.allocationStrategy={algorithm:'weighted-deck@3',version:3,deckScope:'purchase-slot'};
  product.artwork={front:'/front.png',back:'/back.png'};product.duplicatePolicy={scope:'inventory',fallback:'allow'};product.pity={rarityId:'rare',after:5};
  const variant=catalog.variants.find(variant=>variant.id===product.slots[0].pool[0].variantId),definition=catalog.cards.find(card=>card.id===variant.cardId),
    cards=[true,false].map((isNew,index)=>({id:'copy-'+index,definition,variant,rarityId:variant.rarityId,serialNumber:index+1,editionTotal:100,bindings:{},isNew}));
  const calls={quotes:[],purchases:[],opens:[],conversions:[],statuses:[],acknowledgements:[]},packs=[],wallet={credits:1000000,gems:1000000};let principal='collector',keys=0,state='idle',digest='a'.repeat(64);const mounts=[];
  const client={principal:()=>principal,requestKey:()=> 'request-'+(++keys),catalog:async()=>catalog,me:async()=>({userId:principal,displayName:'Collector'}),wallet:async()=>wallet,inventory:async()=>cards,albums:async()=>[],trades:async()=>[],packs:async()=>packs,availability:async()=>({variants:[],products:[]}),pity:async()=>({[product.id]:1}),
    quote:async input=>{calls.quotes.push(input);return {productId:product.id,quantity:input.quantity,productRevision:product.revision,catalogVersion:catalog.version,adminRevision:0,price:{currencyId:product.price.currencyId,amount:product.price.amount*input.quantity},...(deck?{allocationDigest:digest}:{})};},
    purchase:async input=>{calls.purchases.push(structuredClone(input));for(let i=0;i<input.quantity;i++)packs.push({id:'pack-'+packs.length,product,createdAt:'2026-10-12T01:02:03Z',openedAt:null});wallet[input.price.currencyId]-=input.price.amount;return {packs:structuredClone(packs),paid:input.price};},
    openPack:async input=>{calls.opens.push(input);const pack=packs.find(pack=>pack.id===input.packId);pack.openedAt??='2026-10-12T02:00:00Z';return {id:input.packId,cards};},
    convert:async input=>{calls.conversions.push(input);return {amount:input.amount,from:input.from,to:input.to,received:10};},
    allocationStatus:async input=>{calls.statuses.push(input);return {productId:product.id,attemptId:['idle','acknowledged'].includes(state)?null:'attempt',state,errorCode:state==='stale'?'ALLOCATION_STALE':null};},
    acknowledgeAllocation:async input=>{calls.acknowledgements.push(input);state='acknowledged';return {attemptId:input.attemptId,state};}
  };
  const root=document.createElement('main');document.body.append(root);
  return {window,root,client,calls,product,catalog,packs,cards,locale,messages,localization:createLocalization({locale,messages}),
    async mount(options={}){const mounted=mountFramework(root,{client,locale,messages,sections:['wallet','shop','packs'],navigation:'tabs',...options});mounts.push(mounted);await mounted.ready;return mounted;},
    setPrincipal(value){principal=value;},setState(value){state=value;},setDigest(value){digest=value;},
    close(){mounts.forEach(mount=>mount.dispose());x.core.close();window.happyDOM.abort();delete globalThis.document;delete globalThis.sessionStorage;}};
}

test('localized default collector completes wallet conversion, reviewed purchase, opening and replay',async()=>{
  const x=setup();try{
    const t=x.localization.text,mounted=await x.mount();assert.equal(x.root.lang,'fr');assert.equal(x.root.querySelector('nav').getAttribute('aria-label'),t('nav.features'));
    click(x.root,t('nav.wallet'));assert(x.root.textContent.includes(t('wallet.title')));assert(x.root.textContent.includes(x.localization.number(1000000)));
    click(x.root,t('wallet.convert'));await settle();assert.equal(x.calls.conversions.length,1);assert.equal(x.calls.conversions[0].amount,100);assert(x.root.querySelector('.dc-status').textContent.startsWith('‹Converted'));
    click(x.root,t('nav.shop'));assert(x.root.textContent.includes(t('shop.conditionalTickets')));assert(x.root.textContent.includes(t('shop.codeSupply')));assert(x.root.textContent.includes(t('shop.inserts')));
    const reviewLabel=t('shop.reviewButton',{amount:x.product.price.amount,currency:x.catalog.currencies.find(currency=>currency.id===x.product.price.currencyId).name});
    click(x.root,reviewLabel);await settle();assert.equal(x.calls.quotes.length,1);assert.equal(x.calls.purchases.length,0);assert.equal(x.root.querySelector('.dc-status').textContent,t('shop.reviewReady'));
    click(x.root,t('shop.buyReviewed',{amount:x.product.price.amount,currency:x.catalog.currencies.find(currency=>currency.id===x.product.price.currencyId).name}));await settle();
    assert.equal(x.calls.purchases.length,1);assert.equal(x.calls.purchases[0].allocationDigest,'a'.repeat(64));assert.equal(x.calls.purchases[0].key,'request-2');assert(x.root.textContent.includes(t('packs.title')));
    assert(x.root.textContent.includes(x.localization.date(x.packs[0].createdAt)));click(x.root,t('packs.open'));await settle();assert.equal(x.calls.opens.length,1);assert.equal(x.calls.opens[0].packId,'pack-0');
    assert(x.root.textContent.includes(t('opener.progress',{revealed:0,total:2})));click(x.root,t('opener.next'));assert(x.root.textContent.includes(t('opener.new')));click(x.root,t('opener.all'));assert(x.root.textContent.includes(t('opener.duplicate')));assert(x.root.textContent.includes(t('opener.complete')));
    assert.equal(x.root.querySelector('.dc-result-card button').getAttribute('aria-label'),t('card.serialLabel',{name:x.cards[0].definition.name,rarity:x.cards[0].rarityId,serial:1,total:100}));
    click(x.root,t('opener.replay'));assert(x.root.textContent.includes(t('opener.card',{number:1})));assert.equal(x.calls.opens.length,1);assert.equal(x.calls.purchases.length,1);
    await mounted.refresh();click(x.root,t('packs.replay'));await settle();assert.equal(x.calls.opens.length,2);assert.equal(x.calls.purchases.length,1);assert.equal(x.root.querySelector('.dc-status').textContent,t('packs.replaying'));
  }finally{x.close();}
});

test('translated labels preserve ordinary direct purchase and authored catalog content',async()=>{
  const x=setup({deck:false,messages:{'shop.buy':'Acheter · {amount} {currency}','packs.title':'Vos paquets'}});try{await x.mount();assert(x.root.textContent.includes(x.product.name.replace(/^.*? · /,'')));assert(!find(x.root,'Review purchase'));click(x.root,'Acheter ·');await settle();assert.equal(x.calls.quotes.length,1);assert.equal(x.calls.purchases.length,1);assert(!Object.hasOwn(x.calls.purchases[0],'allocationDigest'));assert(x.root.textContent.includes('Vos paquets'));assert(x.root.textContent.includes('Reveal your cards'));}finally{x.close();}
});

test('localized stale recovery requires inspection and acknowledgement followed by fresh review',async()=>{
  const x=setup();try{const original=x.client.purchase;let fail=true;x.client.purchase=async input=>{if(fail){x.calls.purchases.push(structuredClone(input));x.setState('stale');throw new ApiError('ALLOCATION_STALE','Server-authored failure',409);}return original(input);};await x.mount();click(x.root,'‹Review purchase');await settle();click(x.root,'‹Buy reviewed packs');await settle();assert(x.root.textContent.includes(x.localization.text('allocation.needsReview')));assert(x.root.textContent.includes('Server-authored failure'));
    click(x.root,x.localization.text('allocation.check'));await settle();assert.equal(x.calls.purchases.length,1);assert(find(x.root,'‹Review purchase').disabled);assert(x.root.textContent.includes(x.localization.text('allocation.stale')));
    click(x.root,x.localization.text('allocation.acknowledge'));await settle();assert.equal(x.calls.purchases.length,1);assert.equal(x.calls.quotes.length,1);assert.deepEqual(x.calls.acknowledgements,[{attemptId:'attempt'}]);fail=false;x.setDigest('b'.repeat(64));click(x.root,'‹Review purchase');await settle();assert.equal(x.calls.purchases.length,1);click(x.root,'‹Buy reviewed packs');await settle();assert.equal(x.calls.purchases[1].allocationDigest,'b'.repeat(64));assert.notEqual(x.calls.purchases[1].key,x.calls.purchases[0].key);
  }finally{x.close();}
});

test('localized ambiguous recovery resends only the original reviewed input and key',async()=>{
  const x=setup();try{x.client.purchase=async input=>{x.calls.purchases.push(structuredClone(input));throw new Error('<img src=x onerror=alert(1)>');};await x.mount();click(x.root,'‹Review purchase');await settle();click(x.root,'‹Buy reviewed packs');await settle();const original=x.calls.purchases[0];assert.equal(x.root.querySelector('.dc-status').textContent,'<img src=x onerror=alert(1)>');assert.equal(x.root.querySelector('.dc-status img'),null);
    x.setState('prepared');click(x.root,x.localization.text('allocation.check'));await settle();click(x.root,x.localization.text('allocation.acknowledge'));await settle();assert.equal(x.calls.purchases.length,1);assert(x.root.textContent.includes(x.localization.text('allocation.retryOriginal')));assert(!find(x.root,'‹Review purchase'));click(x.root,'‹Retry original purchase');await settle();assert.deepEqual(x.calls.purchases[1],original);assert.equal(x.calls.quotes.length,1);
  }finally{x.close();}
});

for(const command of ['purchase','openPack','convert'])test('localized server-intent recovery preserves original '+command+' input',async()=>{
  const x=setup();try{
    const input=command==='purchase'?{productId:x.product.id,quantity:2,price:x.product.price,allocationDigest:'a'.repeat(64),key:'original-key'}:command==='openPack'?{packId:'original-pack',key:'original-key'}:{from:'credits',to:'gems',amount:100,key:'original-key'},intent={id:'intent',userId:'collector',command,input,state:'pending'};let registered,executed=0;
    x.client.commandIntents=async()=>({items:[structuredClone(intent)]});x.client.registerCommandIntent=async request=>{registered=structuredClone(request);return structuredClone(intent);};x.client.executeCommandIntent=async()=>{executed++;throw new Error('Original response still uncertain');};x.client.acknowledgeCommandIntent=async()=>{throw new Error('Must not acknowledge uncertain intent');};
    await x.mount();const label=x.localization.text('recovery.action',{change:x.localization.text('recovery.'+command)});click(x.root,label);await settle();assert.deepEqual(registered,{command,input});assert.equal(executed,1);assert.equal(x.calls.quotes.length,0);assert.equal(x.calls.purchases.length,0);assert.equal(x.calls.opens.length,0);assert.equal(x.calls.conversions.length,0);
    const journal=JSON.parse(sessionStorage.getItem('digital-card.commands.v1:collector'));assert.deepEqual(Object.values(journal),[input]);
    assert.equal(x.root.querySelector('.dc-status').textContent,'Original response still uncertain');
  }finally{x.close();}
});

test('localized quantity edits discard prior quote and activation disclosure',async()=>{
  const x=setup();try{const quote=x.client.quote;x.client.quote=async input=>({...await quote(input),bindingActivation:{maximum:2}});await x.mount();click(x.root,'‹Review purchase');await settle();assert(x.root.textContent.includes(x.localization.text('shop.activation',{count:2})));const input=x.root.querySelector('.dc-purchase-row input');input.value='2';input.dispatchEvent(new x.window.Event('input'));assert(!find(x.root,'‹Buy reviewed packs'));assert(!x.root.textContent.includes(x.localization.text('shop.activation',{count:2})));x.setDigest('b'.repeat(64));click(x.root,'‹Review purchase');await settle();assert.equal(x.calls.purchases.length,0);click(x.root,'‹Buy reviewed packs');await settle();assert.equal(x.calls.purchases[0].quantity,2);assert.equal(x.calls.purchases[0].allocationDigest,'b'.repeat(64));}finally{x.close();}
});

for(const change of ['quantity','account','dispose'])test('localized late quote remains fenced after '+change,async()=>{
  const x=setup();try{let finish;x.client.quote=()=>new Promise(resolve=>finish=resolve);const mounted=await x.mount();click(x.root,'‹Review purchase');if(change==='dispose')mounted.dispose();else if(change==='account')x.setPrincipal('other');else{const input=x.root.querySelector('.dc-purchase-row input');input.value='2';input.dispatchEvent(new x.window.Event('input'));}finish({productId:x.product.id,quantity:1,price:x.product.price,allocationDigest:'a'.repeat(64)});await settle();assert.equal(x.calls.purchases.length,0);assert(!find(x.root,'‹Buy reviewed packs'));if(change==='dispose')assert.equal(x.root.childElementCount,0);else assert(x.root.textContent.includes(x.localization.text(change==='account'?'shop.changedView':'shop.changedQuantity')));}finally{x.close();}
});

test('root locale ownership is local, host labels win, disposal restores attributes',async()=>{
  const x=setup({locale:'ar',messages:{'nav.shop':'اكتشف'}});try{x.root.setAttribute('lang','de');x.root.setAttribute('dir','ltr');const mounted=await x.mount({viewLabels:{shop:'Host discovery'}});assert.equal(x.root.lang,'ar');assert.equal(x.root.dir,'rtl');assert(find(x.root,'Host discovery'));assert.equal(document.documentElement.getAttribute('lang'),null);
    const other=document.createElement('main');document.body.append(other);const english=mountFramework(other,{client:x.client,sections:['packs'],locale:'en'});await english.ready;assert.equal(other.lang,'en');assert(other.textContent.includes('No packs yet'));assert.equal(x.root.lang,'ar');english.dispose();assert.equal(other.getAttribute('lang'),null);assert.equal(other.getAttribute('dir'),null);mounted.dispose();assert.equal(x.root.lang,'de');assert.equal(x.root.dir,'ltr');
  }finally{x.close();}
});

test('standalone artwork and opener accept portable messages and clean root language',async()=>{
  const x=setup();try{const messages={'artwork.back':'Voir le dos','artwork.front':'Voir le devant','opener.next':'Suivant','opener.all':'Tout révéler','opener.progress':'{revealed} sur {total} révélées'},art=renderPack(x.product,{locale:'fr',messages});document.body.append(art.node);assert.equal(art.node.lang,'fr');click(art.node,'Voir le dos');assert(find(art.node,'Voir le devant'));art.dispose();
    const controller=createRevealController({open:async()=>({id:'pack',cards:x.cards})}),root=document.createElement('div');root.lang='de';const dispose=mountOpener(root,{controller,locale:'fr',messages});document.body.append(root);await controller.load('pack');assert(root.textContent.includes('0 sur 2 révélées'));click(root,'Suivant');assert(root.textContent.includes('1 sur 2 révélées'));click(root,'Tout révéler');assert(root.textContent.includes('2 sur 2 révélées'));dispose();assert.equal(root.lang,'de');controller.dispose();
  }finally{x.close();}
});

test('translated template markup remains literal and invalid bundles fail before mounting',async()=>{
  const x=setup({messages:{'shop.title':'<img src=x onerror=alert(1)> < 3 > 1'}});try{await x.mount();assert.equal(x.root.querySelector('.dc-section h2').textContent,'<img src=x onerror=alert(1)> < 3 > 1');assert.equal(x.root.querySelector('.dc-section h2 img'),null);const root=document.createElement('div');root.lang='de';assert.throws(()=>mountFramework(root,{client:x.client,locale:'fr',messages:{'shop.buy':'Missing placeholders'}}));assert.equal(root.childElementCount,0);assert.equal(root.lang,'de');}finally{x.close();}
});
