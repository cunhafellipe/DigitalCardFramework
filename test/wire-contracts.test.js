import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.js';
import {codesFixture,vault} from './codes-fixtures.mjs';
import {CardFramework} from '../src/core.js';
import {fixture as presentationFixture,build as buildPresentation} from './presentation-fixtures.mjs';
import {validateWireRequest,validateWireResponse,WireContractError} from '../src/wire-contracts.js';
import {createWireTransport,WireApiError} from '../src/wire-client.js';
import {openapi} from '../src/contracts.js';
import {createApiHandler} from '../src/http.js';
import {createServer} from 'node:http';
import {MemoryStore} from '../src/store.js';
import {createCurrencyGateway} from '../src/currency-gateway.js';

test('acquisition request and real detached responses validate, including immutable replay',()=>{
  const x=fixture(),quote=x.core.quote(x.alice,{productId:'common'});
  validateWireRequest('quote',{productId:'common'});
  validateWireResponse('quote',200,quote);
  const input={...quote,key:'contract-purchase'};
  validateWireRequest('purchase',input);
  const result=x.core.purchase(x.alice,input);
  validateWireResponse('purchase',200,result);
  assert.deepEqual(x.core.purchase(x.alice,input),result);
  const open={key:'contract-open',packId:result.packs[0].id};
  validateWireRequest('openPack',open);
  validateWireResponse('openPack',200,x.core.openPack(x.alice,open));
  const leaked=structuredClone(result);leaked.packs[0].copyIds=['sealed'];
  assert.throws(()=>validateWireResponse('purchase',200,leaked),WireContractError);
  for(const openedAt of ['2026-02-30T12:00:00Z','2026-01-01T25:00:00Z','2026-01-01T12:00:00+24:00']){
    const invalid=structuredClone(result);invalid.packs[0].openedAt=openedAt;assert.throws(()=>validateWireResponse('purchase',200,invalid),WireContractError);
  }
});

test('negative acquisition fixtures reject missing, null, unknown and inexact integers',()=>{
  for(const input of [{},{productId:null},{productId:'common',userId:'injected'},{productId:'common',quantity:0},{productId:'common',quantity:101},{productId:'common',quantity:1.5}])
    assert.throws(()=>validateWireRequest('quote',input),WireContractError);
  const x=fixture(),quote=x.core.quote(x.alice,{productId:'common'});
  for(const mutate of [value=>delete value.catalogVersion,value=>value.productRevision=null,value=>value.adminRevision=Number.MAX_SAFE_INTEGER+1,value=>value.price.amount=Number.MAX_SAFE_INTEGER+1,value=>value.price.amount=1.1,value=>value.unexpected=true]){
    const value=structuredClone(quote);mutate(value);assert.throws(()=>validateWireResponse('quote',200,value),WireContractError);
  }
  validateWireResponse('quote',200,{...quote,price:{currencyId:'credits',amount:Number.MAX_SAFE_INTEGER}});
  validateWireResponse('quote',400,{code:'INVALID_INPUT',message:'Invalid product'});
  for(const error of [{code:'X'},{code:null,message:'Invalid'},{code:'X',message:'Invalid',secret:'hidden'}])assert.throws(()=>validateWireResponse('quote',400,error),WireContractError);
});

test('every published error status carries the JSON error envelope',()=>{
  for(const item of Object.values(openapi.paths))for(const operation of Object.values(item))for(const [status,response]of Object.entries(operation.responses)){
    if(Number(status)>=400)assert.equal(response.content['application/json'].schema.$ref,'#/components/schemas/Error');
  }
});

test('production review requests reject omitted and malformed trade digests',()=>{
  for(const expectedDigest of [undefined,null,'unchecked'])assert.throws(()=>validateWireRequest('acceptTrade',{key:'accept',tradeId:'trade',expectedDigest}),WireContractError);
  validateWireRequest('acceptTrade',{key:'accept',tradeId:'trade',expectedDigest:'a'.repeat(64)});
});

test('checked transport validates actual HTTP acquisition and error responses',async t=>{
  const x=fixture();let handler;
  const server=createServer((request,response)=>handler(request,response));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>x.alice,allowedOrigin:origin,requirePrincipal:true,requireTradeReview:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>x.alice.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  const quote=await call('quote',{productId:'common'});
  const purchase=await call('purchase',{...quote,key:'http-wire-purchase'});
  const replay=await call('purchase',{...quote,key:'http-wire-purchase'});assert.deepEqual(replay,purchase);
  const receipt=await call('openPack',{key:'http-wire-open',packId:purchase.packs[0].id});assert.equal(receipt.cards.length,1);
  await assert.rejects(()=>call('quote',{productId:'missing'}),error=>error instanceof WireApiError&&error.status===404&&error.code==='UNAVAILABLE');
});

test('checked transport preserves session and principal binding and fails before sending malformed commands',async()=>{
  const x=fixture(),quote=x.core.quote(x.alice,{productId:'common'});let calls=0;
  const call=createWireTransport({principal:()=>x.alice.userId,fetch:async(url,options)=>{
    calls++;assert.equal(url,'/api/quote');assert.equal(options.credentials,'same-origin');
    assert.equal(options.headers['X-DC-Principal'],x.alice.userId);assert.equal(options.headers['Content-Type'],'application/json');
    return new Response(JSON.stringify(quote),{status:200});
  }});
  assert.deepEqual(await call('quote',{productId:'common'}),quote);
  await assert.rejects(()=>call('quote',{productId:'common',quantity:101}),WireContractError);assert.equal(calls,1);
  const fail=createWireTransport({principal:()=>null,fetch:async()=>new Response(JSON.stringify({code:'UNAUTHENTICATED',message:'Sign in'}),{status:401})});
  await assert.rejects(()=>fail('quote',{productId:'common'}),error=>error instanceof WireApiError&&error.code==='UNAUTHENTICATED'&&error.status===401);
  const malformed=createWireTransport({principal:()=>null,fetch:async()=>new Response('{}',{status:200})});
  await assert.rejects(()=>malformed('quote',{productId:'common'}),WireContractError);
});

test('listing stock contracts require the fields for each existing stock kind',()=>{
  const listing=items=>({key:'listing',shopId:'shop',title:'Stock',price:{currencyId:'credits',amount:1},items});
  for(const items of [{kind:'copies',ids:['copy']},{kind:'packs',ids:['pack']},{kind:'mint-card',variantId:'card',quantity:1},{kind:'mint-pack',productId:'pack',quantity:1},{kind:'action',handler:'reward',quantity:1}]){
    validateWireRequest('createListing',listing(items));
    // Fields belonging to another branch remain permitted by the existing server contract.
    validateWireRequest('createListing',listing({...items,params:{},productId:'pack'}));
    for(const field of Object.keys(items).filter(key=>key!=='kind')){
      const invalid={...items};delete invalid[field];
      assert.throws(()=>validateWireRequest('createListing',listing(invalid)),WireContractError);
    }
  }
  for(const items of [{kind:'copies',ids:[]},{kind:'packs',ids:['pack','pack']},{kind:'action',handler:'reward',quantity:0},{kind:'mint-card',variantId:'card',quantity:'1'}])assert.throws(()=>validateWireRequest('createListing',listing(items)),WireContractError);
});

