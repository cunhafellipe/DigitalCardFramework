import {codesFixture} from './codes-fixtures.mjs';
import {fixture as coreFixture,admin} from './helpers.js';
import {MemoryStore} from '../src/store.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {validateActionDelivery,validateActionAcknowledgment,validateFrameworkEvent,createRemoteActionHandler} from '@digital-card/framework/remote-actions';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/action-delivery.json',import.meta.url),'utf8'));
test('published action schema and SDK validate the same Unicode/integer golden delivery',()=>{
  const schema=JSON.parse(readFileSync(new URL('../docs/action-delivery.schema.json',import.meta.url),'utf8'));
  const compiler=new Ajv2020({strict:true,allowUnionTypes:true});const validate=compiler.compile(schema);
  assert.equal(validate(fixture),true);assert.deepEqual(validateActionDelivery(fixture),fixture);
  const reply={protocol:fixture.protocol,pluginId:fixture.pluginId,jobId:fixture.jobId,status:'completed'};
  assert.deepEqual(validateActionAcknowledgment(reply),reply);
  assert.equal(compiler.compile({$ref:schema.$id+'#/$defs/acknowledgment'})(reply),true);
});
test('action SDK rejects malformed, non-JSON and excessive input before dispatch',async()=>{
  let calls=0;const handler=createRemoteActionHandler({url:'http://127.0.0.1/actions',pluginId:fixture.pluginId,handlerId:fixture.handlerId,token:'public-fixture-credential',fetchImpl:async()=>{calls++;throw Error('Unexpected dispatch');}});
  const job={idempotencyKey:fixture.jobId,userId:fixture.beneficiaryId,source:fixture.source,params:fixture.params};
  const cycle={};cycle.self=cycle;
  let deep={};for(let i=0;i<18;i++)deep={child:deep};
  for(const patch of [{source:null},{params:[]},{userId:undefined},{params:{value:NaN}},{params:{value:Infinity}},{params:{value:()=>1}},{params:{value:'\ud800'}},{params:{['\ud800']:'key'}},{params:cycle},{params:deep},{params:{value:'x'.repeat(32768)}}])await assert.rejects(handler({...job,...patch}),error=>error.code==='PLUGIN_JOB');
  assert.equal(calls,0);
  for(const patch of [{protocol:null},{pluginId:'bad identity'},{handlerId:null},{jobId:''},{beneficiaryId:23},{source:[]},{params:null},{actor:{role:'admin'}}])assert.throws(()=>validateActionDelivery({...fixture,...patch}),error=>error.code==='PLUGIN_JOB');
});
test('acknowledgments reject missing, null and unknown fields',()=>{
  const reply={protocol:fixture.protocol,pluginId:fixture.pluginId,jobId:fixture.jobId,status:'completed'};
  for(const key of Object.keys(reply)){const value={...reply};delete value[key];assert.throws(()=>validateActionAcknowledgment(value));assert.throws(()=>validateActionAcknowledgment({...reply,[key]:null}));}
  assert.throws(()=>validateActionAcknowledgment({...reply,handlerId:fixture.handlerId}));
});


