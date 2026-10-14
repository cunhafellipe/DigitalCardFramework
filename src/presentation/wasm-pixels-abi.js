import {ensure,clamp} from './data.js';

export const WASM_PIXEL_ABI = 'digital-card.wasm-pixels@1';
const signature = [0x7f,0x7f,0x7c,0x7c,0x7c,0x7c,0x7f,0x7f,0x7f];

/** A deliberately small numeric WASM profile; executable bytes come from the host registry. */
export function inspectPixelModule(bytes,{maxBytes=262144,maxMemoryPages=256}={}) {
  ensure(bytes instanceof Uint8Array && bytes.length >= 8 && bytes.length <= maxBytes,'WASM_ABI','Invalid module size');
  ensure(bytes.slice(0,8).every((n,i)=>n === [0,97,115,109,1,0,0,0][i]),'WASM_ABI','Invalid WASM header');
  let cursor=8,limit=bytes.length;
  const byte=()=>{ensure(cursor < limit,'WASM_ABI','Truncated WASM section');return bytes[cursor++];};
  const uint=()=>{let value=0;for(let i=0;i<5;i++){const b=byte();ensure(i<4 || b<16,'WASM_ABI','Invalid WASM integer');value+=(b&127)*2**(i*7);if(!(b&128))return value;}ensure(false,'WASM_ABI','Invalid WASM integer');};
  const name=()=>{const length=uint();ensure(cursor+length<=limit,'WASM_ABI','Truncated WASM name');const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(cursor,cursor+length));cursor+=length;return value;};
  const types=[],functions=[],seen=new Set();let memory,entry;
  while(cursor < bytes.length) {
    limit=bytes.length;const section=byte(),length=uint(),end=cursor+length;
    ensure(end<=bytes.length,'WASM_ABI','Truncated WASM section');limit=end;
    if(section!==0){ensure(!seen.has(section),'WASM_ABI','Duplicate WASM section');seen.add(section);}
    ensure([0,1,2,3,6,7,10,11,12].includes(section),'WASM_ABI','Module declares an unsupported table, memory, start or section');
    if(section===1) {
      const count=uint();ensure(count<=1024,'WASM_ABI','Too many function types');
      for(let i=0;i<count;i++) {
        ensure(byte()===0x60,'WASM_ABI','Only numeric functions are supported');const args=[],results=[],n=uint();ensure(n<=32,'WASM_ABI','Too many function arguments');
        for(let j=0;j<n;j++){const type=byte();ensure([0x7f,0x7e,0x7d,0x7c].includes(type),'WASM_ABI','Only numeric values are supported');args.push(type);}
        const r=uint();ensure(r<=1,'WASM_ABI','Unsupported function result');for(let j=0;j<r;j++){const type=byte();ensure([0x7f,0x7e,0x7d,0x7c].includes(type),'WASM_ABI','Only numeric values are supported');results.push(type);}types.push({args,results});
      }
    } else if(section===2) {
      ensure(uint()===1 && name()==='env' && name()==='memory' && byte()===2,'WASM_ABI','Only env.memory may be imported');
      ensure(byte()===1,'WASM_ABI','Memory must have a maximum and be unshared 32-bit memory');
      const initial=uint(),maximum=uint();ensure(initial>=1 && initial<=maximum && maximum<=maxMemoryPages,'WASM_ABI','Memory exceeds host limits');memory={initial,maximum};
    } else if(section===3) {
      const count=uint();ensure(count<=1024,'WASM_ABI','Too many functions');for(let i=0;i<count;i++)functions.push(uint());
    } else if(section===7) {
      ensure(uint()===1 && name()==='render' && byte()===0,'WASM_ABI','Only render may be exported');entry=uint();
    } else cursor=end;
    ensure(cursor===end,'WASM_ABI','Unexpected WASM section bytes');cursor=end;
  }
  const type=types[functions[entry]];
  ensure(memory && type && JSON.stringify(type.args)===JSON.stringify(signature) && JSON.stringify(type.results)==='[127]','WASM_ABI','Incorrect pixel render signature');
  return {abi:WASM_PIXEL_ABI,memory};
}

export function pixelFrame(frame,clock,params=[]) {
  ensure(frame && typeof frame.staticMotion==='boolean' && Number.isFinite(frame.activeTimeSeconds) && frame.activeTimeSeconds>=0 && frame.activeTimeSeconds<=1e9,'WASM_FRAME','Invalid frame time');
  const inputs=frame.inputs??{},values=[inputs.angle??0.5,inputs['tilt.x']??0,inputs['tilt.y']??0];
  ensure(values.every(Number.isFinite),'WASM_FRAME','Invalid frame inputs');
  ensure(Array.isArray(params) && params.length<=8 && params.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6),'WASM_FRAME','Invalid pixel parameters');
  return {angle:frame.staticMotion?0.5:clamp(values[0]),tiltX:frame.staticMotion?0:clamp(values[1],-1,1),tiltY:frame.staticMotion?0:clamp(values[2],-1,1),time:clock&&!frame.staticMotion?frame.activeTimeSeconds:0,staticMotion:frame.staticMotion,params:[...params]};
}
