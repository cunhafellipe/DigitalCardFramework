import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';

const python=process.env.PYTHON??'python',go=process.env.GO??'go';
const pythonSource=fileURLToPath(new URL('../examples/plugins/python-program-card.py',import.meta.url)),goSource=fileURLToPath(new URL('../examples/plugins/go-program-card/main.go',import.meta.url));
function run(executable,args,environment={}){
 return new Promise((fulfill,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off',...environment}});let stdout='',stderr='',settled=false;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value);};
  const timer=setTimeout(()=>{child.kill();finish(reject,Error('Card program generator timed out'));},60000);
  const collect=(name,data)=>{if(name==='stdout')stdout+=data;else stderr+=data;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>16384){child.kill();finish(reject,Error('Generator diagnostic output exceeded its bound'));}};
  child.stdout.on('data',data=>collect('stdout',data));child.stderr.on('data',data=>collect('stderr',data));child.once('error',error=>finish(reject,error));child.once('close',code=>code===0?finish(fulfill,{stdout,stderr}):finish(reject,Error('Card program generator failed: '+stderr)));
 });
}
async function content(directory,mode='card'){
 const pack=mode==='pack',album=mode==='album';
 assert.deepEqual((await readdir(directory)).sort(),['card.css','index.html']);
 const html=await readFile(join(directory,'index.html'),'utf8'),css=await readFile(join(directory,'card.css'),'utf8');assert(Buffer.byteLength(html)+Buffer.byteLength(css)<16384);assert(html.endsWith('\n'));assert(css.endsWith('\n'));
 const window=new Window({settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
 try{
  window.document.write(html);const document=window.document;
  assert.equal(document.documentElement.lang,'en');assert.equal(document.title,album?'Celestial Archive Album':pack?'Celestial Archive Pack':'Celestial Archive');
  assert.equal(document.scripts.length,1);assert.equal(document.scripts[0].type,'module');assert.equal(document.scripts[0].getAttribute('src'),album?'/program-album-bootstrap.js':'/program-bootstrap.js');assert.equal(document.scripts[0].textContent,'');
  assert.equal(document.querySelectorAll('style,[style],iframe,object,embed,form').length,0);for(const element of document.querySelectorAll('*'))for(const attribute of element.attributes)assert(!/^on/i.test(attribute.name),'No executable author event handlers');
  assert.equal(document.querySelectorAll('link').length,1);assert.equal(document.querySelector('link').rel,'stylesheet');assert.equal(document.querySelector('link').getAttribute('href'),'card.css');
  if(album){
   assert(document.querySelector('[data-dc-album-name]'));assert.equal(document.querySelector('[data-dc-album-pages]').childElementCount,0);assert.equal(document.querySelectorAll('template').length,2);
   const page=document.querySelector('template[data-dc-album-page]').content,item=document.querySelector('template[data-dc-album-item]').content;assert(page.querySelector('[data-dc-page-name]'));assert(page.querySelector('[data-dc-album-items]'));const select=item.querySelector('button[data-dc-item-select]');assert(select);assert.equal(select.type,'button');assert(select.querySelector('[data-dc-item-name]'));assert(select.querySelector('[data-dc-item-rarity]'));assert.equal(select.querySelector('img[data-dc-item-preview]').getAttribute('src'),null);assert.equal(item.querySelectorAll('button').length,1);
   for(const root of [document,page,item]){assert.equal(root.querySelectorAll('[data-dc-intent],style,[style],iframe,object,embed,form').length,0);for(const element of root.querySelectorAll('*'))for(const attribute of element.attributes){assert(!/^on/i.test(attribute.name));assert(!/^(data-copy|data-user|data-product|data-binding)/i.test(attribute.name));}}
   assert(css.includes('.page-items'));assert(css.includes('.album-pages'));assert(css.includes('img:not([src])'));
  }else{
  const button=document.querySelector('button[data-dc-intent="select"]');assert(button);assert.equal(button.type,'button');assert.equal(button.getAttribute('aria-label'),pack?'Select Celestial Archive pack':'Select Celestial Archive card');assert.equal(document.querySelectorAll('[data-dc-intent]').length,1);
  if(pack){assert.equal(document.querySelectorAll('.pack-face').length,2);assert.equal(document.querySelectorAll('.crimp').length,2);assert(document.querySelector('.sealed-sleeve .pack-seal'));assert(document.querySelector('.pack-back').textContent.includes('Review contents and price in the host before buying.'));assert.equal(document.querySelectorAll('.card-select,.planet').length,0);assert.equal(document.querySelectorAll('button').length,1);}
  else{assert.equal(document.querySelectorAll('.face').length,2);assert(document.querySelector('.orbit-field .planet'));assert.equal(document.querySelectorAll('.orbit').length,2);assert.equal(document.querySelectorAll('.star').length,3);assert(document.querySelector('.face-back').textContent.includes('Beyond the horizon'));}
  for(const variable of ['--dc-tilt-x','--dc-tilt-y','--dc-reveal-progress','--dc-flip-progress'])assert(css.includes(variable),variable);assert(css.includes(':root[data-dc-side="back"]'));
  }
  assert(css.includes(':focus-visible'));assert(css.includes('prefers-reduced-motion'));assert(!/@import|url\s*\(/i.test(css));
 }finally{await window.happyDOM.abort();}
 return {html,css};
}

// Browser handshake, separate-origin approval and renderer lifecycle are
// qualified separately; this test runs both independent native generators.
test('Python and Go emit equivalent deterministic card, pack and album DOM without adopter JavaScript',async t=>{
 const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'portable-program-'));t.after(async()=>{assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});});
 const executable=join(directory,process.platform==='win32'?'program-card.exe':'program-card');assert.deepEqual(await run(go,['build','-trimpath','-o',executable,goSource],{GOCACHE:join(directory,'go-cache')}),{stdout:'',stderr:''});
 const modes=[];
 for(const kind of ['card','pack','album']){
  const outputs=[];
  for(const [language,command,args]of [['python',python,[pythonSource]],['go',executable,[]]]){
   const name=language+'-'+kind,first=join(directory,name),second=join(directory,name+'-repeat'),mode=kind==='card'?[]:['--'+kind];assert.deepEqual(await run(command,[...args,...mode,first]),{stdout:'',stderr:''});assert.deepEqual(await run(command,[...args,...mode,second]),{stdout:'',stderr:''});const generated=await content(first,kind);assert.deepEqual(generated,await content(second,kind),name+' output must be deterministic');outputs.push(generated);
  }
  assert.deepEqual(outputs[0],outputs[1]);modes.push(outputs[0]);
 }
 assert.equal(new Set(modes.map(mode=>mode.html)).size,3);assert.equal(new Set(modes.map(mode=>mode.css)).size,3);
});
