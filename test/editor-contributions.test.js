import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import Ajv2020 from 'ajv/dist/2020.js';
import {editorContributionProtocol,editorContributionSchema,validateEditorContribution,createEditorContributions} from '../src/presentation/editor-contributions.js';
import {createProject} from '../src/presentation/project.js';
import {importPackage} from '../src/presentation/package.js';
import {build,fixture} from './presentation-fixtures.mjs';

const manifest=()=>({protocol:editorContributionProtocol,id:'example.print-layout',version:'1.0.0',title:'Print layout',controls:[{id:'position-x',label:'Horizontal position',field:'x',minimum:-1000,maximum:1000,step:1},{id:'position-y',label:'Vertical position',field:'y',minimum:-1000,maximum:1000,step:1},{id:'rotation',label:'Rotation',field:'rotation',minimum:-180,maximum:180,step:1}]});
const settle=async()=>{for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));};
test('manifest schema and semantic validator accept detached bounded data only',()=>{
 const validate=new Ajv2020({strict:true}).compile(editorContributionSchema),original=manifest(),value=validateEditorContribution(original);assert(validate(value));original.controls[0].label='Changed';assert.equal(value.controls[0].label,'Horizontal position');assert(Object.isFrozen(value.controls));assert.throws(()=>value.controls.push({}),TypeError);
 for(const mutation of [value=>value.url='https://example.invalid',value=>value.css='body{}',value=>value.controls[0].field='ownerId',value=>value.controls[0].minimum=Infinity,value=>value.controls[0].maximum=value.controls[0].minimum,value=>value.controls[0].step=0,value=>value.controls[0].label='bad\nlabel',value=>value.id+='\n',value=>value.controls[1].id=value.controls[0].id,value=>value.controls[1].field='x',value=>value.controls[0].script='alert(1)',value=>value.controls[0].label='\ud800']){const invalid=manifest();mutation(invalid);assert.throws(()=>validateEditorContribution(invalid),{code:'EDITOR_CONTRIBUTION'});}
 const accessor=manifest();Object.defineProperty(accessor,'title',{enumerable:true,get(){throw Error('Getter must not execute');}});assert.throws(()=>validateEditorContribution(accessor),{code:'EDITOR_CONTRIBUTION'});
 for(const bad of [Object.assign(manifest(),{extra:{nested:{too:{deep:{value:true}}}}}),JSON.parse('{"__proto__":{},"protocol":"x"}'),new Date(),Array(17).fill(manifest())])assert.throws(()=>Array.isArray(bad)?createEditorContributions(bad):validateEditorContribution(bad),{code:'EDITOR_CONTRIBUTION'});
 assert.throws(()=>createEditorContributions([manifest(),manifest()]),{code:'EDITOR_CONTRIBUTION'});
 for(const grants of [{ownerId:{minimum:0,maximum:1}},{x:{minimum:0,maximum:Infinity}},{x:{minimum:0,maximum:1,callback:true}}])assert.throws(()=>createEditorContributions([],{grants}),{code:'EDITOR_CONTRIBUTION'});
});
test('granted controls edit through project history, export and reopen independently',async()=>{
 const window=new Window(),project=createProject(await build(fixture())),other=createProject(await build(fixture())),root=window.document.createElement('main'),secondRoot=window.document.createElement('main');let edits=0;
 const selection=()=>({project,side:'front',node:project.scenes.get('scenes/front.json').nodes[0],locked:false});
 const registry=createEditorContributions([manifest()],{grants:{x:{minimum:-20,maximum:20}}}),second=createEditorContributions([manifest()]);
 try{registry.mount({root,getSelection:selection,edit:fn=>{project.edit(fn);edits++;}});second.mount({root:secondRoot,getSelection:()=>({project:other,side:'front',node:other.scenes.get('scenes/front.json').nodes[0],locked:false}),edit:fn=>other.edit(fn)});assert.equal(root.querySelectorAll('input').length,1);const input=root.querySelector('input');assert.equal(input.min,'-20');assert.equal(input.max,'20');input.value='15';input.dispatchEvent(new window.Event('change'));await settle();assert.equal(selection().node.x,15);assert.equal(edits,1);assert.equal(other.scenes.get('scenes/front.json').nodes[0].x,0);project.undoEdit();assert.equal(selection().node.x,0);project.redoEdit();assert.equal(selection().node.x,15);const reopened=createProject(await importPackage((await project.export({retainSources:true})).archive));assert.equal(reopened.scenes.get('scenes/front.json').nodes[0].x,15);
 }finally{registry.dispose();second.dispose();window.happyDOM.abort();}
});
test('host ceilings, locks, disable, replaced selection and disposal fence queued or detached controls',async()=>{
 const window=new Window(),root=window.document.createElement('main');let node={x:0},locked=false,edits=0,tasks=[];const project={},registry=createEditorContributions([manifest()],{grants:{x:{minimum:-5,maximum:5}}}),getSelection=()=>({project,node,side:'front',locked}),edit=fn=>{fn();edits++;};
 try{const mount=registry.mount({root,getSelection,edit,run:fn=>tasks.push(fn)}),input=root.querySelector('input');input.value='2';input.dispatchEvent(new window.Event('change'));registry.setEnabled('example.print-layout',false);registry.setEnabled('example.print-layout',true);await tasks.shift()();assert.equal(edits,0);input.dispatchEvent(new window.Event('change'));assert.equal(tasks.length,0);
  const latest=root.querySelector('input');latest.value='4';latest.dispatchEvent(new window.Event('change'));node={x:0};await tasks.shift()();assert.equal(edits,0);mount.dispose();latest.dispatchEvent(new window.Event('change'));assert.equal(tasks.length,0);
  locked=true;registry.mount({root,getSelection,edit});assert(root.querySelector('input').disabled);root.querySelector('input').value='3';root.querySelector('input').dispatchEvent(new window.Event('change'));await settle();assert.equal(edits,0);registry.dispose();assert.equal(root.querySelectorAll('input').length,0);
 }finally{registry.dispose();window.happyDOM.abort();}
});
test('labels remain text and values outside host limits cannot mutate the layer',async()=>{
 const window=new Window(),root=window.document.createElement('main'),value=manifest();value.title='<script>synthetic()</script>';value.controls[0].label='<img src=x onerror=synthetic()>';let edits=0;const node={x:0},project={},registry=createEditorContributions([value],{grants:{x:{minimum:-2,maximum:2}}});
 try{registry.mount({root,getSelection:()=>({project,node,side:'front',locked:false}),edit:fn=>{fn();edits++;}});assert.equal(root.querySelectorAll('script,img').length,0);assert(root.textContent.includes('<script>'));const input=root.querySelector('input');for(const number of ['3','','NaN']){input.value=number;input.dispatchEvent(new window.Event('change'));await settle();}assert.equal(edits,0);assert.equal(node.x,0);}finally{registry.dispose();window.happyDOM.abort();}
});

test('queued changes validate the captured value before later DOM input changes',async()=>{
 const window=new Window(),root=window.document.createElement('main'),node={x:0},project={},tasks=[],errors=[];let edits=0;
 const registry=createEditorContributions([manifest()],{grants:{x:{minimum:-5,maximum:5}}});
 try{registry.mount({root,getSelection:()=>({project,node,side:'front',locked:false}),edit:fn=>{fn();edits++;},run:fn=>tasks.push(fn),report:message=>errors.push(message)});const input=root.querySelector('input');
  input.value='1.5';assert.equal(input.checkValidity(),false);input.dispatchEvent(new window.Event('change'));input.value='2';assert.equal(input.checkValidity(),true);await assert.rejects(tasks.shift()(),{code:'EDITOR_CONTRIBUTION'});assert.equal(edits,0);assert.equal(node.x,0);
  input.dispatchEvent(new window.Event('change'));input.value='1.5';await tasks.shift()();assert.equal(edits,1);assert.equal(node.x,2);
 }finally{registry.dispose();window.happyDOM.abort();}
});
