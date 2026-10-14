import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPixelModule,pixelFrame} from '../src/presentation/wasm-pixels-abi.js';
import {wasmPixelAdapter} from '../src/presentation/wasm-pixels.js';
import {numericModule,iconst} from './wasm-pixels-fixtures.mjs';

test('pixel ABI rejects extra imports, unbounded/extra memories, tables/start and incompatible render signatures',async()=>{
  assert.deepEqual(inspectPixelModule(numericModule()).memory,{initial:1,maximum:256});
  await WebAssembly.compile(numericModule());
  for(const bytes of [numericModule({maximum:257}),numericModule({signature:[0x7f]}),numericModule({importName:'other'}),numericModule({extra:[4,1,0]}),numericModule({extra:[5,1,0]}),numericModule({extra:[8,1,0]}),numericModule().subarray(0,15)])assert.throws(()=>inspectPixelModule(bytes),e=>e.code==='WASM_ABI');
  assert.throws(()=>inspectPixelModule(numericModule(),{maxBytes:8}),e=>e.code==='WASM_ABI');
  // Structurally valid output pointers are still checked against live memory by the Worker.
  await WebAssembly.compile(numericModule({body:[...iconst(-1),0x0b]}));
});
test('pixel frames freeze motion, restrict parameters and keep independent bounded inputs',()=>{
  const frame={inputs:{angle:0.9,'tilt.x':0.4,'tilt.y':-0.6},activeTimeSeconds:12,staticMotion:false};
  assert.deepEqual(pixelFrame(frame,true,[4]),{angle:0.9,tiltX:0.4,tiltY:-0.6,time:12,staticMotion:false,params:[4]});
  assert.equal(pixelFrame(frame,false).time,0);
  assert.deepEqual(pixelFrame({...frame,staticMotion:true},true),{angle:0.5,tiltX:0,tiltY:0,time:0,staticMotion:true,params:[]});
  for(const params of [Array(9).fill(1),[Infinity],[1e7],{}])assert.throws(()=>pixelFrame(frame,true,params));
  assert.throws(()=>pixelFrame({...frame,activeTimeSeconds:NaN},true));
});
test('host registry copies configuration and requires explicit limits and approved entries',()=>{
  const programs=[{id:'test.pixel',version:'1.0.0',url:'https://compute.example.test/program.wasm',sha256:'a'.repeat(64)}];
  const adapter=wasmPixelAdapter({programs});programs.length=0;
  adapter.setEnabled('test.pixel','1.0.0',false);adapter.setEnabled('test.pixel','1.0.0',true);
  assert(adapter.estimate({width:512,height:768})<32*1024*1024);adapter.dispose();adapter.dispose();
  for(const options of [{programs,maxPixels:0},{programs,memoryPages:1025},{programs:[{...programs[0],id:'broken'}]}])assert.throws(()=>wasmPixelAdapter(options));
});
