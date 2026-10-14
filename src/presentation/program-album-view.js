import {createProgramViewRenderer} from './program-view.js';
import {ensure} from './data.js';
import {renderAlbum} from '../ui.js';
import {albumDisplayProfile,albumDisplayFields,albumDisplayLimits,validateAlbumDisplay} from './album-display.js';
import {loadProgramPreviews} from './program-previews.js';

/** Explicit display grants only; complete album/copy records stay in the parent. */
export function createProgramAlbumRenderer({registry,programId,displayFields=[],fallbackRenderer=renderAlbum,viewportHeight=640,maxActivePrograms=2,...limits}={}){
  ensure(typeof programId==='string'&&/^[a-z][a-z0-9.-]{1,99}$/.test(programId)&&Array.isArray(displayFields)&&displayFields.every(field=>albumDisplayFields.includes(field))&&new Set(displayFields).size===displayFields.length,'ALBUM_DISPLAY','Invalid album display grants');
  ensure(Number.isInteger(viewportHeight)&&viewportHeight>=200&&viewportHeight<=4096,'ALBUM_DISPLAY','Invalid album viewport');
  displayFields=[...displayFields];const sessions=new WeakMap();
  const grant=()=>{const entry=registry?.get(programId);ensure(entry?.approved===true&&entry.albumDisplay?.profile===albumDisplayProfile&&Array.isArray(entry.albumDisplay.fields)&&displayFields.every(field=>entry.albumDisplay.fields.includes(field)),'ALBUM_DISPLAY','Album display is not granted');};
  const native=(model,options)=>{const layouts={...options.layouts};if(layouts[model.layout?.id]===render)delete layouts[model.layout.id];return fallbackRenderer(model,{...options,layouts});};
  const surfaces=createProgramViewRenderer({registry,programFor:()=>programId,fallbackRenderer:native,fallbackOptionsFor:(model,options)=>options,selectWholeModel:false,tagName:'dc-program-album',classNameFor:()=> 'dc-program-album',nameFor:model=>model.name??'Album',maxActivePrograms,...limits,
    albumDisplayFor(model,options,node){
      grant();ensure(Array.isArray(model.cards)&&model.cards.length<=1000,'ALBUM_DISPLAY','Invalid album contents');
      const controller=new AbortController(),session={controller,handles:new Map(),snapshot:null};sessions.set(node,session);node._programSessionCleanup=()=>{controller.abort();sessions.delete(node);};
      const artworkPages=model.layout?.artwork?.pages??[],known=new Map(artworkPages.map((page,index)=>[page.id,index])),size=Number.isInteger(model.layout?.pageSize)&&model.layout.pageSize>=1&&model.layout.pageSize<=100?model.layout.pageSize:12,book=model.layout?.artwork!==undefined||model.layout?.pageSize!==undefined;
      const items=model.cards.map((item,position)=>{const handle=crypto.randomUUID(),page=book?(known.get(item.placement?.data?.pageId)??Math.floor(position/size)):0,output={handle,position,page};session.handles.set(handle,item.copy);
        if(displayFields.includes('cardName'))output.name=item.copy.definition.name;if(displayFields.includes('rarity'))output.rarity=item.copy.rarityId;return output;});
      const pageCount=Math.max(1,book?artworkPages.length:0,...items.map(item=>item.page+1));
      const snapshot={profile:albumDisplayProfile,snapshotId:crypto.randomUUID(),fields:[...displayFields],pages:Array.from({length:pageCount},(_,index)=>({index,...(displayFields.includes('pageName')&&artworkPages[index]?.title!==undefined?{name:artworkPages[index].title}:{})})),items,previews:[]};
      if(displayFields.includes('albumName')&&model.name!==undefined)snapshot.name=model.name;
      session.snapshot=validateAlbumDisplay(snapshot);
      if(displayFields.includes('preview'))queueMicrotask(async()=>{
        const previews=await loadProgramPreviews({items:session.snapshot.items,referenceFor:item=>{const copy=session.handles.get(item.handle);return copy.variant?.presentation??copy.definition.presentation;},signal:controller.signal,isCurrent:()=>sessions.get(node)===session,limits:albumDisplayLimits});
        if(!controller.signal.aborted&&sessions.get(node)===session&&node.isConnected&&!node._programTerminal())try{node.setAlbumDisplay({...session.snapshot,previews});}catch{}
      });
      return session.snapshot;
    },onAlbumSelect(event,model,options,node){const session=sessions.get(node);if(session&&event.snapshotId===session.snapshot.snapshotId&&session.handles.has(event.handle))options.onSelect?.(session.handles.get(event.handle));}
  });
  const render=(model,options={})=>{const output=surfaces(model,options),node=output.node??output;if(output.node&&output.dispose)node.dispose=()=>output.dispose();if(node.localName==='dc-program-album')Object.assign(node.style,{height:viewportHeight+'px',width:'100%',aspectRatio:'auto',minWidth:'0'});return node;};
  render.setEnabled=surfaces.setEnabled;render.dispose=surfaces.dispose;return render;
}
