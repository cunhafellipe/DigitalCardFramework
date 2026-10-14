import {inspectPixelModule} from './wasm-pixels-abi.js';

let memory,render,width,height,initialized=false;
self.onmessage=async({data})=>{
  try {
    if(!data || !Number.isSafeInteger(data.id) || data.id<1) throw Error();
    if(data.kind==='init') {
      if(initialized) throw Error();initialized=true;
      const info=inspectPixelModule(new Uint8Array(data.bytes),data.limits);
      width=data.width;height=data.height;
      if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>data.limits.maxPixels)throw Error();
      memory=new WebAssembly.Memory(info.memory);
      const instance=await WebAssembly.instantiate(await WebAssembly.compile(data.bytes),{env:{memory}});
      render=instance.exports.render;
    } else if(data.kind!=='frame' || !render)throw Error();
    const frame=data.frame;
    if(!frame || ![frame.angle,frame.tiltX,frame.tiltY,frame.time].every(Number.isFinite)||typeof frame.staticMotion!=='boolean'||!Array.isArray(frame.params)||frame.params.length>8||!frame.params.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6))throw Error();
    const params=new DataView(memory.buffer);for(let i=0;i<frame.params.length;i++)params.setFloat64(i*8,frame.params[i],true);
    const pointer=render(width,height,frame.angle,frame.tiltX,frame.tiltY,frame.time,frame.staticMotion?1:0,0,frame.params.length),length=width*height*4;
    if(!Number.isInteger(pointer)||pointer<64||pointer+length>memory.buffer.byteLength)throw Error();
    const pixels=memory.buffer.slice(pointer,pointer+length);
    self.postMessage({id:data.id,ok:true,pixels},[pixels]);
  } catch {self.postMessage({id:data?.id,ok:false});self.close();}
};
