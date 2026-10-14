import {ensure} from './data.js';
import {rasterDimensions} from './media.js';

export const albumDisplayProfile='dc.album-display@1';
export const albumDisplayFields=Object.freeze(['albumName','cardName','rarity','pageName','preview']);
export const albumDisplayLimits=Object.freeze({items:1000,pages:1000,text:100,metadataBytes:2097152,previewBytes:262144,totalPreviewBytes:4194304,previewPixels:1048576,totalPreviewPixels:8388608});
const handleSchema={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'},textSchema={type:'string',maxLength:100},indexSchema={type:'integer',minimum:0,maximum:999};
// Raster bytes use native Uint8Array transport, not JSON/base64. Runtime validation
// additionally checks grants, associations, UTF-8 size and decoded pixel budgets.
export const albumDisplaySchema=Object.freeze({type:'object',additionalProperties:false,required:['profile','snapshotId','fields','pages','items','previews'],properties:{profile:{const:albumDisplayProfile},snapshotId:handleSchema,fields:{type:'array',uniqueItems:true,maxItems:5,items:{enum:albumDisplayFields}},name:textSchema,pages:{type:'array',minItems:1,maxItems:1000,items:{type:'object',additionalProperties:false,required:['index'],properties:{index:indexSchema,name:textSchema}}},items:{type:'array',maxItems:1000,items:{type:'object',additionalProperties:false,required:['handle','position','page'],properties:{handle:handleSchema,position:indexSchema,page:indexSchema,name:textSchema,rarity:textSchema}}},previews:{type:'array',maxItems:1000,items:{type:'object',additionalProperties:false,required:['handle','mediaType','bytes'],properties:{handle:handleSchema,mediaType:{enum:['image/png','image/jpeg','image/webp']},bytes:{description:'Native Uint8Array; validated separately from JSON Schema.'}}}}}});
const valid=(condition)=>ensure(condition,'ALBUM_DISPLAY','Invalid album display');
function object(value,keys,required=[]){
  valid(value&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Object.getOwnPropertySymbols(value).length===0);
  const descriptors=Object.getOwnPropertyDescriptors(value),result=Object.create(null);
  for(const [key,descriptor]of Object.entries(descriptors)){valid(keys.includes(key)&&Object.hasOwn(descriptor,'value'));result[key]=descriptor.value;}
  for(const key of required)valid(Object.hasOwn(result,key));return result;
}
function list(value,limit){
  valid(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length<=limit&&Object.getOwnPropertySymbols(value).length===0);
  const descriptors=Object.getOwnPropertyDescriptors(value);valid(Object.keys(descriptors).length===value.length+1);
  return Array.from({length:value.length},(_,index)=>{const entry=descriptors[index];valid(entry&&Object.hasOwn(entry,'value'));return entry.value;});
}
const identifier=value=>{valid(typeof value==='string'&&new RegExp(handleSchema.pattern).test(value));return value;};
const index=value=>{valid(Number.isInteger(value)&&value>=0&&value<1000);return value;};
const label=value=>{valid(typeof value==='string'&&value.length<=100&&value.isWellFormed()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));return value;};

/** Detached display-only snapshot. Never supply an album/copy record to this API. */
export function validateAlbumDisplay(value){
  const input=object(value,['profile','snapshotId','fields','name','pages','items','previews'],['profile','snapshotId','fields','pages','items','previews']);valid(input.profile===albumDisplayProfile);
  const fields=list(input.fields,5);valid(fields.every(field=>albumDisplayFields.includes(field))&&new Set(fields).size===fields.length);
  const result={profile:albumDisplayProfile,snapshotId:identifier(input.snapshotId),fields:[...fields]};
  if(Object.hasOwn(input,'name')){valid(fields.includes('albumName'));result.name=label(input.name);}
  result.pages=list(input.pages,1000).map(value=>{const page=object(value,['index','name'],['index']),output={index:index(page.index)};if(Object.hasOwn(page,'name')){valid(fields.includes('pageName'));output.name=label(page.name);}return output;});
  const pages=new Set(result.pages.map(page=>page.index));valid(result.pages.length>0&&pages.size===result.pages.length);
  result.items=list(input.items,1000).map(value=>{const item=object(value,['handle','position','page','name','rarity'],['handle','position','page']),output={handle:identifier(item.handle),position:index(item.position),page:index(item.page)};valid(pages.has(output.page));
    if(Object.hasOwn(item,'name')){valid(fields.includes('cardName'));output.name=label(item.name);}if(Object.hasOwn(item,'rarity')){valid(fields.includes('rarity'));output.rarity=label(item.rarity);}return output;});
  const handles=new Set(result.items.map(item=>item.handle));valid(handles.size===result.items.length&&new Set(result.items.map(item=>item.position)).size===result.items.length);
  let bytes=0,pixels=0;const previewHandles=new Set();
  result.previews=list(input.previews,1000).map(value=>{const preview=object(value,['handle','mediaType','bytes'],['handle','mediaType','bytes']),handle=identifier(preview.handle);valid(fields.includes('preview')&&handles.has(handle)&&!previewHandles.has(handle));previewHandles.add(handle);
    valid(['image/png','image/jpeg','image/webp'].includes(preview.mediaType)&&preview.bytes instanceof Uint8Array&&Object.getPrototypeOf(preview.bytes)===Uint8Array.prototype&&preview.bytes.byteLength<=albumDisplayLimits.previewBytes);
    const data=Uint8Array.prototype.slice.call(preview.bytes),dimensions=rasterDimensions(data,preview.mediaType),area=dimensions.width*dimensions.height;
    bytes+=data.byteLength;pixels+=area;valid(area<=albumDisplayLimits.previewPixels&&bytes<=albumDisplayLimits.totalPreviewBytes&&pixels<=albumDisplayLimits.totalPreviewPixels);
    return {handle,mediaType:preview.mediaType,bytes:data};});
  const metadata={...result,previews:result.previews.map(({handle,mediaType,bytes})=>({handle,mediaType,byteLength:bytes.byteLength}))};valid(new TextEncoder().encode(JSON.stringify(metadata)).byteLength<=albumDisplayLimits.metadataBytes);
  return result;
}
