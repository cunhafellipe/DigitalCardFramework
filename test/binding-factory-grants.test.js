import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {bindingFactoryConfiguration,snapshotBindingFactoryUser,createBindingFactoryRegistry,createRemoteBindingFactory} from '../src/remote-binding-factory.js';
import {bindingFactoryProtocol,bindingFactoryInputDigest,bindingFactoryIdentity,matchBindingFactoryResults} from '../src/binding-factory-contracts.js';
const config={kind:'pure',providerId:'example.factory',revision:1};
test('factory user snapshots contain only granted fields and detach mutable input',()=>{
 const user={id:'collector',profile:{region:null,preferences:{color:'blue'},private:'hidden'},token:'hidden'};
 assert.deepEqual(snapshotBindingFactoryUser(user,bindingFactoryConfiguration(config).userFields),{id:'collector'});
 const fields=bindingFactoryConfiguration({...config,userFields:['id','profile.region','profile.preferences']}).userFields;
 const result=snapshotBindingFactoryUser(user,fields);assert.deepEqual(result,{id:'collector',profile:{region:null,preferences:{color:'blue'}}});result.profile.preferences.color='red';assert.equal(user.profile.preferences.color,'blue');
 assert.throws(()=>snapshotBindingFactoryUser(user,['id','profile.missing']),{code:'BINDING_FACTORY_FIELD'});
});
test('factory grants reject unsafe paths, duplicates and missing stable identity',()=>{
 for(const userFields of [['profile'],['id','id'],['id','__proto__.value'],['id','profile.constructor'],['id','profile..name'],['id','profile.'],['id','profile\nname'],['id','a.b.c.d.e.f.g.h.i']])assert.throws(()=>bindingFactoryConfiguration({...config,userFields}),{code:'BINDING_FACTORY_CONFIG'});
 for(const bad of [{...config,providerId:undefined},{...config,revision:0},{...config,kind:'legacy'}])assert.throws(()=>bindingFactoryConfiguration(bad),{code:'BINDING_FACTORY_CONFIG'});
 const inherited=Object.create({private:'hidden'});inherited.id='collector';assert.throws(()=>snapshotBindingFactoryUser(inherited,['id','private']),{code:'BINDING_FACTORY_FIELD'});
});

function request(factory,{user={id:'collector'},deadline=Date.now()+10000}={}){
 const copyId=randomUUID(),entry={invocationId:randomUUID(),attemptId:randomUUID(),copyId,userId:'collector',namespace:'example.reward',factoryName:'example.factory',factoryRevision:1,kind:'pure',packIndex:0,slotId:'main',slotOrdinal:0,input:{copy:{id:copyId,ownerId:'collector',cardId:'card',variantId:'variant',lineId:'line',rarityId:'rarity',state:'sealed',serialNumber:null,editionTotal:null,createdAt:'2026-10-12T00:00:00.000Z',openedAt:null,openedBy:null,acquiredAt:'2026-10-12T00:00:00.000Z',source:{},version:1,definition:{},variant:{},bindings:{},metadata:{}},user,spec:{factory:'example.factory',visibility:'owner',transfer:'follow'}}};entry.inputDigest=bindingFactoryInputDigest(entry);
 return {protocol:bindingFactoryProtocol,operation:'produce',requestId:randomUUID(),...factory.grant(),batchId:randomUUID(),inputDigest:'a'.repeat(64),deadline,context:{entries:[entry]}};
}
function response(request){return {...Object.fromEntries(Object.entries(request).filter(([key])=>key!=='context')),status:'processed',results:request.context.entries.map(entry=>({...bindingFactoryIdentity(entry),state:'ready',data:{reward:'synthetic'}}))};}

test('pure factory rejects expired and ungranted inputs before invoking its callback',async()=>{
 let calls=0;const registry=createBindingFactoryRegistry({allocationBindingFactories:{'example.factory':{...config,userFields:['id','profile.region'],produce(){calls++;return {};}}}}),factory=registry.factories['example.factory'];
 try{
  const user={id:'collector',profile:{region:'west'}};
  await assert.rejects(factory.evaluate(request(factory,{user,deadline:1})),{code:'POLICY_TIMEOUT'});
  for(const value of [{...user,private:'synthetic'},{id:'collector',profile:{region:'west',private:'synthetic'}}])await assert.rejects(factory.evaluate(request(factory,{user:value})),{code:'BINDING_FACTORY_FIELD'});
  assert.equal(calls,0);assert.throws(()=>factory.userFields.push('private'),TypeError);
  const result=await factory.evaluate(request(factory,{user}));assert.equal(result.results[0].state,'ready');assert.equal(calls,1);
 }finally{registry.close();}
});

test('remote factory rejects expired and ungranted inputs before sending HTTP',async()=>{
 let calls=0;const server=createServer(async(req,res)=>{calls++;const chunks=[];for await(const chunk of req)chunks.push(chunk);const value=JSON.parse(Buffer.concat(chunks));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response(value)));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const factory=createRemoteBindingFactory({...config,userFields:['id','profile.region'],url:'http://127.0.0.1:'+server.address().port,token:'synthetic-factory-credential',allowLoopbackHttp:true});
 try{
  const user={id:'collector',profile:{region:'west'}};
  await assert.rejects(factory.evaluate(request(factory,{user,deadline:1})),{code:'POLICY_TIMEOUT'});
  for(const value of [{...user,private:'synthetic'},{id:'collector',profile:{region:'west',private:'synthetic'}}])await assert.rejects(factory.evaluate(request(factory,{user:value})),{code:'BINDING_FACTORY_FIELD'});
  assert.equal(calls,0);const result=await factory.evaluate(request(factory,{user}));assert.equal(result.results[0].state,'ready');assert.equal(calls,1);
 }finally{factory.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('result matching rejects every changed envelope identity despite exact entry echoes',()=>{
 const factory={grant:()=>({providerId:'example.factory',grantId:randomUUID(),generation:1})},value=request(factory),result=response(value);
 assert.equal(matchBindingFactoryResults(value,result).length,1);
 for(const [key,replacement]of Object.entries({protocol:'other@1',operation:'lookup',requestId:randomUUID(),providerId:'other.factory',grantId:randomUUID(),generation:2,batchId:randomUUID(),inputDigest:'b'.repeat(64),deadline:value.deadline+1}))assert.throws(()=>matchBindingFactoryResults(value,{...result,[key]:replacement}),{code:'INVALID_BINDING_FACTORY_RESPONSE'},key);
});
