import type {GroupLayer,TextLayer} from '../docs/complex-cards/contracts.js';
const group:GroupLayer={id:'finish',type:'group',isolate:true,width:1,height:1,blend:'screen',children:[{id:'image',type:'image',asset:'front'}],mask:{polygon:[[0,0],[1,0],[1,1]]},material:{kind:'foil'}};
const legacy:GroupLayer={id:'legacy',type:'group',children:[]};
// @ts-expect-error Isolated groups need explicit dimensions.
const unbounded:GroupLayer={id:'invalid',type:'group',isolate:true,children:[]};
// @ts-expect-error Nonisolated groups omit the isolate field.
const falseFlag:GroupLayer={id:'invalid',type:'group',isolate:false,children:[]};
// @ts-expect-error Isolation belongs to groups.
const text:TextLayer={id:'title',type:'text',text:'Title',width:1,height:.2,isolate:true};
void group;void legacy;void unbounded;void falseFlag;void text;

// @ts-expect-error Group clipping requires isolation.
const unisolatedMask:GroupLayer={id:'invalid',type:'group',children:[],mask:{asset:'mask'}};
void unisolatedMask;

import {createAlbumMotion} from '@digital-card/framework/presentation/album-motion';
const motion=createAlbumMotion({members:[{id:'first',motion:{syncGroup:'pair'}},{id:'second',motion:{syncGroup:'pair'}}],defaults:{maxRotation:[8,12]},onChange(id,state){const name:string=id,rotation:number=state.rotation.x;void [name,rotation];}});
motion.setInputs('first',{tilt:{x:.5},host:{'host.progress':1}});
motion.setAll({tilt:{x:0,y:0}});
const rotation:number|undefined=motion.snapshot().first?.rotation.y;
// @ts-expect-error motion inputs require numeric tilt values
motion.setInputs('first',{tilt:{x:'left'}});
// @ts-expect-error maximum rotation has exactly two axes
createAlbumMotion({members:[],defaults:{maxRotation:[8]}});
// @ts-expect-error every member needs a stable ID
createAlbumMotion({members:[{motion:{enabled:true}}]});
motion.dispose();void rotation;
