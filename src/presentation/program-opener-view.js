import {mountProgram} from './program.js';
import {mountOpener,renderCard} from '../ui.js';
import {createLocalization} from '../localization.js';
import {ensure} from './data.js';
import {openerDisplayProfile,openerDisplayFields,openerDisplayLimits,validateOpenerDisplay} from './opener-display.js';
import {loadProgramPreviews} from './program-previews.js';

/** A reveal presentation only. The frame has no Open, purchase or retry command. */
export function createProgramOpenerView({registry,programId,displayFields=[],viewportHeight=640,maxActivePrograms=1,handshakeTimeout=5000,maxMessagesPerSecond=30,onDiagnostic=()=>{}}={}){
  ensure(registry&&typeof registry.get==='function'&&typeof programId==='string'&&/^[a-z][a-z0-9.-]{1,99}$/.test(programId)&&Array.isArray(displayFields)&&displayFields.every(field=>openerDisplayFields.includes(field))&&new Set(displayFields).size===displayFields.length&&typeof onDiagnostic==='function','OPENER_DISPLAY','Invalid opener program');
  ensure(Number.isInteger(viewportHeight)&&viewportHeight>=200&&viewportHeight<=4096&&Number.isInteger(maxActivePrograms)&&maxActivePrograms>=1&&maxActivePrograms<=32&&Number.isInteger(handshakeTimeout)&&handshakeTimeout>=1&&handshakeTimeout<=60000&&Number.isInteger(maxMessagesPerSecond)&&maxMessagesPerSecond>=1&&maxMessagesPerSecond<=1000,'OPENER_DISPLAY','Invalid opener limits');
  displayFields=[...displayFields];const instances=new Set();let enabled=true,disposed=false,active=0;
  if(!customElements.get('dc-program-opener'))customElements.define('dc-program-opener',class extends HTMLElement{connectedCallback(){this._openerConnect?.();}disconnectedCallback(){this._openerDisconnect?.();}});
  const notify=code=>{try{onDiagnostic({code,programId});}catch{}};
  const wake=()=>queueMicrotask(()=>{if(!disposed)for(const instance of instances)instance.start();});
  const view=(initial,controller,context={})=>{
    ensure(!disposed,'OPENER_DISPLAY','Opener view is disposed');
    const localization=context.localization??createLocalization(),t=localization.text,node=document.createElement('dc-program-opener'),art=document.createElement('div'),fallback=document.createElement('div');
    node.className='dc-program-opener';node.setAttribute('role','group');node.setAttribute('aria-label',t('opener.title'));node.setAttribute('lang',localization.locale);node.setAttribute('dir',localization.dir);Object.assign(node.style,{display:'block',position:'relative',height:viewportHeight+'px',width:'100%',overflow:'auto'});Object.assign(art.style,{position:'absolute',inset:'0',pointerEvents:'none'});art.hidden=true;node.append(fallback,art);
    let state=initial,bridge,observer,fallbackCleanup,fallbackListener,previewAbort,snapshot,receiptId=null,handles=[],revealedCopies=new Map(),terminal=false,failed=false,visible=typeof IntersectionObserver==='undefined',generation=0;
    const fallbackController={getState:()=>state,subscribe(listener){fallbackListener=listener;listener(state);return()=>{if(fallbackListener===listener)fallbackListener=undefined;};},reveal:()=>controller.reveal(),skip:()=>controller.skip(),replay:()=>controller.replay()};
    const ensureFallback=()=>{if(!fallbackCleanup)fallbackCleanup=mountOpener(fallback,{controller:fallbackController,cardRenderer:context.cardRenderer??renderCard,onSelect:context.onSelect,packArtwork:context.packArtwork,localization});};
    const cleanFallback=()=>{try{fallbackCleanup?.();}catch{}fallbackCleanup=undefined;fallbackListener=undefined;fallback.replaceChildren();};
    const stop=()=>{generation++;previewAbort?.abort();previewAbort=undefined;snapshot=undefined;revealedCopies.clear();if(bridge){bridge.dispose();bridge=undefined;active--;wake();}art.replaceChildren();art.hidden=true;art.style.pointerEvents='none';fallback.hidden=false;fallback.removeAttribute('aria-hidden');};
    function project(){
      previewAbort?.abort();previewAbort=new AbortController();const abort=previewAbort;
      const receipt=state.receipt,hasReceipt=!!receipt,total=receipt?.cards.length??0,revealed=hasReceipt?state.revealed:0;ensure(total<=1000,'OPENER_DISPLAY','Receipt exceeds display limit');
      if((receipt?.id??null)!==receiptId){receiptId=receipt?.id??null;handles=Array.from({length:total},()=>crypto.randomUUID());}revealedCopies=new Map();
      const items=Array.from({length:total},(_,position)=>{const output={position,label:t('opener.card',{number:position+1})};if(position<revealed){const copy=receipt.cards[position],handle=handles[position];output.handle=handle;revealedCopies.set(handle,copy);if(displayFields.includes('cardName'))output.name=copy.definition.name;if(displayFields.includes('rarity'))output.rarity=copy.rarityId;if(displayFields.includes('isNew'))output.isNew=!!copy.isNew;}return output;});
      snapshot=validateOpenerDisplay({profile:openerDisplayProfile,snapshotId:crypto.randomUUID(),fields:displayFields,phase:state.phase,revealed,total,locale:localization.locale,dir:localization.dir,labels:{title:t(state.phase==='complete'?'opener.complete':'opener.title'),status:t(state.phase==='idle'?'opener.idle':state.phase==='loading'?'opener.loading':state.phase==='error'?'opener.portableError':'opener.title'),progress:hasReceipt?t('opener.progress',{revealed,total}):'',reveal:t('opener.next'),skip:t('opener.all'),replay:t('opener.replay'),inspect:t('inspector.label'),new:t('opener.new'),duplicate:t('opener.duplicate')},items,previews:[]});
      const current=snapshot,revision=generation;if(displayFields.includes('preview')&&revealed)queueMicrotask(async()=>{
        const previews=await loadProgramPreviews({items:current.items.slice(0,revealed),referenceFor:item=>{const copy=revealedCopies.get(item.handle);return copy?.variant?.presentation??copy?.definition.presentation;},signal:abort.signal,isCurrent:()=>!terminal&&!disposed&&enabled&&snapshot===current&&generation===revision&&node.isConnected,limits:openerDisplayLimits});
        if(!abort.signal.aborted&&snapshot===current&&generation===revision&&bridge&&!terminal&&!disposed&&enabled&&node.isConnected)try{bridge.setOpenerDisplay({...current,previews});}catch{failed=true;stop();notify('PROGRAM_CONTENT');}
      });return current;
    }
    function dispatch(event){
      if(terminal||disposed||!enabled||!node.isConnected||event.snapshotId!==snapshot?.snapshotId)return;const live=controller.getState();if(live.phase!==state.phase||live.revealed!==state.revealed||(live.receipt?.id??null)!==receiptId)return;
      if(event.intent==='opener-inspect'){const copy=revealedCopies.get(event.handle);if(copy)try{Promise.resolve(context.onSelect?.(copy)).catch(()=>notify('PROGRAM_INSPECTION'));}catch{notify('PROGRAM_INSPECTION');}}
      else if(live.receipt){if(event.intent==='opener-reveal'&&live.revealed<live.receipt.cards.length)controller.reveal();else if(event.intent==='opener-skip'&&live.revealed<live.receipt.cards.length)controller.skip();else if(event.intent==='opener-replay')controller.replay();}
    }
    function start(){
      if(terminal||disposed||!enabled||!node.isConnected||!visible||document.hidden||bridge||failed)return;ensureFallback();if(active>=maxActivePrograms){notify('PROGRAM_CAPACITY');return;}
      const revision=++generation;active++;art.hidden=false;
      try{const entry=registry.get(programId);ensure(entry?.approved===true&&entry.openerDisplay?.profile===openerDisplayProfile&&Array.isArray(entry.openerDisplay.fields)&&displayFields.every(field=>entry.openerDisplay.fields.includes(field)),'OPENER_DISPLAY','Opener display is not granted');const mounted=mountProgram(art,{programId,registry,openerDisplay:project(),onOpenerIntent:dispatch,handshakeTimeout,maxMessagesPerSecond,onReady(){if(revision===generation&&!terminal&&!disposed&&enabled){art.style.pointerEvents='auto';fallback.hidden=true;fallback.setAttribute('aria-hidden','true');}},onError({code}){if(revision!==generation||terminal||disposed)return;failed=true;stop();notify(code);}});if(revision!==generation||terminal||disposed){mounted.dispose();active--;}else bridge=mounted;}
      catch{active--;failed=true;previewAbort?.abort();snapshot=undefined;revealedCopies.clear();art.replaceChildren();art.hidden=true;art.style.pointerEvents='none';fallback.hidden=false;notify('PROGRAM_UNAVAILABLE');}
    }
    const instance={start,stop,reset(){failed=false;},dispose(){if(terminal)return;terminal=true;observer?.disconnect();observer=undefined;stop();cleanFallback();instances.delete(instance);},update(next){if(terminal||disposed)return;state=next;if(!node.isConnected)return;ensureFallback();try{fallbackListener?.(state);}catch{cleanFallback();fallback.textContent=t('opener.portableError');}if(bridge)try{bridge.setOpenerDisplay(project());}catch{failed=true;stop();notify('PROGRAM_CONTENT');}}};
    node._openerConnect=()=>{if(terminal||disposed)return;instances.add(instance);ensureFallback();try{fallbackListener?.(state);}catch{cleanFallback();fallback.textContent=t('opener.portableError');}if(typeof IntersectionObserver!=='undefined'&&!observer){observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)start();else stop();},{rootMargin:'100px'});observer.observe(node);}start();};
    node._openerDisconnect=()=>{observer?.disconnect();observer=undefined;visible=typeof IntersectionObserver==='undefined';instances.delete(instance);stop();cleanFallback();};
    instances.add(instance);try{ensureFallback();}catch(error){instance.dispose();throw error;}return {node,update:instance.update,dispose:instance.dispose};
  };
  const visibility=()=>{for(const instance of instances)document.hidden?instance.stop():instance.start();};document.addEventListener('visibilitychange',visibility);
  view.setEnabled=value=>{ensure(typeof value==='boolean','OPENER_DISPLAY','Invalid enabled state');if(disposed)return;enabled=value;for(const instance of instances){instance.stop();if(enabled){instance.reset();instance.start();}}};
  view.dispose=()=>{if(disposed)return;disposed=true;document.removeEventListener('visibilitychange',visibility);for(const instance of [...instances])instance.dispose();};return view;
}
