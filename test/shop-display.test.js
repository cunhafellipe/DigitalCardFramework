import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {shopDisplayProfile,shopDisplayFields,shopDisplayLabelKeys,validateShopDisplay,validateShopIntent} from '../src/presentation/shop-display.js';
const snapshot=()=>{const handle=randomUUID();return {profile:shopDisplayProfile,snapshotId:randomUUID(),fields:[],locale:'en',dir:'ltr',labels:Object.fromEntries(shopDisplayLabelKeys.map(key=>[key,key])),search:'',page:0,hasMore:false,total:1,busy:false,items:[{handle,position:0,quantity:1,maxQuantity:100,selected:true,reviewable:true,recoverable:false}],details:{handle,page:0,total:0,hasMore:false,summary:'',explanation:'',rows:[]},previews:[]};};
test('shop field grants reject every ungranted product term and rate disclosure',()=>{
 const clean=snapshot();assert.deepEqual(validateShopDisplay(clean),clean);
 for(const [field,value]of [['name','Product'],['line','Line'],['price',{unitAmount:10,totalAmount:10,currency:'Credits'}],['available',true],['window','Tomorrow'],['pity','Rare by pack5'],['allocation','Conditional tickets']]){const valueToCheck=snapshot();valueToCheck.items[0][field]=value;assert.throws(()=>validateShopDisplay(valueToCheck),error=>error.code==='SHOP_DISPLAY');}
 const rates=snapshot();rates.details.explanation='Unapproved rates';assert.throws(()=>validateShopDisplay(rates));
 const full=snapshot();full.fields=[...shopDisplayFields];Object.assign(full.items[0],{name:'Pack',line:'Line',price:{unitAmount:10,totalAmount:10,currency:'Credits'},available:false,window:'Unavailable today',pity:'Personal pity',allocation:'Conditional tickets'});full.details.total=1;full.details.rows=[{position:0,slot:0,draws:1,weight:3,totalWeight:10,remaining:7,label:'Card · Rare',value:'3 configured tickets'}];assert.equal(validateShopDisplay(full).details.rows[0].remaining,7);
 for(const change of [{weight:0},{totalWeight:2},{remaining:-1}]){const invalid=structuredClone(full);Object.assign(invalid.details.rows[0],change);assert.throws(()=>validateShopDisplay(invalid));}
});
test('shop intents refuse empty/foreign handles, extra financial inputs and quantities beyond the snapshot',()=>{
 const current=validateShopDisplay(snapshot()),base={intent:'shop-review',snapshotId:current.snapshotId,handle:current.items[0].handle,quantity:2};assert.deepEqual(validateShopIntent(base,current),base);
 for(const handle of ['',null,0,false,{},randomUUID()])assert.throws(()=>validateShopIntent({...base,handle},current));
 for(const extra of [{key:'request'},{price:{amount:1}},{productId:'native-id'},{intent:'shop-commit'},{quantity:101},{quantity:0}])assert.throws(()=>validateShopIntent({...base,...extra},current));
 const recovery=structuredClone(current);recovery.items[0].recoverable=true;assert.throws(()=>validateShopIntent(base,recovery));assert.doesNotThrow(()=>validateShopIntent({...base,quantity:1},recovery));
});
test('shop validators reject accessors, prototype payloads, duplicate handles and oversized windows',()=>{
 let calls=0;const event={snapshotId:randomUUID(),handle:randomUUID(),quantity:1};Object.defineProperty(event,'intent',{enumerable:true,get(){calls++;return 'shop-review';}});assert.throws(()=>validateShopIntent(event));assert.equal(calls,0);
 const prototype=Object.create({inherited:'private'});Object.assign(prototype,snapshot());assert.throws(()=>validateShopDisplay(prototype));
 const duplicate=snapshot();duplicate.total=2;duplicate.items.push({...duplicate.items[0],position:1,selected:false});assert.throws(()=>validateShopDisplay(duplicate));
 const large=snapshot();large.total=49;large.items=Array.from({length:49},(_,position)=>({...large.items[0],handle:randomUUID(),position,selected:false}));large.details=null;assert.throws(()=>validateShopDisplay(large));
});
