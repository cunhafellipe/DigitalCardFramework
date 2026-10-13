import {mountProgram} from './program.js';
import {ensure} from './data.js';
import {renderCard} from '../ui.js';

/** Explicit host selection of approved structural programs; catalog data cannot install code. */
export function createProgramCardRenderer({registry,cards={},variants={},fallbackRenderer=renderCard,maxActivePrograms=4,handshakeTimeout=5000,maxMessagesPerSecond=30,onDiagnostic=()=>{}}={}){
  ensure(registry&&typeof registry.get==='function'&&typeof fallbackRenderer==='function'&&typeof onDiagnostic==='function','PROGRAM','Invalid program renderer');
  ensure(Number.isInteger(maxActivePrograms)&&maxActivePrograms>=1&&maxActivePrograms<=32&&Number.isInteger(handshakeTimeout)&&handshakeTimeout>=1&&handshakeTimeout<=60000&&Number.isInteger(maxMessagesPerSecond)&&maxMessagesPerSecond>=1&&maxMessagesPerSecond<=1000,'PROGRAM','Invalid program limits');
  const mappings=value=>{ensure(value&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Object.getOwnPropertyNames(value).length<=256&&Object.getOwnPropertySymbols(value).length===0,'PROGRAM','Invalid program selections');const out=Object.create(null);for(const [key,descriptor]of Object.entries(Object.getOwnPropertyDescriptors(value))){ensure(Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='string'&&/^[a-z][a-z0-9.-]{1,99}$/.test(descriptor.value),'PROGRAM','Invalid program selection');out[key]=descriptor.value;}return Object.freeze(out);};
  cards=mappings(cards);variants=mappings(variants);
  const nodes=new Set();let active=0,enabled=true,disposed=false,wakeQueued=false;
  const wake=()=>{if(wakeQueued||disposed)return;wakeQueued=true;queueMicrotask(()=>{wakeQueued=false;if(!disposed)for(const node of nodes)node.start();});};
  if(!customElements.get('dc-program-card'))customElements.define('dc-program-card',class extends HTMLElement{connectedCallback(){this._connect?.();}disconnectedCallback(){this._disconnect?.();}});
  const render=(copy,options={})=>{
    if(disposed)return fallbackRenderer(copy,options);
    const variantId=copy.variantId??copy.variant?.id,cardId=copy.cardId??copy.definition?.id;
    const programId=Object.hasOwn(variants,variantId)?variants[variantId]:cards[cardId];
    if(!programId)return fallbackRenderer(copy,options);
    const node=document.createElement('dc-program-card'),art=document.createElement('div'),fallback=fallbackRenderer(copy,{...options,onSelect:undefined,interactive:false}),caption=document.createElement('span');
    node.className='dc-card';node.tabIndex=0;node.setAttribute('role',options.onSelect?'button':'img');node.setAttribute('aria-label',copy.definition.name);
    Object.assign(node.style,{display:'block',position:'relative',aspectRatio:'2 / 3',overflow:'hidden'});
    Object.assign(art.style,{position:'absolute',inset:'0'});caption.className='dc-card-title';caption.textContent=copy.definition.name;caption.style.pointerEvents='none';caption.style.zIndex='2';
    fallback.tabIndex=-1;fallback.setAttribute('aria-hidden','true');node.append(fallback,art,caption);
    let bridge,observer,visible=typeof IntersectionObserver==='undefined',terminal=false,failed=false,generation=0,inputs={};
    const notify=code=>onDiagnostic({code,programId});
    const selected=()=>{if(!terminal&&!disposed&&node.isConnected)options.onSelect?.(copy);};
    const stop=()=>{generation++;if(bridge){bridge.dispose();bridge=null;active--;wake();}art.replaceChildren();fallback.hidden=false;fallback.style.visibility='';};
    const start=()=>{
      if(terminal||disposed||!enabled||!node.isConnected||!visible||document.hidden||bridge||failed)return;
      if(active>=maxActivePrograms){notify('PROGRAM_CAPACITY');return;}
      const revision=++generation;active++;
      try{
        const mounted=mountProgram(art,{programId,registry,inputs,handshakeTimeout,maxMessagesPerSecond,onReady(){if(revision===generation&&!terminal&&!disposed&&enabled){fallback.hidden=true;fallback.style.visibility='hidden';}},onError({code}){if(revision!==generation||terminal||disposed)return;failed=true;stop();notify(code);},onIntent({intent}){if(revision===generation&&intent==='select')selected();}});
        if(revision!==generation||terminal||disposed){mounted.dispose();active--;}else bridge=mounted;
      }catch{active--;failed=true;art.replaceChildren();fallback.hidden=false;notify('PROGRAM_UNAVAILABLE');}
    };
    const connect=()=>{
      if(terminal||disposed)return;
      nodes.add(state);
      if(typeof IntersectionObserver!=='undefined'&&!observer){observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)start();else stop();},{rootMargin:'100px'});observer.observe(node);}
      start();
    };
    const disconnect=()=>{observer?.disconnect();observer=null;visible=typeof IntersectionObserver==='undefined';nodes.delete(state);stop();};
    const state={start,stop,connect,reset(){failed=false;},dispose(){if(terminal)return;terminal=true;disconnect();fallback.dispose?.();nodes.delete(state);}};
    node._connect=connect;node._disconnect=disconnect;node.dispose=state.dispose;
    node.setPresentationInputs=value=>{if(terminal||disposed)return;inputs={...inputs,...value};bridge?.setInputs(inputs);fallback.setPresentationInputs?.(value);};
    node.setPresentationSide=side=>{if(terminal||disposed)return;ensure(['front','back'].includes(side),'SIDE','Unknown face');inputs={...inputs,flipProgress:side==='back'?1:0};bridge?.setInputs(inputs);return fallback.setPresentationSide?.(side);};
    node.addEventListener('click',selected);node.addEventListener('keydown',event=>{if(event.target===node&&['Enter',' '].includes(event.key)){event.preventDefault();selected();}});
    return node;
  };
  const visibility=()=>{for(const node of nodes)document.hidden?node.stop():node.start();};document.addEventListener('visibilitychange',visibility);
  render.setEnabled=value=>{ensure(typeof value==='boolean','PROGRAM','Invalid enabled state');if(disposed)return;enabled=value;for(const node of nodes){node.stop();if(enabled){node.reset();node.start();}}};
  render.dispose=()=>{if(disposed)return;disposed=true;document.removeEventListener('visibilitychange',visibility);for(const node of [...nodes])node.dispose();};
  return render;
}
