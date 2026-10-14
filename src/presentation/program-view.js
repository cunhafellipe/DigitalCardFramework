import {mountProgram} from './program.js';
import {ensure} from './data.js';
// Shared host-only lifecycle implementation; each public adapter owns its model lookup.
export function programSelections(value){
  ensure(value&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Object.getOwnPropertyNames(value).length<=256&&Object.getOwnPropertySymbols(value).length===0,'PROGRAM','Invalid program selections');
  const out=Object.create(null);
  for(const [key,descriptor]of Object.entries(Object.getOwnPropertyDescriptors(value))){ensure(Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='string'&&/^[a-z][a-z0-9.-]{1,99}$/.test(descriptor.value),'PROGRAM','Invalid program selection');out[key]=descriptor.value;}
  return Object.freeze(out);
}
export function createProgramViewRenderer({registry,fallbackRenderer,programFor,nameFor,tagName,classNameFor,captionClassName,selectNestedButtons=true,maxActivePrograms=4,handshakeTimeout=5000,maxMessagesPerSecond=30,onDiagnostic=()=>{}}){
  ensure(registry&&typeof registry.get==='function'&&typeof fallbackRenderer==='function'&&typeof onDiagnostic==='function','PROGRAM','Invalid program renderer');
  ensure(Number.isInteger(maxActivePrograms)&&maxActivePrograms>=1&&maxActivePrograms<=32&&Number.isInteger(handshakeTimeout)&&handshakeTimeout>=1&&handshakeTimeout<=60000&&Number.isInteger(maxMessagesPerSecond)&&maxMessagesPerSecond>=1&&maxMessagesPerSecond<=1000,'PROGRAM','Invalid program limits');
  const nodes=new Set();let active=0,enabled=true,disposed=false,wakeQueued=false;
  const wake=()=>{if(wakeQueued||disposed)return;wakeQueued=true;queueMicrotask(()=>{wakeQueued=false;if(!disposed)for(const node of nodes)node.start();});};
  if(!customElements.get(tagName))customElements.define(tagName,class extends HTMLElement{connectedCallback(){this._connect?.();}disconnectedCallback(){this._disconnect?.();}});
  const render=(model,options={})=>{
    if(disposed)return fallbackRenderer(model,options);
    const programId=programFor(model);
    if(!programId)return fallbackRenderer(model,options);
    const node=document.createElement(tagName),art=document.createElement('div'),fallbackView=fallbackRenderer(model,{...options,onSelect:undefined,interactive:false}),fallback=fallbackView.node??fallbackView;
    ensure(fallback?.nodeType===1,'PROGRAM','Invalid program fallback');
    node.className=classNameFor(options);node.tabIndex=0;node.setAttribute('role',options.onSelect?'button':'img');node.setAttribute('aria-label',nameFor(model));
    Object.assign(node.style,{display:'block',position:'relative',aspectRatio:'2 / 3',overflow:'hidden'});
    Object.assign(art.style,{position:'absolute',inset:'0'});
    fallback.tabIndex=-1;fallback.setAttribute('aria-hidden','true');node.append(fallback,art);
    if(captionClassName){const caption=document.createElement('span');caption.className=captionClassName;caption.textContent=nameFor(model);caption.style.pointerEvents='none';caption.style.zIndex='2';node.append(caption);}
    if(options.localization){node.setAttribute('lang',options.localization.locale);node.setAttribute('dir',options.localization.dir);}
    let bridge,observer,visible=typeof IntersectionObserver==='undefined',terminal=false,failed=false,generation=0,inputs={};
    const notify=code=>onDiagnostic({code,programId});
    const selected=()=>{if(!terminal&&!disposed&&node.isConnected)options.onSelect?.(model);};
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
    const state={start,stop,connect,reset(){failed=false;},dispose(){if(terminal)return;terminal=true;disconnect();node._programCleanup?.();fallbackView.dispose?.();nodes.delete(state);}};
    node._programTerminal=()=>terminal||disposed;
    node._connect=connect;node._disconnect=disconnect;node.dispose=state.dispose;
    node.setPresentationInputs=value=>{if(terminal||disposed)return;inputs={...inputs,...value};bridge?.setInputs(inputs);fallbackView.setPresentationInputs?.(value);};
    node.setPresentationSide=side=>{if(terminal||disposed)return;ensure(['front','back'].includes(side),'SIDE','Unknown face');inputs={...inputs,flipProgress:side==='back'?1:0};bridge?.setInputs(inputs);return fallbackView.setPresentationSide?fallbackView.setPresentationSide(side):fallbackView.setSide?.(side);};
    node.addEventListener('click',event=>{if(selectNestedButtons||!event.target.closest?.('button'))selected();});node.addEventListener('keydown',event=>{if(event.target===node&&['Enter',' '].includes(event.key)){event.preventDefault();selected();}});
    return node;
  };
  const visibility=()=>{for(const node of nodes)document.hidden?node.stop():node.start();};document.addEventListener('visibilitychange',visibility);
  render.setEnabled=value=>{ensure(typeof value==='boolean','PROGRAM','Invalid enabled state');if(disposed)return;enabled=value;for(const node of nodes){node.stop();if(enabled){node.reset();node.start();}}};
  render.dispose=()=>{if(disposed)return;disposed=true;document.removeEventListener('visibilitychange',visibility);for(const node of [...nodes])node.dispose();};
  return render;
}
