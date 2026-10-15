import {createProgramMarketplaceView,type ProgramMarketplaceView} from '../src/presentation/program-marketplace-view.js';
import {createMarketplaceSession,type MarketplaceModel,type MarketplaceContext} from '../src/marketplace-session.js';
import {marketplaceDisplayFields,marketplaceDisplayProfile,marketplaceIntents,validateMarketplaceDisplay,validateMarketplaceIntent,type MarketplaceDisplaySnapshot,type MarketplaceIntentEvent} from '../src/presentation/marketplace-display.js';
import {mountProgram,connectProgram,type ProgramRegistry} from '../src/presentation/program.js';
import {disposeMarketplaceBootstrap} from '../src/presentation/program-marketplace-bootstrap.js';
declare const model:MarketplaceModel,context:MarketplaceContext,root:HTMLElement,input:unknown;
const registry:ProgramRegistry=new Map([['example.marketplace',{approved:true,url:'https://program.example/market/index.html',version:'1',intents:marketplaceIntents,marketplaceDisplay:{profile:marketplaceDisplayProfile,fields:marketplaceDisplayFields}}]]);
const view:ProgramMarketplaceView=createProgramMarketplaceView({registry,programId:'example.marketplace',displayFields:marketplaceDisplayFields});const instance=view(model,context);instance.dispose();view.setEnabled(false);view.dispose();
const session=createMarketplaceSession(model,context);session.review(root,'stock');session.edit('title','A literal title');session.closeReview();session.dispose();
const snapshot:MarketplaceDisplaySnapshot=validateMarketplaceDisplay(input),event:MarketplaceIntentEvent=validateMarketplaceIntent(input,snapshot);const mounted=mountProgram(root,{registry,programId:'example.marketplace',marketplaceDisplay:snapshot,onMarketplaceIntent(event){void event.intent;}});mounted.setMarketplaceDisplay(snapshot);mounted.dispose();
void connectProgram({onMarketplaceDisplay(value){void value.seller.stock;}}).then(bridge=>{bridge.marketplaceIntent(event);bridge.dispose();});disposeMarketplaceBootstrap();
// @ts-expect-error The program cannot submit command keys or allocation digests.
const forged:MarketplaceIntentEvent={intent:'marketplace-request',snapshotId:'opaque',action:'stock',key:'command-key'};void forged;