test('checked currency reconciliation returns the retained receipt and enforces principal binding',async t=>{
  const x=fixture();let handler;
  const gateway=createCurrencyGateway({framework:x.core,providers:{points:{currencies:{POINTS:{currencyId:'credits'}},resolveAccount:({userId})=>'external:'+userId,lookup:({transactionId,account})=>({transactionId,account,status:'settled',currency:'POINTS',amountUnits:'150'})}}});
  const server=createServer((request,response)=>handler(request,response));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,currencyGateway:gateway,resolveIdentity:()=>x.alice,allowedOrigin:origin,requirePrincipal:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const transport=principal=>createWireTransport({baseUrl:origin+'/api',principal,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  const input={providerId:'points',transactionId:'settled-transaction'};
  for(const principal of [()=>null,()=>x.bob.userId])await assert.rejects(()=>transport(principal)('reconcileCurrency',input),error=>error instanceof WireApiError&&error.code==='PRINCIPAL_CHANGED'&&error.status===409);
  const call=transport(()=>x.alice.userId),receipt=await call('reconcileCurrency',input);
  assert.deepEqual(receipt,{...input,userId:x.alice.userId,currencyId:'credits',amount:150,balance:10150,at:'2026-09-30T12:00:00.000Z'});
  assert.deepEqual(await call('reconcileCurrency',input),receipt);
  for(const mutate of [value=>delete value.balance,value=>value.amount='150',value=>value.balance=Number.MAX_SAFE_INTEGER+1,value=>value.externalUnits='150',value=>value.at='invalid']){
    const invalid=structuredClone(receipt);mutate(invalid);assert.throws(()=>validateWireResponse('reconcileCurrency',200,invalid),WireContractError);
  }
});

test('query and path contracts fail before fetch and omit optional null values',async()=>{
  let requests=0;
  const call=createWireTransport({principal:()=>null,fetch:async()=>{requests++;return new Response(JSON.stringify({code:'NOT_FOUND',message:'Missing record'}),{status:404});}});
  const batchId='11111111-1111-4111-8111-111111111111';
  for(const id of ['codeIssuanceStatus','bindingFactoryStatus']){
    for(const options of [undefined,{}, {query:{}},{query:{batchId:null}},{query:{batchId:'invalid'}}])await assert.rejects(()=>call(id,undefined,options),error=>error instanceof WireContractError&&error.phase==='query');
  }
  for(const [id,options]of [
    ['adminUser',{query:{}}],['allocationStatus',{query:{}}],['stockAllocationStatus',{query:{productId:'common'}}],
    ['inventory',{query:{limit:'50'}}],['inventory',{query:{limit:0}}],['inventory',{query:{limit:201}}],['inventory',{query:{limit:1.5}}],['inventory',{query:{limit:NaN}}],
    ['inventory',{query:{search:'x'.repeat(101)}}],['inventory',{query:{sort:'invalid'}}],['inventory',{query:{limti:50}}],['wallet',{query:{limit:50}}],
    ['viewAlbum',undefined],['inspectCard',{path:{copyId:''}}],['tradeInventory',{path:{userId:1}}]
  ])await assert.rejects(()=>call(id,undefined,options),WireContractError);
  assert.equal(requests,0);
  for(const id of ['codeIssuanceStatus','bindingFactoryStatus'])await assert.rejects(()=>call(id,undefined,{query:{batchId}}),WireApiError);
  assert.equal(requests,2);
  const sent=[];
  const read=createWireTransport({principal:()=>null,fetch:async url=>{sent.push(url);return new Response(JSON.stringify({code:'NOT_FOUND',message:'Missing record'}),{status:404});}});
  await assert.rejects(()=>read('inventory',undefined,{query:{limit:50,after:null,search:undefined,sort:'ordinal'}}),WireApiError);
  await assert.rejects(()=>read('inventory',undefined,{query:{limit:50,sort:'id'}}),WireApiError);
  await assert.rejects(()=>read('inspectCard',undefined,{path:{copyId:'copy /?&'}}),WireApiError);
  assert.deepEqual(sent,['/api/inventory?limit=50&sort=ordinal','/api/inventory?limit=50&sort=id','/api/cards/copy%20%2F%3F%26']);
});

test('checked wallet, exact and rounded conversions, and listing quote branches use actual HTTP shapes',async t=>{
  const x=fixture({actionHandlers:{'external.item':async()=>{}}}),seller={...x.alice,role:'admin'};let handler;
  const shop=x.core.createShop(seller,{key:'contract-shop',name:'Shop',kind:'admin'});
  const owned=x.open('common',x.alice)[0];
  const stocks=[{kind:'mint-card',variantId:'dawn.standard',quantity:2},{kind:'copies',ids:[owned.id]},{kind:'mint-pack',productId:'common',quantity:1},{kind:'action',handler:'external.item',quantity:1,params:{sku:'hat'}}];
  const listings=stocks.map((items,index)=>x.core.createListing(seller,{key:'contract-listing-'+index,shopId:shop.id,title:'Stock',price:{currencyId:'credits',amount:index===3?0:20},items}));
  const server=createServer((request,response)=>handler(request,response));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>x.bob,allowedOrigin:origin,requirePrincipal:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>x.bob.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  assert.deepEqual(await call('wallet',undefined),{credits:10000});
  validateWireResponse('wallet',200,{});
  validateWireResponse('wallet',200,{credits:0,custom:Number.MAX_SAFE_INTEGER});
  for(const wallet of [{credits:-1},{credits:1.5},{credits:'1'},{credits:null},{credits:Number.MAX_SAFE_INTEGER+1},{credits:{amount:1}}])assert.throws(()=>validateWireResponse('wallet',200,wallet),WireContractError);
  for(const [index,amount]of [100,101].entries()){
    const input={key:'convert-contract-'+index,from:'credits',to:'gems',amount,rounding:index?'floor':'exact',catalogVersion:1};
    const receipt=await call('convert',input);
    assert.equal(receipt.received,1);assert.equal(receipt.remainderNumerator,String(index));assert.equal(receipt.remainderDenominator,'100');
    assert.deepEqual(await call('convert',input),receipt);
    for(const mutate of [value=>delete value.received,value=>value.received=0,value=>value.amount='100',value=>value.remainderNumerator=0,value=>value.remainderNumerator='-1',value=>value.remainderDenominator='0',value=>value.remainderDenominator='100\n',value=>value.privateAccount='hidden']){
      const invalid=structuredClone(receipt);mutate(invalid);assert.throws(()=>validateWireResponse('convert',200,invalid),WireContractError);
    }
  }
  assert.deepEqual(await call('wallet',undefined),{credits:9799,gems:2});
  for(const [index,listing]of listings.entries()){
    const quote=await call('quoteListing',{listingId:listing.id,quantity:index===0?2:1});
    assert.equal(quote.items[0].kind,['copy','copy','pack','custom'][index]);
    assert.equal(quote.price.amount,index===0?40:index===3?0:20);
    for(const mutate of [value=>delete value.price,value=>value.quantity='1',value=>value.digest='invalid',value=>value.price.amount=-1,value=>value.unitIds.push(value.unitIds[0]),value=>value.items[0].kind='unknown',value=>value.items[0].privateData='hidden']){
      const invalid=structuredClone(quote);mutate(invalid);assert.throws(()=>validateWireResponse('quoteListing',200,invalid),WireContractError);
    }
    const item=quote.items[0];
    if(item.kind==='copy'){
      const extended=structuredClone(quote);extended.items[0].copy.metadata.custom={nested:true};validateWireResponse('quoteListing',200,extended);
      const invalid=structuredClone(quote);invalid.items[0].copy.state='unknown';assert.throws(()=>validateWireResponse('quoteListing',200,invalid),WireContractError);
    }else if(item.kind==='pack'){
      const invalid=structuredClone(quote);invalid.items[0].pack.copyIds=['sealed'];assert.throws(()=>validateWireResponse('quoteListing',200,invalid),WireContractError);
    }
  }
});

test('listing and order records validate creation, purchase replay, cancellation and public pages',async t=>{
  let now='2026-09-30T12:00:00.000Z',actor,handler;
  const x=fixture({clock:()=>now,actionHandlers:{'external.item':async()=>{},'external.fail':async()=>{throw new Error('Delivery unavailable');}},actionOptions:{maxAttempts:1}}),seller={...x.alice,role:'admin'};
  actor=seller;
  const shop=x.core.createShop(seller,{key:'record-shop',name:'Shop',kind:'admin'});
  const server=createServer((request,response)=>handler(request,response));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,requirePrincipal:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>actor.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  const stocks=[{kind:'mint-card',variantId:'dawn.standard',quantity:2},{kind:'mint-pack',productId:'common',quantity:2},{kind:'action',handler:'external.item',quantity:2},{kind:'action',handler:'external.fail',quantity:2}];
  const orders=[];
  for(const [index,items]of stocks.entries()){
    actor=seller;
    const input={key:'record-listing-'+index,shopId:shop.id,title:'Stock',price:{currencyId:'credits',amount:index>1?0:20},items,metadata:{custom:{label:'Edition'}}};
    const listing=await call('createListing',input);assert.deepEqual(await call('createListing',input),listing);
    assert.equal(listing.preview.kind,['card','pack','custom','custom'][index]);assert.equal(listing.mine,true);assert.equal(listing.remaining,2);
    assert.deepEqual(listing.metadata,input.metadata);
    for(const mutate of [value=>delete value.remaining,value=>value.remaining=-1,value=>value.mine='yes',value=>value.status='unknown',value=>value.units=[],value=>value.entries={},value=>value.preview.copyIds=['sealed']]){
      const invalid=structuredClone(listing);mutate(invalid);assert.throws(()=>validateWireResponse('createListing',200,invalid),WireContractError);
    }
    const optional=structuredClone(listing);delete optional.shopName;delete optional.sellerName;validateWireResponse('createListing',200,optional);
    actor=x.bob;
    const buyerListing=(await call('listings',undefined,{query:{shopId:shop.id}})).items.find(row=>row.id===listing.id);assert.equal(buyerListing.mine,false);
    const quote=await call('quoteListing',{listingId:listing.id}),purchase={key:'record-buy-'+index,listingId:listing.id,quantity:quote.quantity,unitIds:quote.unitIds,digest:quote.digest};
    const order=await call('buyListing',purchase);orders.push({order,purchase});assert.deepEqual(await call('buyListing',purchase),order);
    assert.equal(order.items[0].kind,['copy','pack','custom','custom'][index]);assert.equal(order.fulfillment,index>1?'pending':'complete');
    for(const mutate of [value=>delete value.paid,value=>value.paid.amount=-1,value=>value.quantity=1.5,value=>value.fulfillment='unknown',value=>value.items[0].code='private',value=>value.items[0].copyIds=['sealed'],value=>value.actionJobIds=[null]]){
      const invalid=structuredClone(order);mutate(invalid);assert.throws(()=>validateWireResponse('buyListing',200,invalid),WireContractError);
    }
    actor=seller;
    const canceled=await call('cancelListing',{key:'record-cancel-'+index,listingId:listing.id});assert.equal(canceled.status,'canceled');assert.equal(canceled.remaining,0);
  }
  await x.core.dispatchActions({role:'admin'});
  actor=x.bob;
  const page=await call('orders',undefined,{query:{limit:2}});assert.equal(page.items.length,2);assert.equal(page.total,4);assert.equal(typeof page.next,'string');
  const all=await call('orders',undefined);assert.equal(all.items.find(row=>row.id===orders[2].order.id).fulfillment,'complete');assert.equal(all.items.find(row=>row.id===orders[3].order.id).fulfillment,'attention-required');
  assert.deepEqual(await call('buyListing',orders[2].purchase),orders[2].order);
  for(const id of ['listings','orders']){
    const page=await call(id,undefined);
    for(const mutate of [value=>value.total='4',value=>value.next=42,value=>delete value.items[0].id]){const invalid=structuredClone(page);mutate(invalid);assert.throws(()=>validateWireResponse(id,200,invalid),WireContractError);}
  }
  actor=seller;
  const timed=await call('createListing',{key:'timed-record',shopId:shop.id,title:'Timed',price:{currencyId:'credits',amount:0},items:{kind:'action',handler:'external.item',quantity:1},startsAt:'2026-09-30T12:01:00.000Z',endsAt:'2026-09-30T12:02:00.000Z'});assert.equal(timed.phase,'upcoming');
  now='2026-09-30T12:03:00.000Z';x.core.expireListings({role:'admin'});
  assert.equal((await call('listings',undefined)).items.find(row=>row.id===timed.id).status,'expired');
});

test('commerce settings and shop responses preserve effective controls, metadata and viewer fields',async t=>{
  const x=fixture(),manager={...x.alice,role:'admin'};let actor=manager,handler;
  const server=createServer((request,response)=>handler(request,response));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,requirePrincipal:true,exposeOperators:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>actor.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  const initial=await call('commerceSettings',undefined);assert.equal(initial.revision,0);assert.deepEqual(initial.settings,initial.effectiveSettings);
  const configuration={key:'commerce-record',expectedRevision:0,settings:{playerShops:true,packResale:true,allowedCurrencyIds:['credits']}};
  const configured=await call('configureCommerce',configuration);assert.equal(configured.revision,1);assert.equal(configured.settings.playerShops,true);assert.equal(configured.settings.maxStockPerListing,100);assert.equal(Object.hasOwn(configured,'effectiveSettings'),false);assert.deepEqual(await call('configureCommerce',configuration),configured);
  const adminInput={key:'shop-record-admin',name:'Managed',kind:'admin',metadata:{theme:{handle:'authored',snapshotId:'authored'}}};
  const managed=await call('createShop',adminInput);assert.equal(managed.kind,'admin');assert.deepEqual(managed.metadata,adminInput.metadata);assert.deepEqual(await call('createShop',adminInput),managed);assert.equal(Object.hasOwn(managed,'mine'),false);
  actor=x.bob;const player=await call('createShop',{key:'shop-record-player',name:'Personal'});assert.equal(player.kind,'player');assert.equal(player.ownerId,x.bob.userId);
  const playerView=await call('shops',undefined,{query:{limit:1,sort:'name'}});assert.equal(playerView.total,2);assert.equal(playerView.items[0].mine,false);assert.equal(typeof playerView.next,'string');
  actor=manager;const disabled=await call('setShopEnabled',{key:'shop-record-disable',shopId:player.id,enabled:false});assert.equal(disabled.enabled,false);assert.equal((await call('shops',undefined)).items.find(shop=>shop.id===player.id).mine,false);
  actor=x.bob;assert.equal((await call('shops',undefined)).items.find(shop=>shop.id===player.id).mine,true);
  actor=x.alice;assert.equal((await call('shops',undefined)).items.some(shop=>shop.id===player.id),false);
  x.core.configureAdmin(manager,{key:'shop-record-pause',expectedRevision:0,scope:'site',changes:{playerShopsPaused:true},reason:'Pause player shops'});
  const effective=await call('commerceSettings',undefined);assert.equal(effective.settings.playerShops,true);assert.equal(effective.effectiveSettings.playerShops,false);
  for(const mutate of [value=>delete value.effectiveSettings,value=>delete value.settings.packResale,value=>value.effectiveSettings.playerShops='false',value=>value.settings.maxStockPerListing=1001,value=>value.revision=-1,value=>value.secret='hidden']){
    const invalid=structuredClone(effective);mutate(invalid);assert.throws(()=>validateWireResponse('commerceSettings',200,invalid),WireContractError);
  }
  for(const mutate of [value=>delete value.settings,value=>delete value.settings.enabled,value=>value.settings.allowedCurrencyIds=[null],value=>value.revision=1.5]){const invalid=structuredClone(configured);mutate(invalid);assert.throws(()=>validateWireResponse('configureCommerce',200,invalid),WireContractError);}
  for(const id of ['createShop','setShopEnabled'])for(const mutate of [value=>delete value.ownerId,value=>value.enabled='true',value=>value.kind='unknown',value=>value.metadata=null,value=>value.createdAt='invalid',value=>value.credentials={}]){
    const invalid=structuredClone(managed);mutate(invalid);assert.throws(()=>validateWireResponse(id,200,invalid),WireContractError);
  }
  const page=await call('shops',undefined);for(const mutate of [value=>delete value.items[0].mine,value=>value.items[0].mine=1,value=>value.total=-1]){const invalid=structuredClone(page);mutate(invalid);assert.throws(()=>validateWireResponse('shops',200,invalid),WireContractError);}
});


test('raffle HTTP responses cover entry replay, private status, draw replay and claimed winners',async t=>{
  let now='2026-09-30T12:00:00.000Z',handler;
  const store=new MemoryStore(),x=fixture({store,clock:()=>now,raffleRandom:()=>0}),manager={...x.alice,role:'admin'};let actor=manager;
  const shop=x.core.createShop(manager,{key:'raffle-shop',name:'Raffles',kind:'admin'});
  const listing=key=>x.core.createListing(manager,{key,shopId:shop.id,title:key,price:{currencyId:'credits',amount:0},items:{kind:'mint-card',variantId:'dawn.standard',quantity:1},raffle:{entryClosesAt:'2026-09-30T12:01:00.000Z',claimSeconds:60,winners:1}});
  const active=listing('raffle-active'),empty=listing('raffle-empty'),canceled=listing('raffle-canceled');
  const server=createServer((request,response)=>handler(request,response));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,requirePrincipal:true,exposeOperators:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();x.core.close();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>actor.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  actor=x.bob;
  const before=await call('raffleStatus',{listingId:active.id});assert.equal(before.entered,false);assert.equal(before.drawnAt,null);assert.equal(before.claimUntil,null);assert.equal(before.orderId,null);
  const entryInput={key:'raffle-entry',listingId:active.id},entry=await call('enterRaffle',entryInput);assert.equal(entry.entered,true);assert.equal(entry.entryCount,1);const enteredState=store.read(state=>state);assert.deepEqual(await call('enterRaffle',entryInput),entry);assert.deepEqual(store.read(state=>state),enteredState);
  assert.deepEqual(await call('enterRaffle',{...entryInput,key:'raffle-entry-again'}),entry);
  actor=manager;await call('cancelListing',{key:'raffle-cancel',listingId:canceled.id});assert.equal((await call('raffleStatus',{listingId:canceled.id})).status,'canceled');
  now='2026-09-30T12:01:00.000Z';
  const drawInput={key:'raffle-draw',listingId:active.id},draw=await call('drawRaffle',drawInput);assert.equal(draw.winners.length,1);assert.equal(draw.winners[0].userId,x.bob.userId);assert.equal(draw.winners[0].orderId,null);const drawnState=store.read(state=>state);assert.deepEqual(await call('drawRaffle',drawInput),draw);assert.deepEqual(store.read(state=>state),drawnState);assert.deepEqual(await call('drawRaffle',{...drawInput,key:'raffle-redraw'}),draw);
  assert.deepEqual((await call('drawRaffle',{key:'raffle-empty-draw',listingId:empty.id})).winners,[]);
  const observer=await call('raffleStatus',{listingId:active.id});assert.equal(observer.winner,false);assert.equal(observer.claimUntil,null);assert.equal(observer.drawnAt,draw.at);
  actor=x.bob;const winner=await call('raffleStatus',{listingId:active.id});assert.equal(winner.winner,true);assert.equal(winner.claimUntil,draw.claimUntil);assert.equal(winner.orderId,null);
  const quote=await call('quoteListing',{listingId:active.id});const order=await call('buyListing',{key:'raffle-claim',...quote});
  const claimed=await call('raffleStatus',{listingId:active.id});assert.equal(claimed.orderId,order.id);assert.deepEqual(await call('enterRaffle',entryInput),entry);
  actor=manager;assert.deepEqual(await call('drawRaffle',drawInput),draw);assert.equal((await call('drawRaffle',{...drawInput,key:'raffle-after-claim'})).winners[0].orderId,order.id);
  now='2026-09-30T12:02:00.000Z';x.core.expireListings(manager);assert.equal((await call('raffleStatus',{listingId:empty.id})).status,'expired');
  for(const operation of ['enterRaffle','raffleStatus'])for(const mutate of [value=>delete value.entered,value=>value.entryCount=-1,value=>value.winner='true',value=>value.drawnAt='invalid',value=>value.claimUntil=0,value=>value.orderId={},value=>value.status='unknown',value=>value.winners=draw.winners]){
    const invalid=structuredClone(claimed);mutate(invalid);assert.throws(()=>validateWireResponse(operation,200,invalid),WireContractError);
  }
  for(const mutate of [value=>delete value.winners,value=>value.at=null,value=>value.claimUntil='invalid',value=>delete value.winners[0].unitId,value=>value.winners[0].orderId=1,value=>value.winners[0].privateAccount={},value=>value.entries={}]){
    const invalid=structuredClone(draw);mutate(invalid);assert.throws(()=>validateWireResponse('drawRaffle',200,invalid),WireContractError);
  }
});


test('binding, owned-card and notification HTTP contracts preserve provider data and retained-holder privacy',async t=>{
  const store=new MemoryStore(),providerData={code:'example-private-value',custom:{handle:'authored',snapshotId:'authored',values:[1,null,true]}};
  const x=fixture({store,bindings:{'demo.code':()=>providerData}}),copy=x.open('unique')[0];let actor=x.alice,handler;
  const server=createServer((request,response)=>handler(request,response));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,requirePrincipal:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();x.core.close();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>actor.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  const inspected=await call('inspectCard',undefined,{path:{copyId:copy.id}});assert.equal(inspected.id,copy.id);assert.deepEqual(inspected.bindings['demo.code'].data,providerData);
  const held=await call('bindings',undefined);assert.equal(held.length,1);assert.equal(held[0].copyId,copy.id);assert.equal(held[0].namespace,'demo.code');assert.deepEqual(held[0].data,providerData);
  const trade=x.core.proposeTrade(x.alice,{key:'binding-transfer',toUserId:x.bob.userId,give:{copyIds:[copy.id],currencies:[]},receive:{copyIds:[],currencies:[]}});x.core.acceptTrade(x.bob,{key:'binding-accept',tradeId:trade.id});
  actor=x.bob;const transferred=await call('inspectCard',undefined,{path:{copyId:copy.id}});assert.equal(transferred.ownerId,x.bob.userId);assert.equal(transferred.bindings['demo.code'],undefined);assert.deepEqual(await call('bindings',undefined),[]);
  actor=x.alice;assert.equal((await call('bindings',undefined))[0].holderId,x.alice.userId);
  const input={key:'binding-use',copyId:copy.id,namespace:'demo.code'},used=await call('consumeBinding',input);assert.equal(used.state,'used');assert.equal(typeof used.usedAt,'string');
  const replayState=()=>store.read(({copies,requests,events,notifications})=>({copies,requests,events,notifications}));
  const consumedState=replayState();assert.deepEqual(await call('consumeBinding',input),used);assert.deepEqual(replayState(),consumedState);
  const usedBinding=(await call('bindings',undefined))[0];assert.equal(usedBinding.state,'used');assert.equal(usedBinding.usedAt,used.usedAt);assert.deepEqual(usedBinding.data,providerData);
  const notifications=x.core.notifications(actor).items,ids=notifications.map(row=>row.id);assert(ids.length>0);
  const readInput={key:'binding-notifications',ids},read=await call('readNotifications',readInput);assert.deepEqual(read,{ok:true});assert(x.core.notifications(actor).items.every(row=>row.read));
  const readState=replayState();assert.deepEqual(await call('readNotifications',readInput),read);assert.deepEqual(replayState(),readState);
  // Activation states deliberately omit provider data until activation succeeds.
  for(const state of ['activation-pending','activation-failed']){
    store.transact(s=>{Object.assign(s.copies[copy.id].bindings['demo.code'],{state,activationId:'internal-invocation'});});
    const pending=(await call('bindings',undefined))[0];assert.equal(pending.state,state);assert.equal(Object.hasOwn(pending,'data'),false);assert.equal(Object.hasOwn(pending,'usedAt'),false);assert.equal(Object.hasOwn(pending,'activationId'),false);
    for(const field of ['data','usedAt','activationId']){const invalid=structuredClone(pending);invalid[field]=field==='data'?{}:'internal';assert.throws(()=>validateWireResponse('bindings',200,[invalid]),WireContractError);}
  }
  for(const mutate of [value=>delete value.copyId,value=>value.state='active',value=>value.usedAt='invalid',value=>value.data={}]){const invalid=structuredClone(used);mutate(invalid);assert.throws(()=>validateWireResponse('consumeBinding',200,invalid),WireContractError);}
  for(const mutate of [value=>delete value.namespace,value=>delete value.holderId,value=>delete value.data,value=>value.transfer='unknown',value=>value.data=null,value=>value.activationId='private']){const invalid=structuredClone(usedBinding);mutate(invalid);assert.throws(()=>validateWireResponse('bindings',200,[invalid]),WireContractError);}
  for(const mutate of [value=>delete value.id,value=>value.state='unknown',value=>value.definition.name=1,value=>value.bindings['demo.code'].data=null]){const invalid=structuredClone(inspected);mutate(invalid);assert.throws(()=>validateWireResponse('inspectCard',200,invalid),WireContractError);}
  for(const invalid of [{},{ok:false},{ok:'true'},{ok:true,ids}])assert.throws(()=>validateWireResponse('readNotifications',200,invalid),WireContractError);
});


test('directory, notifications, ledger and public-album HTTP projections retain privacy and pagination',async t=>{
  const x=fixture(),admin={role:'admin'};let actor=x.alice,handler;
  const carol=x.core.registerUser(admin,{provider:'test',subject:'directory-carol',displayName:'Carol'}),blocked=x.core.registerUser(admin,{provider:'test',subject:'directory-hidden',displayName:'Hidden'});
  x.core.setPreferences(x.alice,{key:'directory-block',blockedUserIds:[blocked.id]});x.core.setPreferences(x.bob,{key:'directory-private',inventoryVisibility:'private'});
  const copies=[...x.open(),...x.open()];x.open('common',x.bob);
  const shared=x.core.saveAlbum(x.alice,{key:'album-shared',name:'Public <edition>',visibility:'public',placements:[{copyId:copies[0].id}]}),privateAlbum=x.core.saveAlbum(x.alice,{key:'album-private',name:'Private',visibility:'private',placements:[{copyId:copies[1].id}]});
  const empty=x.core.saveAlbum(x.bob,{key:'album-empty',name:'Empty',visibility:'public',placements:[]});
  const server=createServer((request,response)=>handler(request,response));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,requirePrincipal:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();x.core.close();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>actor.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  const first=await call('directory',undefined,{query:{limit:1}});assert.equal(first.total,2);assert.equal(first.items[0].id,x.bob.userId);assert.equal(first.items[0].inventoryVisible,false);assert.equal(typeof first.next,'string');
  const second=await call('directory',undefined,{query:{limit:1,after:first.next}});assert.equal(second.items[0].id,carol.id);assert.equal(second.next,null);
  assert.equal((await call('directory',undefined,{query:{search:'absent'}})).items.length,0);assert(!JSON.stringify(first).includes('subject'));
  const notices=await call('notifications',undefined,{query:{limit:1}});assert.equal(notices.total,2);assert.equal(notices.items[0].userId,x.alice.userId);assert.equal(notices.items[0].type,'pack.opened');assert.equal(typeof notices.items[0].data.packId,'string');assert.equal(notices.items[0].read,false);
  const more=await call('notifications',undefined,{query:{limit:1,after:notices.next}});assert.equal(more.items.length,1);assert.notEqual(more.items[0].id,notices.items[0].id);assert.equal(more.next,null);
  await call('readNotifications',{key:'read-page',ids:[notices.items[0].id]});assert.equal((await call('notifications',undefined)).items.find(row=>row.id===notices.items[0].id).read,true);
  const history=await call('history',undefined);assert(history.every(row=>row.userId===x.alice.userId));assert(history.some(row=>row.delta<0));assert(history.some(row=>row.delta>0));assert.equal(history.at(-1).balance,9980);
  const albums=await call('publicAlbums',undefined);assert.equal(albums.length,2);assert.equal(albums.find(row=>row.id===shared.id).cardCount,1);assert.equal(albums.find(row=>row.id===empty.id).cardCount,0);assert.equal(albums.some(row=>row.id===privateAlbum.id),false);assert.equal(albums.find(row=>row.id===shared.id).name,'Public <edition>');
  actor={userId:carol.id};assert.deepEqual((await call('notifications',undefined)).items,[]);assert.deepEqual(await call('history',undefined),[]);
  for(const mutate of [value=>delete value.items[0].inventoryVisible,value=>value.items[0].createdAt='invalid',value=>value.items[0].subject='private',value=>value.total=-1,value=>value.next=1]){const invalid=structuredClone(first);mutate(invalid);assert.throws(()=>validateWireResponse('directory',200,invalid),WireContractError);}
  for(const mutate of [value=>delete value.items[0].userId,value=>value.items[0].read='false',value=>value.items[0].data=null,value=>value.items[0].credentials={},value=>value.total='2']){const invalid=structuredClone(notices);mutate(invalid);assert.throws(()=>validateWireResponse('notifications',200,invalid),WireContractError);}
  const optionalData=structuredClone(notices);delete optionalData.items[0].data;validateWireResponse('notifications',200,optionalData);optionalData.items[0].data={custom:{nested:[null,true,1]}};validateWireResponse('notifications',200,optionalData);
  for(const mutate of [value=>delete value[0].reference,value=>value[0].delta=0.5,value=>value[0].balance=-1,value=>value[0].at='invalid',value=>value[0].credentials={}]){const invalid=structuredClone(history);mutate(invalid);assert.throws(()=>validateWireResponse('history',200,invalid),WireContractError);}
  for(const mutate of [value=>delete value[0].ownerName,value=>value[0].cardCount=-1,value=>value[0].cardCount='1',value=>value[0].placements=[]]){const invalid=structuredClone(albums);mutate(invalid);assert.throws(()=>validateWireResponse('publicAlbums',200,invalid),WireContractError);}
});


test('operator code and action HTTP records exclude secrets while retaining lifecycle and authored data',async t=>{
  let now='2026-09-30T12:00:00.000Z';
  const x=codesFixture({stock:2,clock:()=>now,change(c){c.variants.find(row=>row.id==='dawn.standard').onOpen=[{id:'deliver',handler:'example.contract-delivery',params:{private:'delivery-secret'}}];},actionHandlers:{'example.contract-delivery':async()=>({privateResult:'provider-secret'})}});
  let actor={...x.alice,role:'admin'},handler;
  const server=createServer((request,response)=>handler(request,response));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,requirePrincipal:true,exposeOperators:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();x.core.close();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>actor.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  const input={key:'pool-contract',pool:{id:'additional',providerId:'example.additional',name:'Additional',metadata:{region:{names:['one','two']}}}};
  const configured=await call('configureCodePool',input);assert.equal(configured.normalization,'exact');assert.equal(configured.enabled,true);assert.equal(configured.instructions,'');assert.equal(configured.redeemUrl,null);assert.deepEqual(configured.metadata,input.pool.metadata);assert.deepEqual(await call('configureCodePool',input),configured);
  x.core.importCodes(actor,{key:'expiring-contract',poolId:'additional',codes:[{code:'EXPIRING-PRIVATE',expiresAt:'2026-09-30T12:01:00.000Z',metadata:{extension:{label:'authored'}}}]});
  const initial=await call('codeInventory',undefined,{query:{limit:1}});assert.equal(initial.total,3);assert.equal(initial.items[0].copyId,null);assert.equal(initial.items[0].allocatedAt,null);assert.equal(typeof initial.next,'string');
  const next=await call('codeInventory',undefined,{query:{limit:1,after:initial.next}});assert.notEqual(next.items[0].id,initial.items[0].id);
  const opened=x.openCode(),codeId=opened.codes[0].id;
  const allocated=(await call('codeInventory',undefined)).items.find(row=>row.id===codeId);assert.equal(allocated.holderId,x.alice.userId);assert.equal(allocated.copyId,opened.id);assert.equal(allocated.status,'allocated');
  x.core.revealCode(x.alice,{key:'code-reveal-contract',codeId});x.core.reportCodeUsage(x.alice,{key:'code-reported',codeId,used:true});
  now='2026-09-30T12:02:00.000Z';
  const records=await call('codeInventory',undefined);assert.equal(records.items.find(row=>row.id===codeId).reportedUsed,true);assert.equal(records.items.find(row=>row.poolId==='additional').status,'expired');
  const pools=await call('codePools',undefined);assert.equal(pools.find(row=>row.id==='rewards').counts.allocated,1);assert.equal(pools.find(row=>row.id==='additional').counts.expired,1);
  const pending=await call('actionJobs',undefined,{query:{limit:1}});assert.equal(pending.total,2);assert.equal(pending.items[0].status,'pending');assert.equal(typeof pending.next,'string');
  await x.core.dispatchActions(actor);const jobs=await call('actionJobs',undefined);assert(jobs.items.every(job=>job.status==='succeeded'));assert(jobs.items.every(job=>job.attempts===1));assert(jobs.items.every(job=>job.history.length>1));
  const payload=JSON.stringify({records,pools,jobs});for(const secret of ['SECRET-REWARD','EXPIRING-PRIVATE','delivery-secret','provider-secret','fingerprint','leaseToken'])assert.equal(payload.includes(secret),false);
  for(const mutate of [value=>delete value.createdAt,value=>delete value.enabled,value=>value.normalization='unknown',value=>value.metadata=null,value=>value.secret='private']){const invalid=structuredClone(configured);mutate(invalid);assert.throws(()=>validateWireResponse('configureCodePool',200,invalid),WireContractError);}
  for(const mutate of [value=>delete value[0].counts,value=>value[0].counts.allocated=-1,value=>value[0].counts.unknown=1]){const invalid=structuredClone(pools);mutate(invalid);assert.throws(()=>validateWireResponse('codePools',200,invalid),WireContractError);}
  for(const mutate of [value=>delete value.items[0].holderHistory,value=>value.items[0].status='unknown',value=>value.items[0].revealedAt='invalid',value=>value.items[0].metadata=null,value=>value.items[0].secret={},value=>value.items[0].fingerprint='private']){const invalid=structuredClone(records);mutate(invalid);assert.throws(()=>validateWireResponse('codeInventory',200,invalid),WireContractError);}
  for(const mutate of [value=>delete value.items[0].handler,value=>value.items[0].attempts=-1,value=>value.items[0].status='unknown',value=>value.items[0].params={},value=>value.items[0].leaseToken='private',value=>value.items[0].result={}]){const invalid=structuredClone(jobs);mutate(invalid);assert.throws(()=>validateWireResponse('actionJobs',200,invalid),WireContractError);}
  actor=x.bob;for(const operation of ['codePools','codeInventory','actionJobs'])await assert.rejects(call(operation,undefined),error=>error instanceof WireApiError&&error.status===403);
  await assert.rejects(call('configureCodePool',{...input,key:'denied-pool'}),error=>error instanceof WireApiError&&error.status===403);
  const generated=new CardFramework({clock:()=>now,random:()=>0,codeVault:vault(),codeGenerators:{'example.generator':()=>({code:'GENERATED-PRIVATE',metadata:{provider:{version:1}}})},actionHandlers:{'example.contract-delivery':async()=>{}}});t.after(()=>generated.close());
  generated.publishCatalog({role:'admin'},x.c);const user=generated.registerUser({role:'admin'},{provider:'test',subject:'generated-reader',displayName:'Generated reader'});actor={userId:user.id,role:'admin'};
  generated.grantCurrency(actor,{key:'generated-fund',userId:user.id,currencyId:'credits',amount:100,reason:'Fixture funding'});
  handler=createApiHandler({framework:generated,resolveIdentity:()=>actor,allowedOrigin:origin,requirePrincipal:true,exposeOperators:true});
  const generatedPool=await call('configureCodePool',{key:'generated-pool',pool:{id:'rewards',providerId:'example.game',name:'Generated',generator:'example.generator'}});assert.equal(generatedPool.generator,'example.generator');
  const purchase=generated.purchase(actor,{key:'generated-purchase',...generated.quote(actor,{productId:'bundle'})});generated.openPack(actor,{key:'generated-open',packId:purchase.packs[0].id});
  const generatedInventory=await call('codeInventory',undefined);assert.equal(generatedInventory.total,1);const generatedCode=generatedInventory.items[0];assert.equal(generatedCode.batchId,null);assert.equal(generatedCode.externalId,null);assert.equal(generatedCode.expiresAt,null);assert.equal(generatedCode.status,'allocated');assert.deepEqual(generatedCode.metadata,{provider:{version:1}});assert.equal(JSON.stringify(generatedInventory).includes('GENERATED-PRIVATE'),false);
  assert.equal((await call('codePools',undefined))[0].counts.allocated,1);

});


test('availability and trading HTTP records retain compatibility and immutable lock receipts',async t=>{
  const x=fixture({change(c){const base=c.products.find(row=>row.id==='common');base.pity={after:2,rarityId:c.variants.find(row=>row.id==='dawn.standard').rarityId,metadata:{label:'authored'}};for(const [index,pity]of [false,0,'',null].entries())c.products.push({...structuredClone(base),id:'pity-sentinel-'+index,pity});c.products.push({...structuredClone(base),id:'future-product',availableFrom:'2026-10-01T00:00:00.000Z'});}}),copy=x.open('unique')[0];let actor={...x.alice,role:'admin'},handler;
  const server=createServer((request,response)=>handler(request,response));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,requirePrincipal:true,exposeOperators:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();x.core.close();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>actor?.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  const available=await call('availability',undefined);assert.equal(available.version,1);assert.equal(available.variants.find(row=>row.id==='solstice.unique').remaining,0);assert.equal(available.variants.find(row=>row.id==='dawn.standard').remaining,null);assert.equal(available.products.find(row=>row.id==='future-product').available,false);
  assert.deepEqual(available.products.find(row=>row.id==='common').pity.metadata,{label:'authored'});for(const [index,pity]of [false,0,'',null].entries())assert.equal(available.products.find(row=>row.id==='pity-sentinel-'+index).pity,pity);
  const initial=await call('tradingPolicy',undefined);assert.equal(initial.revision,0);assert.equal(initial.policy.maxCardsPerSide,100);
  const input={key:'trading-contract',expectedRevision:0,policy:{allowGifts:false,allowedCurrencyIds:['credits'],rules:[{id:'line-rule',decision:'deny',reason:'Line unavailable',match:{lineIds:['sky']}}]}};
  const configured=await call('configureTrading',input);assert.equal(configured.policy.allowGifts,false);assert.equal(configured.policy.cooldownSeconds,0);assert.deepEqual(await call('configureTrading',input),configured);assert.deepEqual(await call('tradingPolicy',undefined),configured);
  const lockInput={key:'lock-contract',copyId:copy.id,reason:'Review pending',until:'2026-10-01T00:00:00.000Z'},locked=await call('setCardTransferLock',lockInput);assert.equal(locked.lock.actorId,x.alice.userId);assert.equal(locked.lock.until,lockInput.until);assert.equal(locked.version,copy.version+1);assert.deepEqual(await call('setCardTransferLock',lockInput),locked);
  const inspected=await call('inspectCard',undefined,{path:{copyId:copy.id}});assert.deepEqual(inspected.transferLock,locked.lock);
  const unlocked=await call('setCardTransferLock',{key:'unlock-contract',copyId:copy.id,locked:false});assert.equal(unlocked.lock,null);assert.equal(unlocked.version,locked.version+1);assert.deepEqual(await call('setCardTransferLock',lockInput),locked);assert.equal(Object.hasOwn(await call('inspectCard',undefined,{path:{copyId:copy.id}}),'transferLock'),false);
  const indefinite=await call('setCardTransferLock',{key:'indefinite-contract',copyId:copy.id});assert.equal(indefinite.lock.until,null);
  actor=x.bob;await assert.rejects(call('configureTrading',{...input,key:'denied-trading'}),error=>error instanceof WireApiError&&error.status===403);await assert.rejects(call('setCardTransferLock',{...lockInput,key:'denied-lock'}),error=>error instanceof WireApiError&&error.status===403);
  actor=null;assert.deepEqual(await call('availability',undefined),available);
  for(const mutate of [value=>delete value.variants,value=>value.variants[0].issued=-1,value=>value.variants[0].remaining='1',value=>value.products[0].available=1,value=>value.products[0].pity={after:0,rarityId:'common'},value=>value.products[0].pity=true,value=>value.products[0].pity='unknown',value=>value.accounts=[]]){const invalid=structuredClone(available);mutate(invalid);assert.throws(()=>validateWireResponse('availability',200,invalid),WireContractError);}
  for(const operation of ['configureTrading','tradingPolicy'])for(const mutate of [value=>delete value.policy.allowGifts,value=>value.revision=-1,value=>value.policy.rules[0].decision='unknown',value=>value.policy.maxCardsPerSide='100',value=>value.private={ }]){const invalid=structuredClone(configured);mutate(invalid);assert.throws(()=>validateWireResponse(operation,200,invalid),WireContractError);}
  for(const mutate of [value=>delete value.lock,value=>value.version=0,value=>delete value.lock.actorId,value=>value.lock.until='invalid',value=>value.lock.reason=1,value=>value.lock.credentials={}]){const invalid=structuredClone(locked);mutate(invalid);assert.throws(()=>validateWireResponse('setCardTransferLock',200,invalid),WireContractError);}
  validateWireResponse('setCardTransferLock',200,{...indefinite,lock:{...indefinite.lock,actorId:null}});
});


test('card policy and resource HTTP receipts preserve authored documents and lifecycle replay',async t=>{
  const x=fixture(),manager={...x.alice,role:'admin'};let actor=manager,handler;
  const server=createServer((request,response)=>handler(request,response));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,requirePrincipal:true,exposeOperators:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();x.core.close();}));
  const call=createWireTransport({baseUrl:origin+'/api',principal:()=>actor.userId,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})}),revision=()=>x.core.cardPolicies(manager).revision;
  const document={schemaVersion:1,id:'contracts.policy',revision:1,name:'Policy <literal>',fields:[{key:'demo.required',label:'Required',type:'string',required:true},{key:'demo.power',label:'Power',type:'number',default:2},{key:'demo.double',label:'Double',type:'number',source:'calculated',calculate:['mul',['field','demo.power'],2]}],defaults:{stats:{'demo.power':2}}};
  const saveInput={key:'policy-receipt-save',expectedRevision:revision(),document},saved=await call('saveCardPolicy',saveInput);assert.equal(saved.state,'draft');assert.deepEqual(saved.document,document);assert.deepEqual(await call('saveCardPolicy',saveInput),saved);
  const preview=await call('previewCardPolicy',{expectedRevision:revision(),policy:'contracts.policy@1',assignments:[{scope:'installation',policy:'contracts.policy@1'}]});
  const activateInput={...preview,key:'policy-receipt-activate'},activated=await call('activateCardPolicy',activateInput);assert(activated.affected.length>0);assert.deepEqual(activated.affected,preview.affected);assert.deepEqual(await call('activateCardPolicy',activateInput),activated);
  const detached=await call('previewCardPolicy',{expectedRevision:revision(),policy:'contracts.policy@1',assignments:[]});await call('activateCardPolicy',{...detached,key:'policy-receipt-detach'});
  const retireInput={key:'policy-receipt-retire',expectedRevision:revision(),policy:'contracts.policy@1'},retired=await call('retireCardPolicy',retireInput);assert.equal(retired.state,'retired');assert.deepEqual(await call('retireCardPolicy',retireInput),retired);
  const restoreInput={key:'policy-receipt-restore',expectedRevision:revision(),policy:'contracts.policy@1'},restored=await call('restoreCardPolicy',restoreInput);assert.equal(restored.state,'superseded');assert.deepEqual(await call('restoreCardPolicy',restoreInput),restored);assert.deepEqual(await call('saveCardPolicy',saveInput),saved);assert.deepEqual(await call('activateCardPolicy',activateInput),activated);
  const pkg=await buildPresentation(presentationFixture());await x.core.registerCardPresentation(manager,pkg.archive);
  const asset=pkg.manifest.assets[0],resource={kind:'template',document:{id:'contracts.template',revision:1,name:'Template <literal>',packageDigest:pkg.digest,canvas:{...pkg.manifest.canvas},slots:[],assetDigests:{[asset.id]:asset.sha256},tags:['authored']}};
  const resourceInput={key:'resource-receipt-save',expectedRevision:revision(),resource},resourceSaved=await call('saveCardResource',resourceInput);assert.deepEqual(resourceSaved.resource,resource);assert.equal(Object.hasOwn(resourceSaved.resource,'retired'),false);assert.deepEqual(await call('saveCardResource',resourceInput),resourceSaved);
  const resourceRetireInput={key:'resource-receipt-retire',expectedRevision:revision(),reference:'contracts.template@1',kind:'template'},resourceRetired=await call('retireCardResource',resourceRetireInput);assert.equal(resourceRetired.retired,true);assert.deepEqual(await call('retireCardResource',resourceRetireInput),resourceRetired);
  const resourceRestoreInput={key:'resource-receipt-restore',expectedRevision:revision(),reference:'contracts.template@1',kind:'template'},resourceRestored=await call('restoreCardResource',resourceRestoreInput);assert.equal(resourceRestored.retired,false);assert.deepEqual(await call('restoreCardResource',resourceRestoreInput),resourceRestored);assert.deepEqual(await call('saveCardResource',resourceInput),resourceSaved);
  const registry=x.core.cardPolicies(manager);assert.equal(registry.history.length,registry.revision);assert.equal(registry.resources.find(row=>row.document.id==='contracts.template').retired,false);
  const receipts={saveCardPolicy:saved,activateCardPolicy:activated,retireCardPolicy:retired,restoreCardPolicy:restored,saveCardResource:resourceSaved,retireCardResource:resourceRetired,restoreCardResource:resourceRestored};
  for(const [operation,receipt]of Object.entries(receipts))for(const mutate of [value=>delete value.revision,value=>value.revision=-1,value=>value.credentials={}]){const invalid=structuredClone(receipt);mutate(invalid);assert.throws(()=>validateWireResponse(operation,200,invalid),WireContractError);}
  for(const [operation,receipt,field,value]of [['saveCardPolicy',saved,'state','active'],['activateCardPolicy',activated,'affected',{}],['retireCardPolicy',retired,'state','draft'],['restoreCardPolicy',restored,'state','active'],['saveCardResource',resourceSaved,'resource',{}],['retireCardResource',resourceRetired,'retired',false],['restoreCardResource',resourceRestored,'retired',true]])assert.throws(()=>validateWireResponse(operation,200,{...receipt,[field]:value}),WireContractError);
  actor=x.bob;await assert.rejects(call('saveCardPolicy',{...saveInput,key:'policy-denied',expectedRevision:revision()}),error=>error instanceof WireApiError&&error.status===403);await assert.rejects(call('saveCardResource',{...resourceInput,key:'resource-denied',expectedRevision:revision()}),error=>error instanceof WireApiError&&error.status===403);
});
