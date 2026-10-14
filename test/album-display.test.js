import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {albumDisplayProfile,albumDisplayLimits,validateAlbumDisplay} from '../src/presentation/album-display.js';
import {pngRGBA} from './presentation-fixtures.mjs';

const snapshot=()=>({profile:albumDisplayProfile,snapshotId:randomUUID(),fields:['albumName','cardName','rarity','pageName','preview'],name:'Artist album',pages:[{index:0,name:'First page'}],items:[{handle:randomUUID(),position:0,page:0,name:'A <card>',rarity:'Common'}],previews:[]});
const invalid=value=>assert.throws(()=>validateAlbumDisplay(value));
test('full 1000-item snapshot preserves all labels and page associations within measured metadata budget',()=>{
  const value=snapshot(),name='一'.repeat(100);value.name=name;value.pages=Array.from({length:1000},(_,index)=>({index,name}));value.items=value.pages.map(page=>({handle:randomUUID(),position:page.index,page:page.index,name,rarity:name}));
  const result=validateAlbumDisplay(value),bytes=Buffer.byteLength(JSON.stringify(result));assert.equal(result.items.length,1000);assert.equal(result.pages.length,1000);assert(bytes<albumDisplayLimits.metadataBytes);assert(bytes>1000000);assert.notEqual(result,value);result.items[0].name='Detached';assert.equal(value.items[0].name,name);
});
test('private record fields are rejected at every display boundary',()=>{
  for(const key of ['copyId','ownerId','bindings','codes','source','provenance','metadata','layout','data']){const value=snapshot();value.items[0][key]='private';invalid(value);}
  const value=snapshot();value.ownerId='private';invalid(value);const preview=snapshot();preview.previews=[{handle:preview.items[0].handle,mediaType:'image/png',bytes:pngRGBA(1,1,Buffer.from([1,2,3,255])),url:'https://assets.invalid/private'}];invalid(preview);
});
test('display properties require declared fields and identifiers stay opaque',()=>{
  for(const field of ['albumName','cardName','rarity','pageName']){const value=snapshot();value.fields=value.fields.filter(value=>value!==field);invalid(value);}
  const value=snapshot();value.items[0].handle='platform-copy-id';invalid(value);value.items[0].handle=randomUUID();value.snapshotId='album-id';invalid(value);
});
test('snapshot rejects duplicates, unknown pages and oversized labels or item counts',()=>{
  let value=snapshot();value.items.push({...value.items[0],position:1});invalid(value);
  value=snapshot();value.items[0].page=1;invalid(value);
  value=snapshot();value.items[0].name='x'.repeat(101);invalid(value);
  value=snapshot();value.items=Array.from({length:1001},(_,position)=>({...value.items[0],handle:randomUUID(),position}));invalid(value);
});
test('validator never evaluates property accessors or executable display values',()=>{
  let read=false;const value=snapshot();Object.defineProperty(value.items[0],'name',{get(){read=true;return 'private';},enumerable:true});invalid(value);assert.equal(read,false);
  const executable=snapshot();executable.name=()=> 'private';invalid(executable);const poisoned=snapshot();Object.setPrototypeOf(poisoned.items[0],{bindings:'private'});invalid(poisoned);
});
test('granted raster bytes are detached and obey type, dimensions and image budgets',()=>{
  const value=snapshot(),bytes=pngRGBA(2,2,Buffer.from(Array(4).fill([3,4,5,255]).flat()));value.previews=[{handle:value.items[0].handle,mediaType:'image/png',bytes}];
  const result=validateAlbumDisplay(value);assert.deepEqual(result.previews[0].bytes,new Uint8Array(bytes));result.previews[0].bytes[0]=0;assert.notEqual(bytes[0],0);
  const denied=structuredClone(value);denied.fields=denied.fields.filter(field=>field!=='preview');invalid(denied);
  const svg=structuredClone(value);svg.previews[0].mediaType='image/svg+xml';invalid(svg);
  const large=structuredClone(value);large.previews[0].bytes=new Uint8Array(albumDisplayLimits.previewBytes+1);invalid(large);
  const malformed=structuredClone(value);malformed.previews[0].bytes=new Uint8Array(12);invalid(malformed);
});
test('aggregate decoded-pixel budget prevents many individually valid previews',()=>{
  const value=snapshot(),bytes=pngRGBA(1024,1024,Buffer.alloc(1024*1024*4,255));assert(bytes.byteLength<albumDisplayLimits.previewBytes);
  value.items=Array.from({length:9},(_,position)=>({handle:randomUUID(),position,page:0,name:'Card',rarity:'Common'}));value.previews=value.items.map(item=>({handle:item.handle,mediaType:'image/png',bytes}));invalid(value);
});
