import {createLocalization} from '@digital-card/framework/localization';
import {createAdminController} from '@digital-card/framework/admin-client';
import type {Client,CommandStorage} from '@digital-card/framework/client';
declare const client:Client;
declare const storage:CommandStorage&Required<Pick<CommandStorage,'removeItem'>>;
const controller=createAdminController({client,storage,namespace:'operator',localization:createLocalization({locale:'es'})});
controller.stage({input:{scope:'site',reason:'Maintenance',changes:{packPurchasesPaused:true}},title:'Pause purchases',changes:[{label:'Purchases',before:'Allowed',after:'Paused'}]});
controller.stage({command:'administerCards',input:{action:'give',userId:'member',variantId:'standard',quantity:1,reason:'Award'},title:'Award a card',changes:[{label:'Copies',before:'0',after:'1'}]});
// @ts-expect-error Removal requires exact copy identities.
controller.stage({command:'administerCards',input:{action:'remove',userId:'member',quantity:1,reason:'Correction'},title:'Remove a card',changes:[]});
// @ts-expect-error Administrator revisions are captured by the controller.
controller.stage({input:{scope:'site',expectedRevision:3,reason:'Maintenance',changes:{}},title:'Review',changes:[]});
controller.subscribe(state=>{const revision:number|undefined=state.overview?.revision;const first:string|undefined=state.review?.changes[0]?.label;void revision;void first;});
async function confirm(){const receipt=await controller.confirm();const revision:number|undefined=receipt?.revision;void revision;}
void confirm;
controller.dispose();

import {mountAdminPanel,renderAdminPanel,type AdminUIState,type MountedAdminPanel,type RenderedAdminPanel} from '@digital-card/framework/admin-ui';
const adminRoot=document.createElement('div');
const adminUIState:AdminUIState={tab:'people',advanced:true,userId:'member',personAction:'give',peopleSearch:'Member',lineSearch:'Sky',customState:'retained'};
const mountedAdmin:MountedAdminPanel=mountAdminPanel(adminRoot,{client,namespace:'operator',storage,uiState:adminUIState,locale:'en',messages:{'admin.overview':'Overview'},navigate:destination=>{const page:'tradingControls'=destination;void page;}});
const mountedAdminReady:Promise<void>=mountedAdmin.ready;
const possiblyCreatedController:typeof controller|undefined=mountedAdmin.controller;
const adminRefresh:Promise<void>|undefined=mountedAdmin.refresh();
const requestedLeave:void=mountedAdmin.requestLeave(()=>{});
document.body.append(mountedAdmin.node);mountedAdmin.dispose();
const borrowedController=Object.assign(controller,{hostLabel:'Borrowed'});
const borrowedAdmin=mountAdminPanel(adminRoot,{controller:borrowedController,uiState:adminUIState});
const preservedLabel:string=borrowedAdmin.controller.hostLabel;
const borrowedRefresh:Promise<void>=borrowedAdmin.refresh();
borrowedAdmin.requestLeave(async()=>{});borrowedAdmin.dispose();
mountAdminPanel(adminRoot,{client,controller:null}).dispose();
const persistentAdminState:{admin?:AdminUIState|null}={admin:null};
const renderedAdmin:RenderedAdminPanel=renderAdminPanel({me:{userId:'operator'}},{client,state:persistentAdminState,localization:createLocalization()});
const renderedAdminReady:Promise<void>=renderedAdmin.ready;
const renderedController:typeof controller|undefined=renderedAdmin.controller();
renderedAdmin.requestLeave(()=>{});document.body.append(renderedAdmin.node);renderedAdmin.dispose();
// @ts-expect-error Without a supplied controller, a checked client is required.
mountAdminPanel(adminRoot,{});
// @ts-expect-error A panel controller may not exist before asynchronous account lookup completes.
const requiredCreatedController:typeof controller=mountedAdmin.controller;
// @ts-expect-error Mount refresh can return undefined before controller creation.
const requiredAdminRefresh:Promise<void>=mountedAdmin.refresh();
// @ts-expect-error Mount exposes a controller getter, not a controller factory.
mountedAdmin.controller();
// @ts-expect-error Renderer exposes a controller accessor method.
renderedAdmin.controller.load();
// @ts-expect-error Rendered wrappers do not forward the mount refresh method.
renderedAdmin.refresh();
// @ts-expect-error Administrator panels return handles synchronously.
const promisedAdmin:Promise<RenderedAdminPanel>=renderAdminPanel({me:{userId:'operator'}},{client});
// @ts-expect-error Panel storage supports the controller's full recovery lifecycle.
mountAdminPanel(adminRoot,{client,storage:{getItem:()=>null,setItem:()=>{}}});
// @ts-expect-error Embedded navigation targets the trading-controls page.
mountAdminPanel(adminRoot,{client,navigate:(page:'collection')=>{void page;}});
void [mountedAdminReady,possiblyCreatedController,adminRefresh,requestedLeave,preservedLabel,borrowedRefresh,renderedAdminReady,renderedController,requiredCreatedController,requiredAdminRefresh,promisedAdmin];

type LoadedAdminReview=NonNullable<ReturnType<typeof controller.getState>['review']>;
const storedGiveReview:LoadedAdminReview={command:'administerCards',input:{expectedRevision:1,reason:'Award',userId:'member',action:'give',variantId:'standard',quantity:1},title:'Award',description:'',changes:[]};
const storedRemovalReview:LoadedAdminReview={command:'administerCards',input:{key:'retry',expectedRevision:1,reason:'Correction',userId:'member',action:'remove',copyIds:['copy']},title:'Remove',description:'',changes:[]};
const storedProductReview:LoadedAdminReview={command:'configureAdmin',input:{expectedRevision:1,reason:'Example',scope:'product',targetId:'product',changes:{discountPercent:10}},title:'Product',description:'',changes:[]};
const storageOptionalController=createAdminController({client,namespace:'operator'});
storageOptionalController.getState();storageOptionalController.dispose();
// @ts-expect-error Stored give reviews retain required variant and quantity fields.
const incompleteStoredGive:LoadedAdminReview={command:'administerCards',input:{expectedRevision:1,reason:'Award',userId:'member',action:'give'},title:'Award',description:'',changes:[]};
// @ts-expect-error Stored removal reviews retain exact copy identities.
const incompleteStoredRemoval:LoadedAdminReview={command:'administerCards',input:{expectedRevision:1,reason:'Correction',userId:'member',action:'remove'},title:'Remove',description:'',changes:[]};
// @ts-expect-error Stored product settings retain the targeted product ID.
const incompleteStoredProduct:LoadedAdminReview={command:'configureAdmin',input:{expectedRevision:1,reason:'Example',scope:'product',changes:{}},title:'Product',description:'',changes:[]};
// @ts-expect-error Stored reviews always capture their expected administrator revision.
const missingStoredRevision:LoadedAdminReview={command:'configureAdmin',input:{reason:'Example',scope:'site',changes:{}},title:'Site',description:'',changes:[]};
// @ts-expect-error Stored review commands remain paired with their input branch.
const mismatchedStoredCommand:LoadedAdminReview={command:'configureAdmin',input:{expectedRevision:1,reason:'Correction',userId:'member',action:'remove',copyIds:['copy']},title:'Remove',description:'',changes:[]};
void [storedGiveReview,storedRemovalReview,storedProductReview,incompleteStoredGive,incompleteStoredRemoval,incompleteStoredProduct,missingStoredRevision,mismatchedStoredCommand];
