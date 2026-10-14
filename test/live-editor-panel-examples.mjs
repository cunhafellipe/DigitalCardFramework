import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {bootstrapEditorPanel} from '../src/presentation/program-editor-bootstrap.js';
import {editorFields,validateEditorProposal} from '../src/presentation/editor-display.js';

const python=process.env.PYTHON??'python',go=process.env.GO??'go';
const pythonSource=fileURLToPath(new URL('../examples/plugins/python-live-editor-panel.py',import.meta.url));
const goSource=fileURLToPath(new URL('../examples/plugins/go-live-editor-panel/main.go',import.meta.url));

function run(executable,args,environment={}){
  return new Promise((fulfill,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off',...environment}});
    let stdout='',stderr='',settled=false;
    const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value);};
    const timer=setTimeout(()=>{child.kill();finish(reject,Error('Live panel generator timed out'));},60000);
    const collect=(name,data)=>{if(name==='stdout')stdout+=data;else stderr+=data;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>65536){child.kill();finish(reject,Error('Live panel generator output exceeded its bound'));}};
    child.stdout.on('data',data=>collect('stdout',data));child.stderr.on('data',data=>collect('stderr',data));
    child.once('error',error=>finish(reject,error));
    child.once('close',code=>code===0?finish(fulfill,{stdout,stderr}):finish(reject,Error('Live panel generator failed: '+stderr)));
  });
}

async function temporary(t){
  const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'live-editor-panel-'));
  t.after(async()=>{assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});});
  return directory;
}

async function output(directory){
  assert.deepEqual((await readdir(directory)).sort(),['index.html','panel.css']);
  const html=await readFile(join(directory,'index.html'),'utf8'),css=await readFile(join(directory,'panel.css'),'utf8');
  assert(html.endsWith('\n'));assert(css.endsWith('\n'));assert(!html.includes('\r'));assert(!css.includes('\r'));
  assert(Buffer.byteLength(html)+Buffer.byteLength(css)<16384);
  return {html,css};
}

function checkMarkup({html,css}){
  const window=new Window({url:'https://panels.example.test/workshop/'}),document=window.document;
  document.write(html);
  assert.equal(document.documentElement.lang,'en');
  const scripts=[...document.querySelectorAll('script')];
  assert.equal(scripts.length,1);assert.equal(scripts[0].type,'module');
  assert.equal(scripts[0].getAttribute('src'),'/src/presentation/program-editor-bootstrap.js');
  assert.equal(scripts[0].textContent,'');
  assert.equal(document.querySelector('link[rel="stylesheet"]').getAttribute('href'),'panel.css');
  assert.equal(document.querySelectorAll('[style],iframe,object,embed,form').length,0);
  for(const element of document.querySelectorAll('*'))for(const attribute of element.attributes)assert(!attribute.name.startsWith('on'));
  const controls=[...document.querySelectorAll('[data-editor-field]')];
  assert.deepEqual(controls.map(control=>control.dataset.editorField).sort(),[...editorFields].sort());
  for(const control of controls){
    assert(control.disabled);assert(control.id);assert(document.querySelector('label[for="'+control.id+'"]'));
    assert(['INPUT','SELECT','TEXTAREA'].includes(control.tagName));
    assert(!control.hasAttribute('tabindex'));
  }
  assert.equal(new Set(controls.map(control=>control.id)).size,controls.length);
  const button=document.querySelector('[data-editor-propose]');
  assert.equal(button.type,'button');assert(button.disabled);assert.match(button.textContent,/Propose changes/);
  assert.match(css,/:focus-visible/);assert.match(css,/prefers-reduced-motion:\s*reduce/);assert.match(css,/transition:\s*none/);
  return {window,document};
}

