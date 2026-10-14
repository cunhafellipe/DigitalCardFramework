import {ensure} from './data.js';
import {inspectPixelModule,pixelFrame} from './wasm-pixels-abi.js';

const abortError=()=>new DOMException('Pixel adapter disposed','AbortError');
const defaultFrame={inputs:{angle:0.5},activeTimeSeconds:0,staticMotion:false};
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const surface=(width,height)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;};
const paint=(canvas,pixels)=>canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),canvas.width,canvas.height),0,0);
const release=canvas=>{canvas.width=canvas.height=0;};
async function moduleBytes(entry,maxBytes,signal) {
  const response=await fetch(entry.url,{signal,credentials:'omit',redirect:'error'});
  ensure(response.ok && response.body,'WASM_LOAD','Unable to load pixel module');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;ensure(size<=maxBytes,'WASM_LOAD','Pixel module exceeds host byte limit');chunks.push(value);}} finally {await reader.cancel();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  ensure(hash===entry.sha256,'WASM_REVIEW','Pixel module differs from the approved digest');return bytes;
}

/** Host-reviewed CPU pixel programs. Browser engine and Worker overhead are outside memory accounting. */
export function wasmPixelAdapter({programs,maxWorkers=2,maxPixels=1048576,memoryPages=256,deadlineMs=1000,maxModuleBytes=262144}={}) {
  ensure(Array.isArray(programs)&&programs.length<=128,'WASM_REGISTRY','A bounded host program registry is required');
  for(const [value,min,max]of [[maxWorkers,1,16],[maxPixels,1,4194304],[memoryPages,1,1024],[deadlineMs,10,10000],[maxModuleBytes,8,1048576]])ensure(integer(value,min,max),'WASM_LIMIT','Invalid host compute limit');
  const registry=new Map(),instances=new Set();let closed=false,reserved=0;
  for(const input of programs) {
    ensure(input&&/^[a-z][\w.-]{0,99}$/.test(input.id)&&/^\d+\.\d+\.\d+$/.test(input.version)&&/^[a-f0-9]{64}$/.test(input.sha256)&&typeof input.url==='string','WASM_REGISTRY','Invalid program registry entry');
    const url=new URL(input.url,globalThis.location?.href??'https://registry.invalid/');ensure(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password,'WASM_REGISTRY','Invalid program URL');
    const key=input.id+'@'+input.version;ensure(!registry.has(key),'WASM_REGISTRY','Duplicate program registry entry');registry.set(key,{...input,url:url.href,enabled:true});
  }
  const limits={maxBytes:maxModuleBytes,maxMemoryPages:memoryPages,maxPixels};
  return {
    id:'dc.wasm-pixels',version:'0.1.0',apiVersion:'0.1.0',trust:'host-installed',capabilities:['dc.wasm-pixels@0.1'],provides:['dc.wasm-pixels'],fallback:'poster',
    estimate:({width,height})=>memoryPages*65536+maxModuleBytes+width*height*20,
    setEnabled(id,version,enabled) {
      const entry=registry.get(id+'@'+version);ensure(entry&&typeof enabled==='boolean','WASM_REGISTRY','Unknown program or invalid enabled state');entry.enabled=enabled;
      if(!enabled)for(const instance of [...instances])if(instance.key===id+'@'+version)instance.fail(new Error('Pixel program disabled by host'));
    },
    dispose(){if(closed)return;closed=true;for(const instance of [...instances])instance.fail(new Error('Pixel adapter closed by host'));},
    async create(context,data) {
      ensure(!closed,'WASM_CLOSED','Pixel adapter is closed');
      context.signal.throwIfAborted();
      ensure(data&&Object.keys(data).every(key=>['program','version','clock','params'].includes(key))&&typeof data.program==='string'&&typeof data.version==='string'&&(data.clock===undefined||typeof data.clock==='boolean'),'WASM_DATA','Invalid pixel adapter data');
      const key=data.program+'@'+data.version,entry=registry.get(key);
      ensure(entry?.enabled,'WASM_REVIEW','Pixel program is not enabled by host');
      ensure(integer(context.width,1,16384)&&integer(context.height,1,16384)&&context.width*context.height<=maxPixels,'WASM_LIMIT','Pixel dimensions exceed host limit');
      ensure(reserved<maxWorkers,'WASM_LIMIT','Pixel worker capacity exceeded');
      const params=[...(data.params??[])],initial=pixelFrame(context.initialFrame??defaultFrame,!!data.clock,params),controller=new AbortController(),canvas=surface(context.width,context.height),leases=new Set();
      let worker,active,latest,sequence=0,failed,disposed=false,released=false,currentKey=null,loadTimer;const captures=[];
      reserved++;
      const stop=()=>{clearTimeout(loadTimer);controller.abort();worker?.terminate();if(active){clearTimeout(active.timer);active.reject(abortError());active=null;}latest=null;for(const job of captures.splice(0))job.reject(abortError());for(const lease of [...leases])lease.dispose();if(!released){released=true;reserved--;instances.delete(owner);}context.signal.removeEventListener('abort',dispose);};
      const fail=error=>{if(failed||disposed)return;failed=error;stop();context.invalidate();};
      const dispose=()=>{if(disposed)return;disposed=true;stop();for(const lease of leases)lease.dispose();release(canvas);};
      const owner={key,fail};instances.add(owner);
      context.signal.addEventListener('abort',dispose,{once:true});
      function check(){if(failed)throw failed;if(disposed||context.signal.aborted)throw abortError();}
      function pump() {
        if(active||disposed||failed||!worker)return;
        const job=captures.shift()??latest;if(!job)return;if(job===latest)latest=null;
        const id=++sequence,timer=setTimeout(()=>fail(new Error('Pixel compute deadline exceeded')),deadlineMs);
        active={...job,id,timer};worker.postMessage({kind:'frame',id,frame:job.frame});
      }
      function capture(frame) {
        check();ensure(leases.size+captures.length+(active?.capture?1:0)<2,'WASM_LIMIT','Pixel capture capacity exceeded');
        return new Promise((resolve,reject)=>{captures.push({frame,capture:true,resolve,reject});pump();});
      }
      try {
        loadTimer=setTimeout(()=>fail(new Error('Pixel initialization deadline exceeded')),deadlineMs);
        const bytes=await moduleBytes(entry,maxModuleBytes,controller.signal);check();ensure(entry.enabled&&!closed,'WASM_REVIEW','Pixel program is not enabled by host');inspectPixelModule(bytes,limits);
        worker=new Worker(new URL('./wasm-pixels-worker.js',import.meta.url),{type:'module'});
        worker.onerror=()=>fail(new Error('Pixel worker failed'));
        const pixels=await new Promise((resolve,reject)=>{
          active={id:++sequence,frame:initial,resolve,reject,timer:loadTimer};
          worker.onmessage=({data:message})=>{
            if(disposed||failed)return;
            if(!active||message?.id!==active.id||message.ok!==true||!(message.pixels instanceof ArrayBuffer)||message.pixels.byteLength!==context.width*context.height*4){fail(new Error('Pixel worker returned invalid output'));return;}
            const job=active;clearTimeout(job.timer);active=null;
            if(!job.capture){paint(canvas,message.pixels);currentKey=JSON.stringify(job.frame);context.invalidate();}
            job.resolve(message.pixels);pump();
          };
          worker.postMessage({kind:'init',id:active.id,bytes:bytes.buffer,limits,width:context.width,height:context.height,frame:initial},[bytes.buffer]);
        });
        check();paint(canvas,pixels);
        return {
          canvas,
          update(frame) {
            check();const next=pixelFrame(frame,!!data.clock,params),nextKey=JSON.stringify(next);
            const destinationKey=active&&!active.capture?JSON.stringify(active.frame):currentKey;
            latest=nextKey===destinationKey?null:{frame:next,resolve:()=>{},reject:()=>{}};pump();
            return {needsTime:!!data.clock&&!frame.staticMotion};
          },
          render(){check();},
          async settle(frame,{signal}={}) {
            check();signal?.throwIfAborted();
            const abort=()=>fail(abortError());signal?.addEventListener('abort',abort,{once:true});
            try {
              const pixels=await capture(pixelFrame(frame,!!data.clock,params));check();signal?.throwIfAborted();
              const pinned=surface(context.width,context.height);paint(pinned,pixels);
              const lease={canvas:pinned,dispose(){if(!leases.delete(lease))return;release(pinned);}};leases.add(lease);return lease;
            } finally {signal?.removeEventListener('abort',abort);}
          },
          dispose,
        };
      } catch(error) {dispose();throw failed??error;}
    },
  };
}
