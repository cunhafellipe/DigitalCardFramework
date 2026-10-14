import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import {Window} from 'happy-dom';
import {openerDisplayProfile,openerDisplayFields,openerDisplaySchema,validateOpenerDisplay} from '../src/presentation/opener-display.js';
import {createRevealController} from '../src/client.js';
import {mountOpener} from '../src/ui.js';
import {createProgramOpenerView} from '../src/presentation/program-opener-view.js';
import {png} from './presentation-fixtures.mjs';

const snapshot=()=>({profile:openerDisplayProfile,snapshotId:randomUUID(),fields:[...openerDisplayFields],phase:'revealing',revealed:1,total:2,locale:'en',dir:'ltr',labels:{title:'Reveal',status:'Cards saved',progress:'1 of 2',reveal:'Next',skip:'All',replay:'Replay',inspect:'Inspect',new:'New',duplicate:'Duplicate'},items:[{position:0,label:'Card 1',handle:randomUUID(),name:'Visible <card>',rarity:'common',isNew:true},{position:1,label:'Card 2'}],previews:[]});
const receipt=()=>({id:'pack',cards:[{id:'copy',definition:{name:'Card'},rarityId:'common',isNew:true}]});
function dom(){const window=new Window({url:'http://host.invalid/'}),keys=['document','HTMLElement','customElements','location'],old=new Map(keys.map(key=>[key,globalThis[key]]));for(const key of keys)globalThis[key]=key==='location'?window.location:window[key];return {window,close(){window.happyDOM.abort();for(const key of keys){const value=old.get(key);if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};}

test('profile supports all 1000 committed slots with granted display data and detached bounded raster bytes',()=>{
  const value=snapshot();value.phase='complete';value.revealed=value.total=1000;value.items=Array.from({length:1000},(_,position)=>({position,label:'卡'.repeat(100),handle:randomUUID(),name:'名'.repeat(100),rarity:'稀'.repeat(100),isNew:!!(position%2)}));value.previews=[{handle:value.items[0].handle,mediaType:'image/png',bytes:png()}];
  const validate=new Ajv2020({strict:true}).compile(openerDisplaySchema),output=validateOpenerDisplay(value);assert(validate(output));assert.equal(output.items.length,1000);const original=output.previews[0].bytes[0];value.previews[0].bytes[0]=0;value.items[0].name='Changed';assert.equal(output.previews[0].bytes[0],original);assert.equal(output.items[0].name,'名'.repeat(100));
});
test('unrevealed cards, missing grants, raw records, bad associations and getters are rejected',()=>{
  for(const mutate of [value=>value.copyId='private',value=>value.items[0].bindings={secret:'private'},value=>value.items[1].handle=randomUUID(),value=>value.items[1].name='Unrevealed',value=>value.items[1].isNew=false,value=>value.fields=[],value=>value.items[1].position=0,value=>value.revealed=3,value=>value.phase='idle',value=>value.labels.error='Private server detail',value=>value.previews=[{handle:randomUUID(),mediaType:'image/png',bytes:png()}],value=>value.items[0].name='x'.repeat(101)]){const input=snapshot();mutate(input);assert.throws(()=>validateOpenerDisplay(input),{code:'OPENER_DISPLAY'});}
  const input=snapshot();Object.defineProperty(input,'phase',{enumerable:true,get(){throw Error('Getter executed');}});assert.throws(()=>validateOpenerDisplay(input),{code:'OPENER_DISPLAY'});
});
test('retained custom opener receives updates without remount and cosmetic update/dispose errors cannot interrupt publication',async()=>{
  const d=dom(),root=document.createElement('main');document.body.append(root);let mounts=0,updates=0,cleanups=0,fail=false;const controller=createRevealController({open:()=>receipt()}),observed=[];
  const clean=mountOpener(root,{controller,cardRenderer:()=>document.createElement('span'),view(){mounts++;const node=document.createElement('article');node.textContent='Custom';return {node,update(){updates++;if(fail)throw Error('Cosmetic failure');},dispose(){cleanups++;throw Error('Cosmetic cleanup');}};}});controller.subscribe(state=>observed.push(state.phase));
  try{const node=root.firstChild;await controller.load('pack');controller.reveal();assert.equal(mounts,1);assert.equal(updates,3);assert.equal(root.firstChild,node);fail=true;controller.replay();assert.equal(controller.getState().phase,'ready');assert.equal(observed.at(-1),'ready');assert(root.querySelector('.dc-opener'));assert.equal(cleanups,1);controller.skip();assert.equal(observed.at(-1),'complete');}
  finally{clean();controller.dispose();d.close();}
});
test('legacy opener callbacks still remount and native cards are disposed between receipt renders',async()=>{
  const d=dom(),root=document.createElement('main'),controller=createRevealController({open:()=>receipt()});let mounts=0,cleanups=0,cardsDisposed=0;
  const legacy=mountOpener(root,{controller,view(){mounts++;return {node:document.createElement('div'),dispose(){cleanups++;}};}});
  try{await controller.load('pack');controller.reveal();assert.equal(mounts,4);assert.equal(cleanups,3);legacy();assert.equal(cleanups,4);const native=mountOpener(root,{controller,cardRenderer(){const node=document.createElement('span');node.dispose=()=>cardsDisposed++;return node;}});controller.replay();assert.equal(cardsDisposed,1);controller.skip();native();assert.equal(cardsDisposed,2);}finally{controller.dispose();d.close();}
});
test('factory disposal releases never-mounted fallbacks and disconnected views cannot allocate after terminal disposal',async()=>{
  const d=dom(),controller=createRevealController({open:()=>receipt()});await controller.load('pack');controller.skip();let created=0,destroyed=0;const context={cardRenderer(){created++;const node=document.createElement('span');node.dispose=()=>destroyed++;return node;}},options={registry:new Map([['example.opener',{approved:false}]]),programId:'example.opener'};
  try{const first=createProgramOpenerView(options),unmounted=first(controller.getState(),controller,context);assert.equal(created,1);first.dispose();assert.equal(destroyed,1);unmounted.update(controller.getState());assert.equal(created,1);
    const second=createProgramOpenerView(options),detached=second(controller.getState(),controller,context);document.body.append(detached.node);detached.node.remove();assert.equal(created,destroyed);const before=created;second.dispose();detached.update(controller.getState());document.body.append(detached.node);assert.equal(created,before);assert.equal(destroyed,before);detached.dispose();
  }finally{controller.dispose();d.close();}
});