import {createClient,createCommandRunner,type CommandInput,type CommandResult} from '@digital-card/framework/client';
import {marketplaceEnum,marketplaceRaffleText,type MarketplaceSessionDraft,type MarketplaceCommand,type MarketplaceCommands,type MarketplaceClient,type MarketplaceRecoveryClient} from '@digital-card/framework/marketplace-session';
const marketplaceClient=createClient();
const marketplaceCommands=createCommandRunner({client:marketplaceClient,namespace:'collector'});
const sessionModel={me:{userId:'collector'},label:'Host model',catalog:{currencies:[{id:'credits',name:'Credits'}],cards:[{id:'card',name:'Example'}],variants:[{id:'variant',cardId:'card',variantNote:'Variant'}],products:[{id:'product',name:'Product',productNote:1,allocationStrategy:{algorithm:'weighted-deck@4',version:4,deckScope:'purchase-slot'},duplicatePolicy:{scope:'none',fallback:'allow'}}]},inventory:[{id:'copy',definition:{name:'Example'},copyNote:'Copy'}],packs:[{id:'pack',product:{name:'Product'},openedAt:null,packNote:'Pack'}]};
const concreteSession=createMarketplaceSession(sessionModel,{client:marketplaceClient,mutate:marketplaceCommands,refresh:()=>{},isCurrentModel:next=>next.label==='Host model',locale:'en',messages:{'marketplace.title':'Market'},cardRenderer:(copy,options)=>{const id:string=copy.id;const interactive:false=options.interactive;void [id,interactive];return {node:document.createElement('article'),dispose(){}};}});
const originalModelLabel:string=concreteSession.model.label;
const originalClient:ReturnType<typeof createClient>=concreteSession.context.client;
const sessionReady:Promise<void>=concreteSession.ready;
const administrator:boolean|undefined=concreteSession.admin;
const mayCreateShop:boolean|undefined=concreteSession.canCreateShop;
const mayList:boolean=concreteSession.canList;
const busy:boolean=concreteSession.busy;
const version:number=concreteSession.formVersion;
const current:boolean=concreteSession.current();
const available:boolean=concreteSession.enabled('resale');
const workflow:'packs'|'directSales'|'resale'=concreteSession.workflow();
const deckVersion:0|1|2|3|4=concreteSession.stockDeckVersion();
const ticketStock:boolean=concreteSession.ticketStock();
const stock=concreteSession.stockControls();const acknowledge:boolean=stock.ack;const retry:boolean=stock.retry;const explanation:string=concreteSession.disclosure();
concreteSession.targets().forEach(target=>{
  if('copy' in target){const note:string=target.copy.copyNote;void note;}
  else if('pack' in target){const note:string=target.pack.packNote;void note;}
  else if('variant' in target){const note:string=target.variant.variantNote;void note;}
  else {const note:number=target.product.productNote;void note;}
});
const pendingPurchase=concreteSession.originalPurchase;
if(pendingPurchase){const key:string=pendingPurchase.key;const unvalidatedListing:unknown=pendingPurchase.listingId;void [key,unvalidatedListing];}
const draft:MarketplaceSessionDraft=concreteSession.state.draft;
const listingPrice:number|undefined=concreteSession.state.listings[0]?.price.amount;
const orderPaid:number|undefined=concreteSession.state.orders[0]?.paid.amount;
const shopName:string|undefined=concreteSession.state.shops[0]?.name;
const policyRevision:number|undefined=concreteSession.state.settings?.revision;
const diagnosticCode:unknown=concreteSession.state.diagnostic?.code;
const raffle=concreteSession.state.raffles.get('listing');
if(raffle&&'winner' in raffle){const winner:boolean=raffle.winner;void winner;}
const remove=concreteSession.subscribe(()=>{});const removed:boolean=remove();
concreteSession.edit('title','Example');concreteSession.edit('unknown-host-key','ignored');
concreteSession.publish();concreteSession.closeReview();
const valueAction:Promise<number|undefined>=concreteSession.action(()=>42);
const asyncValueAction:Promise<{receipt:boolean}|undefined>=concreteSession.action(async()=>({receipt:true}));
const voidOperations:Promise<void>[]=[concreteSession.load(true),concreteSession.loadOrders(),concreteSession.loadShops(),concreteSession.compose(),concreteSession.applySettings(1,'{}'),concreteSession.createShop(),concreteSession.createListing(),concreteSession.quoteStock(),concreteSession.inspectStock(),concreteSession.acknowledgeStock(),concreteSession.retryListing(),concreteSession.raffleStatus({id:'listing'}),concreteSession.enterRaffle({id:'listing'}),concreteSession.cancel({id:'listing'}),concreteSession.purchase(root,{id:'listing'},{newPurchase:true})];
const reviewResult:void|Promise<void>=concreteSession.review(root,'purchase',{id:'listing'});
concreteSession.actionReview(root);concreteSession.settingsReview(root);concreteSession.dispose();
const listingDraft=concreteSession.listingInput();
const draftKind:''|'copies'|'packs'|'mint-card'|'mint-pack'|'action'=listingDraft.items.kind;
if(listingDraft.items.kind==='action'){const params:unknown=listingDraft.items.params;void params;}
const raffleJSON:unknown=listingDraft.raffle;
const enumText:string=marketplaceEnum(concreteSession.localization,'phase','future-phase');
const raffleText:string=marketplaceRaffleText(concreteSession.localization,{entered:true});
marketplaceRaffleText(concreteSession.localization,null);marketplaceRaffleText(concreteSession.localization);
createMarketplaceSession({me:{userId:'collector'},catalog:{currencies:[],cards:[],variants:[],products:[]}},{client:marketplaceClient});
declare function checkedSynchronousMarketplaceCommand<C extends MarketplaceCommand>(command:C,input:CommandInput<C>):CommandResult<C>;
const synchronousCommandHooks:MarketplaceCommands=Object.assign(checkedSynchronousMarketplaceCommand,{pending:()=>undefined,recover:checkedSynchronousMarketplaceCommand,beginNew:checkedSynchronousMarketplaceCommand,confirmFailed:()=>false});
const readMarketplaceClient:MarketplaceClient=marketplaceClient;
const recoveryMarketplaceClient:MarketplaceRecoveryClient=marketplaceClient;
createMarketplaceSession(sessionModel,{client:readMarketplaceClient,mutate:synchronousCommandHooks});
createMarketplaceSession(sessionModel,{client:recoveryMarketplaceClient});
// @ts-expect-error A read client alone does not provide command execution or complete recovery transport.
createMarketplaceSession(sessionModel,{client:readMarketplaceClient});
// @ts-expect-error An absent permissions list can leave administrator status undefined.
const guaranteedAdmin:boolean=concreteSession.admin;
// @ts-expect-error Caught failures and busy/stale guards can omit action results.
const guaranteedAction:Promise<number>=concreteSession.action(()=>42);
// @ts-expect-error Draft construction does not validate empty kind or parsed JSON.
const validatedListingInput:CommandInput<'createListing'>=concreteSession.listingInput();
// @ts-expect-error Journal listing IDs remain unknown until host validation.
const trustedPendingListing:string|undefined=concreteSession.originalPurchase?.listingId;
// @ts-expect-error Session errors do not validate arbitrary host error codes.
const trustedDiagnostic:string|undefined=concreteSession.state.diagnostic?.code;
// @ts-expect-error Monetary amounts in loaded listings stay numeric.
const wrongPrice:string=concreteSession.state.listings[0]!.price.amount;
// @ts-expect-error Marketplace commands preserve checked createShop inputs.
concreteSession.context.mutate('createShop',{});
// @ts-expect-error Stock inputs are strings in the editable draft.
concreteSession.edit('quantity',2);
void [originalModelLabel,originalClient,sessionReady,administrator,mayCreateShop,mayList,busy,version,current,available,workflow,deckVersion,ticketStock,acknowledge,retry,explanation,draft,listingPrice,orderPaid,shopName,policyRevision,diagnosticCode,removed,valueAction,asyncValueAction,voidOperations,reviewResult,draftKind,raffleJSON,enumText,raffleText,guaranteedAdmin,guaranteedAction,validatedListingInput,trustedPendingListing,trustedDiagnostic,wrongPrice];
