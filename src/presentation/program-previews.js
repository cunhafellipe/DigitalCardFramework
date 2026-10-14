import {directoryResolver} from './resolver.js';
import {validatePresentationReference} from './integration.js';
import {rasterDimensions} from './media.js';
import {ensure} from './data.js';

/** Parent-side raster resolution. Bounded cache; one final display batch; no asset URLs are returned. */
export async function loadProgramPreviews({items,referenceFor,signal,isCurrent,limits}){
  let totalBytes=0,totalPixels=0;const previews=[],cache=new Map();
  for(const item of items){
    if(signal.aborted||!isCurrent())return [];
    if(totalBytes>=limits.totalPreviewBytes||totalPixels>=limits.totalPreviewPixels)break;
    let ref;
    try{ref=referenceFor(item);if(!ref)continue;validatePresentationReference(ref);const key=ref.digest+'\n'+ref.baseURL;
      if(!cache.has(key)){if(cache.size>=16)cache.delete(cache.keys().next().value);cache.set(key,(async()=>{const resolver=await directoryResolver(ref.baseURL,{digest:ref.digest,signal});try{
        const descriptor=resolver.manifest.assets.find(asset=>asset.id===resolver.manifest.faces.front.poster);ensure(descriptor&&['image/png','image/jpeg','image/webp'].includes(descriptor.mediaType)&&descriptor.bytes<=Math.min(limits.previewBytes,limits.totalPreviewBytes-totalBytes)&&(!Number.isFinite(descriptor.width*descriptor.height)||descriptor.width*descriptor.height<=limits.totalPreviewPixels-totalPixels),'PROGRAM_CONTENT','Preview exceeds limit');
        const asset=await resolver.asset(descriptor.id),response=await fetch(asset.url,{signal}),bytes=new Uint8Array(await response.arrayBuffer()),dimensions=rasterDimensions(bytes,descriptor.mediaType),pixels=dimensions.width*dimensions.height;ensure(pixels<=limits.previewPixels,'PROGRAM_CONTENT','Preview exceeds limit');return {mediaType:descriptor.mediaType,bytes,pixels};
      }finally{resolver.dispose();}})());}
      const preview=await cache.get(key);if(totalBytes+preview.bytes.byteLength>limits.totalPreviewBytes||totalPixels+preview.pixels>limits.totalPreviewPixels)continue;
      totalBytes+=preview.bytes.byteLength;totalPixels+=preview.pixels;previews.push({handle:item.handle,mediaType:preview.mediaType,bytes:preview.bytes});
    }catch{if(ref)cache.delete(ref.digest+'\n'+ref.baseURL);if(signal.aborted)return [];}
  }
  return signal.aborted||!isCurrent()?[]:previews;
}
