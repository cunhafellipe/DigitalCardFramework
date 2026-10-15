import {createClient,createCommandRunner,createRevealController} from '@digital-card/framework/client';
import {createAdminController} from '@digital-card/framework/admin-client';
const client=createClient();
const storage:Storage=globalThis.sessionStorage;
const runner=createCommandRunner({client,storage,namespace:'account'});
async function recoverPurchase(){
  const quote=await client.quote({productId:'sample'});
  const allocation=await client.allocationStatus({productId:'sample'});
  const resolved:boolean=await runner.confirmFailed('purchase',quote);
  if(allocation.attemptId&&allocation.state==='stale')await client.acknowledgeAllocation({attemptId:allocation.attemptId});
  void resolved;
  const purchase=await runner('purchase',quote);
  const packId:string=purchase.packs[0]!.id;
  const recovered=await runner.recover('purchase',quote);
  const paid:number=recovered.paid.amount;
  const copies=await client.inventoryPage({limit:50});
  const title:string=copies.items[0]!.definition.name;
  return {packId,paid,title};
}
void recoverPurchase;
const reveal=createRevealController({open:client.openPack});
reveal.subscribe(state=>{const cards:number=state.receipt?.cards.length??0;void cards;});
const admin=createAdminController({client,storage,namespace:'operator'});
admin.stage({input:{scope:'site',reason:'Configuration update',changes:{packPurchasesPaused:false}},title:'Site controls',changes:[{label:'Purchases',before:'Paused',after:'Allowed'}]});
admin.stage({command:'administerCards',input:{action:'give',userId:'account',variantId:'variant',quantity:1,reason:'Collection award'},title:'Award',changes:[{label:'Copies',before:'0',after:'1'}]});
admin.subscribe(state=>{const count:number=state.overview?.counts.cards??0;void count;});
// @ts-expect-error command input preserves the reviewed revision requirements
void runner('purchase',{productId:'sample',quantity:1});
// @ts-expect-error arbitrary SDK operation names cannot become durable commands
void runner('quote',{productId:'sample'});
// @ts-expect-error admin user detail requires an account ID
void client.adminUser({limit:50});
// @ts-expect-error card administration uses its own draft fields
admin.stage({command:'administerCards',input:{scope:'site',reason:'Configuration update',changes:{}},title:'Cards',changes:[]});
// @ts-expect-error receipts expose integer amounts as numbers
const amount:Promise<string>=client.purchase({key:'key',productId:'sample',quantity:1,productRevision:1,catalogVersion:1}).then(result=>result.paid.amount);
void amount;

async function createReviewedStock(shopId:string){
  const quote=await client.quoteMintPackStock({shopId,productId:'sample',quantity:2});
  const status=await client.stockAllocationStatus({shopId,productId:'sample'});
  const originatingCommand:'purchase'|'createListing'|'commitExternalPurchase'|null=status.command;
  void originatingCommand;
  return runner('createListing',{shopId,title:'Sealed packs',price:{currencyId:'credits',amount:10},items:{kind:'mint-pack',productId:quote.productId,quantity:quote.quantity},allocationDigest:quote.allocationDigest});
}
void createReviewedStock;

import {createCodeRevealController,renderCodeReveal,renderCodeHistory,type CodeRevealState,type CodeHistoryView} from '@digital-card/framework/code-ui';
const codeController=createCodeRevealController({codeId:'code',reveal:client.revealCode,key:client.requestKey});
const codeSnapshot:CodeRevealState=codeController.getState();
const codeUnsubscribe=codeController.subscribe(state=>{
  if(state.phase==='revealed'){const secret:string=state.code;const error:null=state.error;void [secret,error];}
  else if(state.phase==='error'){const message:string=state.error;const diagnosticCode:string|undefined=state.diagnostic.code;const diagnosticName:string|undefined=state.diagnostic.name;void [message,diagnosticCode,diagnosticName];}
  else {const code:null=state.code;void code;}
});
const codeUnsubscribed:boolean=codeUnsubscribe();
const codeOpened:Promise<string|undefined>=codeController.open();
codeController.dispose();
createCodeRevealController({codeId:'code',reveal:input=>{const id:string=input.codeId;const key:string=input.key;void [id,key];return {code:'example'};}});
const codeReveal=renderCodeReveal({codeId:'code',mode:'scratch'},{reveal:client.revealCode,threshold:0.5,locale:'en',messages:{'codes.reveal':'Show code'}});
const codeRevealNode:HTMLElement=codeReveal.node;
const codeViewOpen:Promise<string|undefined>=codeReveal.controller.open();
document.body.append(codeRevealNode);codeReveal.dispose();
renderCodeReveal({codeId:'code',mode:'open'},{reveal:client.revealCode}).dispose();
renderCodeReveal({codeId:'code',mode:'peel'},{reveal:client.revealCode}).dispose();
const codeHistory:CodeHistoryView=renderCodeHistory({}, {client});
const codeHistoryReady:Promise<void>=codeHistory.ready;
document.body.append(codeHistory.node);codeHistory.dispose();
renderCodeHistory(null,{client:{codeHistory:client.codeHistory,revealCode:client.revealCode,reportCodeUsage:client.reportCodeUsage,requestKey:client.requestKey},codeRevealRenderer:(input,options)=>{
  const id:string=input.codeId;const mode:'open'|'scratch'|'peel'|undefined=input.mode;const key:string=options.key();const locale:string=options.localization.locale;
  const response=options.reveal({codeId:id,key});void [mode,locale,response];
  return {node:document.createElement('output'),controller:createCodeRevealController({codeId:id,reveal:options.reveal}),dispose(){}};
}}).dispose();
renderCodeHistory(undefined,{client,codeRevealRenderer:()=>document.createElement('div')}).dispose();
// @ts-expect-error Reveals require a host callback returning the code string.
createCodeRevealController({codeId:'code',reveal:()=>({code:42})});
// @ts-expect-error Reveal keys are generated as strings.
createCodeRevealController({codeId:'code',reveal:client.revealCode,key:()=>42});
// @ts-expect-error Reveal failures or disposal may produce no value.
const guaranteedCode:Promise<string>=codeController.open();
// @ts-expect-error Reveal values are asynchronous.
const immediateCode:string=codeController.open();
// @ts-expect-error Only the revealed phase guarantees a secret string.
const coveredCode:string=codeSnapshot.code;
// @ts-expect-error Cosmetic reveal mode is explicit.
renderCodeReveal({codeId:'code',mode:'flip'},{reveal:client.revealCode});
// @ts-expect-error Reveal thresholds are numeric fractions.
renderCodeReveal({codeId:'code'},{reveal:client.revealCode,threshold:'half'});
// @ts-expect-error Interactive reveal requires a host reveal callback.
renderCodeReveal({codeId:'code'},{});
// @ts-expect-error History needs its client callbacks.
renderCodeHistory({},{});
// @ts-expect-error Custom history reveal renderers return nodes or node wrappers.
renderCodeHistory({}, {client,codeRevealRenderer:()=> 'code'});
// @ts-expect-error History loading completes without exposing raw rows as the result.
const historyRows:Promise<unknown[]>=codeHistory.ready;
void [codeSnapshot,codeUnsubscribed,codeOpened,codeViewOpen,codeHistoryReady,guaranteedCode,immediateCode,coveredCode,historyRows];
