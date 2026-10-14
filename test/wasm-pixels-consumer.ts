import {wasmPixelAdapter, type AdapterFrame, type PixelAdapterData} from '@digital-card/framework/presentation/wasm-pixels';

const adapter = wasmPixelAdapter({programs:[{id:'example.gradient',version:'1.0.0',url:'/effects/gradient.wasm',sha256:'a'.repeat(64)}]});
const frame: AdapterFrame = {inputs:{angle:0.75,'tilt.x':0.1},activeTimeSeconds:1,staticMotion:false};
const data: PixelAdapterData = {program:'example.gradient',version:'1.0.0',clock:true,params:[0.25]};
async function capture(signal: AbortSignal) {
  const instance = await adapter.create({width:512,height:768,signal,invalidate(){},initialFrame:frame},data);
  const lease = await instance.settle(frame,{signal});
  const canvas: HTMLCanvasElement = lease.canvas;
  canvas.getContext('2d');
  lease.dispose();
  instance.dispose();
}
void capture;
adapter.setEnabled('example.gradient','1.0.0',false);
// @ts-expect-error Program parameters must be numeric.
const invalid: PixelAdapterData = {program:'example.gradient',version:'1.0.0',params:['private']};
void invalid;
adapter.dispose();
