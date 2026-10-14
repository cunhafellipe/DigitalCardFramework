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
