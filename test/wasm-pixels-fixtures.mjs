import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {importPackage} from '../src/presentation/package.js';

export const uint=n=>{const out=[];do{let b=n&127;n>>>=7;out.push(b|(n?128:0));}while(n);return out;};
const name=v=>[...uint(v.length),...new TextEncoder().encode(v)];
const section=(id,v)=>[id,...uint(v.length),...v];
export const iconst=n=>{const out=[0x41];for(;;){let b=n&127;n>>=7;const done=(n===0&&!(b&64))||(n===-1&&!!(b&64));out.push(b|(done?0:128));if(done)return out;}};
export function numericModule({body=[...iconst(64),0x0b],initial=1,maximum=256,signature,importName='memory',extra=[]}={}) {
  const args=signature??[0x7f,0x7f,0x7c,0x7c,0x7c,0x7c,0x7f,0x7f,0x7f],code=[0,...body];
  return Uint8Array.from([0,97,115,109,1,0,0,0,...section(1,[1,0x60,args.length,...args,1,0x7f]),...section(2,[1,...name('env'),...name(importName),2,1,...uint(initial),...uint(maximum)]),...section(3,[1,0]),...extra,...section(7,[1,...name('render'),0,0]),...section(10,[1,...uint(code.length),...code])]);
}
export async function generatedExamples() {
  const directory=await mkdtemp(path.join(tmpdir(),'wasm-authors-')),result=[];
  try {
    const python=process.env.PYTHON??'python',go=process.env.GO??'go';
    for(const [id,executable,args]of [['python',python,['examples/plugins/python-wasm-pixels.py']],['go',go,['run','examples/plugins/go-wasm-pixels/main.go']]]) {
      const root=path.join(directory,id);
      execFileSync(executable,[...args,root],{stdio:['ignore','pipe','pipe'],env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off'}});
      result.push({id,bytes:new Uint8Array(await readFile(path.join(root,'program.wasm'))),registry:JSON.parse(await readFile(path.join(root,'registry.json'),'utf8')),pkg:await importPackage(new Uint8Array(await readFile(path.join(root,'example.dcard'))))});
    }
    return result;
  } finally {await rm(directory,{recursive:true,force:true});}
}
