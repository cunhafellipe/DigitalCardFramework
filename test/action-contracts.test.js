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