test('opt-in event contract validates actual core events and subscription delivery without constraining custom actions',async()=>{
  const received=[],store=new MemoryStore(),x=coreFixture({store,eventSubscriptions:[{id:'events',handler:'example.events',events:['*']}],actionHandlers:{'example.events':async job=>{received.push(validateFrameworkEvent(job.params.event));}}});
  try{
    const copy=x.open()[0];
    const trade=x.core.proposeTrade(x.alice,{key:'event-gift',toUserId:x.bob.userId,give:{copyIds:[copy.id],currencies:[]},receive:{copyIds:[],currencies:[]}});x.core.acceptTrade(x.bob,{key:'event-accept',tradeId:trade.id});
    x.core.settleExternalCredit(admin,{providerId:'provider',transactionId:'event-transaction',userId:x.alice.userId,currencyId:'credits',amount:1,externalCurrency:'USD',externalUnits:'1'});
    const preview=x.core.previewImport(admin,{expectedVersion:1,source:{cards:[]}});x.core.commitImport(admin,{...preview,key:'event-import'});
    store.transact(s=>{delete s.copies[copy.id].provenance;});x.core.backfillProvenance(admin);
    const events=x.core.events(admin,{limit:1000}),types=['catalog.published','catalog.imported','user.registered','provenance.backfilled','currency.external-settled','card.issued','card.opened','card.transferred'];
    const schema=JSON.parse(readFileSync(new URL('../docs/action-delivery.schema.json',import.meta.url),'utf8')),compiler=new Ajv2020({strict:true,allowUnionTypes:true});compiler.addSchema(schema);const published=compiler.compile({$ref:schema.$id+'#/$defs/event'});
    for(const type of types){const event=events.find(row=>row.type===type);assert(event,type);assert.equal(validateFrameworkEvent(event,type),event);assert.equal(published(event),true);const invalid=structuredClone(event);delete invalid.data[Object.keys(invalid.data)[0]];assert.throws(()=>validateFrameworkEvent(invalid),error=>error.code==='PLUGIN_JOB');assert.equal(published(invalid),false);}
    assert(events.some(event=>event.completionId));for(const event of events)validateFrameworkEvent(event);
    await x.core.dispatchActions(admin,{limit:100});assert.equal(received.length,events.length);assert(received.some(event=>event.type==='card.transferred'));
    const opened=events.find(event=>event.type==='card.opened');assert.throws(()=>validateFrameworkEvent(opened,'card.issued'),error=>error.code==='PLUGIN_JOB');
    for(const patch of [{sequence:0},{sequence:1.5},{at:null},{completionId:42},{data:[]},{type:''},{privateState:{}}])assert.throws(()=>validateFrameworkEvent({...opened,...patch}),error=>error.code==='PLUGIN_JOB');
    const unknown={id:'future-event',sequence:1,type:'extension.future',data:{authored:{values:[null,1,true,'value']}},at:opened.at};assert.equal(validateFrameworkEvent(unknown),unknown);assert.equal(published(unknown),true);
    const malformedKnown={...unknown,type:'card.opened'};assert.throws(()=>validateFrameworkEvent(malformedKnown),error=>error.code==='PLUGIN_JOB');
    const custom={...fixture,source:{type:'event',authored:true},params:{event:{authored:true}}};assert.equal(validateActionDelivery(custom),custom);
    const issued=events.find(event=>event.type==='card.issued');const authored=structuredClone(issued);authored.data.provenance.extension={handle:'authored',snapshotId:'authored'};validateFrameworkEvent(authored);
    const invalid=structuredClone(events.find(event=>event.type==='catalog.imported'));invalid.data.digest+='\n';assert.throws(()=>validateFrameworkEvent(invalid));
    for(const data of [{value:NaN},{callback:()=>{}},{value:'x'.repeat(32768)}])assert.throws(()=>validateFrameworkEvent({...unknown,data}),error=>error.code==='PLUGIN_JOB');
  }finally{x.core.close();}
});


test('code event contracts validate emitted lifecycle and unallocated provider confirmations',()=>{
  const x=codesFixture({transfer:'follow-unrevealed'});
  try{
    const copy=x.openCode(),codeId=copy.codes[0].id;
    const trade=x.core.proposeTrade(x.alice,{key:'code-gift',toUserId:x.bob.userId,give:{copyIds:[copy.id],currencies:[]},receive:{copyIds:[],currencies:[]}});
    x.core.acceptTrade(x.bob,{key:'code-accept',tradeId:trade.id});
    x.core.revealCode(x.bob,{key:'code-reveal',codeId});
    x.core.reportCodeUsage(x.bob,{key:'code-used',codeId});
    x.core.reportCodeUsage(x.bob,{key:'code-unused',codeId,used:false});
    x.core.confirmCodeStatus(admin,{providerId:'example.game',eventId:'redeemed',codeId,status:'redeemed',occurredAt:'2026-09-30T12:01:00Z'});
    const unallocated=x.store.read(s=>Object.values(s.codes).find(row=>row.copyId===null).id);
    const serviceActor={...admin};delete serviceActor.userId;
    x.core.confirmCodeStatus(serviceActor,{providerId:'example.game',eventId:'revoked',codeId:unallocated,status:'revoked',occurredAt:'2026-09-30T12:01:00Z'});
    x.core.rotateCodeEncryption(serviceActor);
    const events=x.core.events(admin,{limit:1000}).filter(event=>event.type.startsWith('code.'));
    const schema=JSON.parse(readFileSync(new URL('../docs/action-delivery.schema.json',import.meta.url),'utf8')),compiler=new Ajv2020({strict:true,allowUnionTypes:true});compiler.addSchema(schema);const published=compiler.compile({$ref:schema.$id+'#/$defs/event'});
    assert.equal(new Set(events.map(event=>event.type)).size,9);
    for(const event of events){
      assert.equal(validateFrameworkEvent(event,event.type),event);assert.equal(published(event),true,JSON.stringify(published.errors));
      for(const key of Object.keys(event.data)){const invalid=structuredClone(event);delete invalid.data[key];assert.throws(()=>validateFrameworkEvent(invalid));assert.equal(published(invalid),false);}
      assert.throws(()=>validateFrameworkEvent({...event,data:{...event.data,secret:'not-public'}}));
    }
    const revoked=events.find(event=>event.type==='code.revoked');assert.equal(revoked.data.copyId,null);assert.equal(revoked.data.actorId,null);
    const used=events.find(event=>event.type==='code.usage-reported');assert.throws(()=>validateFrameworkEvent({...used,data:{...used.data,used:'true'}}));
    assert(events.some(event=>event.type==='code.usage-reported'&&event.data.used===false));
    assert(!JSON.stringify(events).includes('SECRET-REWARD'));
  }finally{x.core.close();}
});


