import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.js';
import {validateWireRequest,validateWireResponse,WireContractError} from '../src/wire-contracts.js';
import {createWireTransport,WireApiError} from '../src/wire-client.js';
import {openapi} from '../src/contracts.js';
import {createApiHandler} from '../src/http.js';
import {createServer} from 'node:http';
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