async function checkInteraction(files){
  const {window:dom,document}=checkMarkup(files),sent=[];
  let listener,closed=false;
  const saved={window:globalThis.window,parent:globalThis.parent,AbortController:globalThis.AbortController};
  globalThis.window={addEventListener(type,callback){assert.equal(type,'message');listener=callback;},removeEventListener(type,callback){assert.equal(callback,listener);}};
  globalThis.parent={};globalThis.AbortController=dom.AbortController;
  let connection;
  try{
    const initiallyEnabled=[...document.querySelectorAll('[data-editor-field], [data-editor-propose]')];
    for(const control of initiallyEnabled)control.disabled=false;
    const connected=bootstrapEditorPanel(document);
    assert(initiallyEnabled.every(control=>control.disabled),'Bootstrap disables authored controls before the handshake');
    const port={onmessage:null,postMessage(message){sent.push(message);},close(){closed=true;}};
    listener({source:globalThis.parent,data:{type:'dc.program.init',version:1,nonce:'panel-test'},ports:[port]});
    connection=await connected;
    assert.deepEqual(sent.shift(),{version:1,type:'ready',nonce:'panel-test'});
    assert(initiallyEnabled.every(control=>control.disabled),'Handshake alone does not enable editing before a selection snapshot');
    document.querySelector('[data-editor-propose]').click();assert.equal(sent.length,0);
    const values={text:'Moonlit archive',color:'#304853','typography.size':24,'typography.lineHeight':1.2,'typography.letterSpacing':0,'typography.align':'left',opacity:1,x:8,y:12,width:160,height:48,rotation:0,brightness:1,saturation:1,blend:'normal'};
    const snapshot={profile:'dc.editor-selection@1',snapshotId:'00000000-0000-4000-8000-000000000001',revision:7,side:'front',nodeType:'text',locked:false,fields:[...editorFields],values};
    const display=value=>port.onmessage({data:{version:1,type:'content',content:value}});
    display(snapshot);
    const controls=Object.fromEntries([...document.querySelectorAll('[data-editor-field]')].map(control=>[control.dataset.editorField,control]));
    const button=document.querySelector('[data-editor-propose]');
    for(const [field,value]of Object.entries(values)){assert(!controls[field].disabled);assert.equal(controls[field].value,String(value));}
    assert(!button.disabled);button.click();assert.equal(sent.length,0);
    const {color,blend,...withoutColorAndBlend}=values;
    display({...snapshot,values:withoutColorAndBlend});button.click();assert.equal(sent.length,0,'Absent color and blend values do not create normalized default edits');
    display(snapshot);
    const patch={text:'Dawn at the observatory',color:'#78512f','typography.size':32,'typography.lineHeight':1.5,'typography.letterSpacing':2,'typography.align':'center',opacity:0.75,x:20,y:30,width:200,height:60,rotation:15,brightness:1.2,saturation:0.8,blend:'multiply'};
    for(const [field,value]of Object.entries(patch)){controls[field].value=String(value);assert(controls[field].checkValidity(),field+' must accept its proposal value');}
    button.click();assert.equal(sent.length,1);
    assert.deepEqual(sent[0],{version:1,type:'intent',nonce:'panel-test',intent:'editor-propose',snapshotId:snapshot.snapshotId,revision:7,patch});
    validateEditorProposal({snapshotId:sent[0].snapshotId,revision:sent[0].revision,patch:sent[0].patch},snapshot);
    assert.equal(snapshot.values.text,'Moonlit archive');
    sent.length=0;display(snapshot);controls.opacity.value='2';button.click();assert.equal(sent.length,0);
    display({...snapshot,fields:['text'],values:{text:values.text}});
    assert(!controls.text.disabled);assert(controls.color.disabled);controls.color.value='#ffffff';controls.text.value='Available text only';button.click();
    assert.deepEqual(sent.pop().patch,{text:'Available text only'});
    display({...snapshot,locked:true});assert(button.disabled);assert(Object.values(controls).every(control=>control.disabled));button.click();assert.equal(sent.length,0);
    connection.dispose();connection=undefined;assert(closed);
  }finally{
    connection?.dispose();
    for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;
    await dom.happyDOM.close();
  }
}

test('Python generates deterministic accessible live editor HTML with framework proposals',async t=>{
  const directory=await temporary(t),first=join(directory,'first'),second=join(directory,'second');
  assert.deepEqual(await run(python,[pythonSource,first]),{stdout:'',stderr:''});
  assert.deepEqual(await run(python,[pythonSource,second]),{stdout:'',stderr:''});
  const files=await output(first);assert.deepEqual(files,await output(second));await checkInteraction(files);
});

test('Go independently generates the same live editor and exercises its controls',async t=>{
  const directory=await temporary(t),executable=join(directory,process.platform==='win32'?'panel.exe':'panel');
  assert.deepEqual(await run(go,['build','-trimpath','-o',executable,goSource],{GOCACHE:join(directory,'go-cache')}),{stdout:'',stderr:''});
  const goOutput=join(directory,'go'),pythonOutput=join(directory,'python');
  try{assert.deepEqual(await run(executable,[goOutput]),{stdout:'',stderr:''});}
  catch(error){if(process.platform==='win32'&&error.code==='UNKNOWN'){t.skip('Go source compiled; this Windows environment cannot launch the generated executable. Run process conformance on Linux.');return;}throw error;}
  assert.deepEqual(await run(python,[pythonSource,pythonOutput]),{stdout:'',stderr:''});
  const files=await output(goOutput);assert.deepEqual(files,await output(pythonOutput));await checkInteraction(files);
});