test('core command event contracts validate actual commands and reject malformed receipts',()=>{
  const x=coreFixture();
  try{
    const copy=x.open('unique')[0],inputs=x.open('common',x.alice,3);
    x.core.openCard(x.alice,{key:'event-reveal',copyId:copy.id});
    x.core.consumeBinding(x.alice,{key:'event-binding',copyId:copy.id,namespace:'demo.code'});
    x.core.setPreferences(x.alice,{key:'event-preferences',inventoryVisibility:'public'});
    x.core.readNotifications(x.alice,{key:'event-notifications',ids:[]});
    x.core.convert(x.alice,{key:'event-convert',from:'credits',to:'gems',amount:100,catalogVersion:1});
    x.core.tradeUp(x.alice,{key:'event-tradeup',recipeId:'sky.upgrade',copyIds:inputs.map(row=>row.id)});
    x.core.saveAlbum(x.alice,{key:'event-album',name:'Event album',placements:[{copyId:copy.id}]});
    const types=['card.revealed','preferences.updated','notifications.read','currency.granted','pack.opened','binding.used','currency.converted','cards.tradedUp','album.saved','packs.purchased'];
    const events=x.core.events(admin,{limit:1000}),schema=JSON.parse(readFileSync(new URL('../docs/action-delivery.schema.json',import.meta.url),'utf8')),compiler=new Ajv2020({strict:true,allowUnionTypes:true});compiler.addSchema(schema);const published=compiler.compile({$ref:schema.$id+'#/$defs/event'});
    for(const type of types){const event=events.find(row=>row.type===type);assert(event,type);assert.equal(validateFrameworkEvent(event,type),event);assert.equal(published(event),true);
      for(const data of [{},{userId:null},{userId:1},{...event.data,privateState:{}}]){assert.throws(()=>validateFrameworkEvent({...event,data}));assert.equal(published({...event,data}),false);}
    }
  }finally{x.core.close();}
});


test('operator event contracts retain service actors and validate actual core/admin/commerce emissions',()=>{
  const x=coreFixture(),operator={...x.alice,role:'admin'};
  try{
    const copy=x.open()[0];
    x.core.configureTrading(admin,{key:'event-trading',expectedRevision:0,policy:{enabled:true}});
    x.core.setCardTransferLock(admin,{key:'event-lock',copyId:copy.id,reason:'Review'});
    x.core.configureAdmin(admin,{key:'event-admin',expectedRevision:0,reason:'Review',scope:'site',changes:{packPurchasesPaused:false}});
    x.core.administerCards(admin,{key:'event-give',expectedRevision:1,reason:'Award',action:'give',userId:x.alice.userId,variantId:'dawn.standard',quantity:1});
    const granted=x.core.inventory(x.alice).find(row=>row.id!==copy.id);
    x.core.administerCards(admin,{key:'event-remove',expectedRevision:2,reason:'Correction',action:'remove',userId:x.alice.userId,copyIds:[granted.id]});
    x.core.configureCommerce(admin,{key:'event-commerce',expectedRevision:0,settings:{playerShops:true}});
    const shop=x.core.createShop(operator,{key:'event-shop',name:'Events',kind:'admin'});
    x.core.setShopEnabled(operator,{key:'event-shop-status',shopId:shop.id,enabled:false});
    const events=x.core.events(admin,{limit:1000});
    for(const type of ['trading.configured','card.transfer-lock','admin.configured','admin.cards.give','admin.cards.remove','commerce.configured','shop.status']){
      const event=events.find(row=>row.type===type);assert(event,type);assert.equal(validateFrameworkEvent(event,type),event);
      assert.equal(event.data.userId,type==='shop.status'?x.alice.userId:null);
    }
    const schema=JSON.parse(readFileSync(new URL('../docs/action-delivery.schema.json',import.meta.url),'utf8')),compiler=new Ajv2020({strict:true,allowUnionTypes:true});compiler.addSchema(schema);const published=compiler.compile({$ref:schema.$id+'#/$defs/event'});
    const types=['trading.configured', 'card.transfer-lock', 'admin.configured', 'admin.cards.give', 'admin.cards.remove', 'card-policy.saved', 'card-policy.activated', 'card-policy.retired', 'card-policy.restored', 'card-library.saved', 'card-library.retired', 'card-library.restored', 'card-stats.updated', 'card-presentation.registered', 'commerce.configured', 'shop.status', 'raffle.drawn'];
    for(const type of types){
      const envelope={id:'operator-event',sequence:1,type,at:'2026-09-30T12:00:00Z'};
      for(const userId of [null,x.alice.userId]){const event={...envelope,data:{userId}};validateFrameworkEvent(event);assert.equal(published(event),true);}
      for(const data of [{},{userId:1},{userId:''},{userId:null,privateState:{}}]){const event={...envelope,data};assert.throws(()=>validateFrameworkEvent(event));assert.equal(published(event),false);}
    }
  }finally{x.core.close();}
});


test('trade and commerce event contracts preserve command and domain payload alternatives',()=>{
  let now='2026-10-01T00:00:00Z';const x=coreFixture({clock:()=>now}),operator={...x.alice,role:'admin'};
  try{
    const offer=key=>x.core.proposeTrade(x.alice,{key,toUserId:x.bob.userId,expiresInSeconds:1,give:{copyIds:[],currencies:[{currencyId:'credits',amount:10}]},receive:{copyIds:[],currencies:[]}});
    x.core.acceptTrade(x.bob,{key:'accept-event',tradeId:offer('accepted-event').id});
    x.core.cancelTrade(x.alice,{key:'cancel-event',tradeId:offer('cancelled-event').id});
    x.core.cancelTrade(x.bob,{key:'decline-event',tradeId:offer('declined-event').id});
    x.core.counterTrade(x.bob,{key:'counter-event',tradeId:offer('countered-event').id,give:{copyIds:[],currencies:[{currencyId:'credits',amount:5}]},receive:{copyIds:[],currencies:[]}});
    offer('expired-event');
    const shop=x.core.createShop(operator,{key:'shop-event',name:'Events',kind:'admin'});
    const listing=(key,extra={})=>x.core.createListing(operator,{key,shopId:shop.id,title:'Event stock',price:{currencyId:'credits',amount:1},items:{kind:'mint-card',variantId:'dawn.standard',quantity:1},...extra});
    x.core.cancelListing(operator,{key:'cancel-listing-event',listingId:listing('cancel-stock-event').id});
    const purchased=listing('purchased-stock-event');x.core.buyListing(x.bob,{...x.core.quoteListing(x.bob,{listingId:purchased.id}),key:'buy-event'});
    listing('expired-stock-event',{endsAt:'2026-10-01T00:00:02Z'});
    const raffle=listing('raffle-stock-event',{raffle:{entryClosesAt:'2026-10-01T01:00:00Z',claimSeconds:60,winners:1}});
    x.core.enterRaffle(x.bob,{key:'raffle-event',listingId:raffle.id});
    now='2026-10-01T00:00:03Z';x.core.sweepExpiredTrades(admin);x.core.expireListings(admin);
    const types=['trade.proposed','trade.accepted','trade.countered','trade.cancelled','trade.declined','trade.expired','shop.created','listing.created','shop.purchased','raffle.entered','shop.order-created','listing.canceled','listing.expired'];
    const events=x.core.events(admin,{limit:1000}).filter(event=>types.includes(event.type));
    const schema=JSON.parse(readFileSync(new URL('../docs/action-delivery.schema.json',import.meta.url),'utf8')),compiler=new Ajv2020({strict:true,allowUnionTypes:true});compiler.addSchema(schema);const published=compiler.compile({$ref:schema.$id+'#/$defs/event'});
    assert.equal(new Set(events.map(event=>event.type)).size,13);
    for(const event of events){validateFrameworkEvent(event,event.type);assert.equal(published(event),true);
      for(const data of [{},{userId:null},{...event.data,privateState:{}}]){assert.throws(()=>validateFrameworkEvent({...event,data}));assert.equal(published({...event,data}),false);}
    }
    for(const type of ['trade.countered','trade.cancelled']){
      assert(events.some(event=>event.type===type&&Object.hasOwn(event.data,'tradeId')));assert(events.some(event=>event.type===type&&Object.hasOwn(event.data,'userId')));
      const event=events.find(event=>event.type===type);assert.throws(()=>validateFrameworkEvent({...event,data:{userId:x.alice.userId,tradeId:'trade'}}));
    }
    assert(events.some(event=>event.type==='listing.canceled'&&Object.hasOwn(event.data,'listingId')));
    assert(events.some(event=>event.type==='listing.canceled'&&!Object.hasOwn(event.data,'listingId')));
    const order=events.find(event=>event.type==='shop.order-created');for(const key of Object.keys(order.data)){const invalid=structuredClone(order);delete invalid.data[key];assert.throws(()=>validateFrameworkEvent(invalid));}
  }finally{x.core.close();}
});
