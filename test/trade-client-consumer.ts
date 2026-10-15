import {createClient} from '@digital-card/framework/client';
import {createTradeDraft} from '@digital-card/framework/trade-client';
const draft=createTradeDraft({client:createClient(),userId:'account',catalog:{features:{cardTrading:true,currencyTrading:true},currencies:[{id:'credits',tradable:true}]}});
draft.subscribe(state=>{const version:number|undefined=state.selectedGive[0]?.version;const name:string|undefined=state.selectedGive[0]?.definition?.name;const needsReview:boolean|undefined=state.selectedGive[0]?.remoteReviewRequired;const reviewPhase:'idle'|'pending'|'allowed'|'error'=state.reviewPhase;void version;void name;void needsReview;void reviewPhase;});
draft.add('give','copy');draft.setCurrency('receive','credits',1);
const offer=draft.buildOffer();const version:number|undefined=offer.versions.copy;void version;
const review:Promise<void>=draft.reviewAsync();void review;
void createClient().reviewTransfer(offer,{signal:new AbortController().signal}).then(result=>{const status:'allowed'=result.status;const expiry:string=result.expiresAt;void status;void expiry;});
// @ts-expect-error sides are explicit so edits cannot target arbitrary state fields
draft.add('inventory','copy');
// @ts-expect-error currency amounts use integer JSON numbers, not strings
draft.setCurrency('give','credits','1');
// @ts-expect-error a client response must provide a checked copy version
createTradeDraft({userId:'account',catalog:{features:{},currencies:[]},client:{tradeInventory:async()=>({owner:null,items:[{id:'copy',tradable:true}],next:null})}});
// @ts-expect-error selected copy versions remain numbers in controller state
const wrong:string=draft.getState().selectedGive[0]!.version;
void wrong;

import {createTradingSession,tradeStatusText,type TradingModel,type TradingContext} from '@digital-card/framework/trading-session';
import {createLocalization} from '@digital-card/framework/localization';
import type {CommandRunner} from '@digital-card/framework/client';
import type {Schemas} from '@digital-card/framework/wire-types';
declare const tradingCommands:CommandRunner;
declare const incomingTrade:Schemas['Trade'];
const tradingModel={me:{userId:'account',role:'collector'},catalog:{features:{cardTrading:true,currencyTrading:true},currencies:[{id:'credits',name:'Credits',tradable:true}]},trades:[incomingTrade]};
const tradingContext={
  client:createClient(),storage:sessionStorage,localization:createLocalization(),
  getPrincipal:()=> 'account',isCurrentModel:(model:typeof tradingModel)=>model.me.userId==='account',isActionBusy:()=>false,
  action:async(fn:()=>unknown,options:{message:string})=>{await fn();return {notice:options.message};},
  mutate:tradingCommands,
  cardRenderer(copy:Parameters<NonNullable<TradingContext['cardRenderer']>>[0],options:Parameters<NonNullable<TradingContext['cardRenderer']>>[1]){const node=document.createElement('div');node.textContent=copy.id;options.onSelect(copy);return {node,dispose(){}};},
  inspect:(copy:Parameters<NonNullable<TradingContext['inspect']>>[0])=>{const id:string=copy.id;void id;},
};
const tradingSession=createTradingSession(tradingModel,tradingContext);
const tradingRole:string=tradingSession.model.me.role;
const sameTradingClient:ReturnType<typeof createClient>=tradingSession.context.client;
const tradingEnabled:boolean=tradingSession.enabled;
const tradingCurrent:boolean=tradingSession.current();
const tradingBusy:boolean=tradingSession.busy;
const tradingGeneration:number=tradingSession.generation;
const tradingPrivate:boolean=tradingSession.partnerPrivate;
const tradingCounter:Schemas['Trade']|null=tradingSession.counter;
const tradingError:string|null|undefined=tradingSession.error;
const tradingDiagnosticCode:string|undefined=tradingSession.diagnostic?.code;
const stopTrading=tradingSession.subscribe(()=>{const recipient:string|null|undefined=tradingSession.state?.recipientId;void recipient;});
const removedTrading:boolean=stopTrading();
tradingSession.draft?.setMessage('Example');
tradingSession.start();tradingSession.start('partner');tradingSession.start(null,incomingTrade);
const tradingDirectoryLoad:Promise<void>=tradingSession.loadDirectory('Collector');
const tradingDirectoryName:string|undefined=tradingSession.directory[0]?.name;
const tradingEligible:boolean=tradingSession.eligible({tradable:false,remoteReviewRequired:true});
const tradingActions=tradingSession.offerActions(incomingTrade);
const mayDecline:boolean=tradingActions.decline;const mayCounter:boolean=tradingActions.counter;
const tradingRun:Promise<{notice:string}|undefined>=tradingSession.run(async()=>42,'Saved');
tradingSession.review(document.body);
tradingSession.review(document.body,incomingTrade,'accept');
tradingSession.review(document.body,incomingTrade,'decline');
tradingSession.closeReview();tradingSession.dispose();
const statusText:string=tradeStatusText({status:'future-status'},tradingContext.localization);
const disabledTradingModel:TradingModel={me:{userId:'account'},catalog:{features:{},currencies:[]}};
const disabledTrading=createTradingSession(disabledTradingModel);
const optionalTradingDraft:typeof draft|undefined=disabledTrading.draft;
// @ts-expect-error Disabled trading may have no draft.
const requiredTradingDraft:typeof draft=disabledTrading.draft;
// @ts-expect-error Session state can be absent when trading is disabled.
const requiredTradingRecipient:string|null=disabledTrading.state.recipientId;
// @ts-expect-error Review supports the concrete offer actions.
tradingSession.review(document.body,incomingTrade,'purchase');
// @ts-expect-error Session callbacks return the host action result asynchronously.
const immediateTradingRun:{notice:string}=tradingSession.run(()=>42,'Saved');
// @ts-expect-error The host action result can be absent when stale or busy.
const guaranteedTradingRun:Promise<{notice:string}>=tradingSession.run(()=>42,'Saved');
// @ts-expect-error Trading directory searches use strings.
tradingSession.loadDirectory(10);
// @ts-expect-error Copy eligibility reads a boolean tradable flag.
tradingSession.eligible({tradable:'yes'});
// @ts-expect-error Session catalogs supply their feature flags.
createTradingSession({me:{userId:'account'},catalog:{currencies:[]}});
// @ts-expect-error Status text expects a string status.
tradeStatusText({status:3},tradingContext.localization);
void [tradingRole,sameTradingClient,tradingEnabled,tradingCurrent,tradingBusy,tradingGeneration,tradingPrivate,tradingCounter,tradingError,tradingDiagnosticCode,removedTrading,tradingDirectoryLoad,tradingDirectoryName,tradingEligible,mayDecline,mayCounter,tradingRun,statusText,optionalTradingDraft,requiredTradingDraft,requiredTradingRecipient,immediateTradingRun,guaranteedTradingRun];

import {renderTrading,type TradingView,type TradingUIRenderingContext} from '@digital-card/framework/trading-ui';
const nativeTradingView:TradingView=renderTrading(tradingModel,tradingContext);
const nativeTradingNode:HTMLElement=nativeTradingView.node;
document.body.append(nativeTradingNode);
const nativeTradingDispose:void=nativeTradingView.dispose();
renderTrading(tradingModel,tradingContext,null).dispose();
renderTrading(tradingModel,{...tradingContext,client:{directory:tradingContext.client.directory,tradeInventory:tradingContext.client.tradeInventory}}).dispose();
const sharedTradingRendering:TradingUIRenderingContext<typeof tradingModel>={
  locale:'en',messages:{'trades.title':'Trading'},
  cardRenderer(copy,options){const id:string=copy.id;const interactive:false=options.interactive;options.onSelect(copy);const locale:string=options.localization.locale;void [id,interactive,locale];return document.createElement('article');},
  inspect(copy){const id:string=copy.id;void id;},
};
const sharedTradingView:TradingView=renderTrading(tradingModel,sharedTradingRendering,tradingSession);
sharedTradingView.dispose();
// @ts-expect-error Native trading models provide the offer list.
renderTrading({me:tradingModel.me,catalog:tradingModel.catalog},tradingContext);
// @ts-expect-error Native currency displays require a currency name.
renderTrading({me:tradingModel.me,catalog:{features:{},currencies:[{id:'credits'}]},trades:[]},tradingContext);
// @ts-expect-error Creating an owned session requires its host dependencies.
renderTrading(tradingModel,sharedTradingRendering);
// @ts-expect-error The view synchronously returns a lifecycle object, not a DOM element.
const bareTradingNode:HTMLElement=renderTrading(tradingModel,tradingContext);
// @ts-expect-error A trading view is not asynchronous.
const promisedTradingView:Promise<TradingView>=renderTrading(tradingModel,tradingContext);
// @ts-expect-error Card renderers return elements or disposable node wrappers.
renderTrading(tradingModel,{...tradingContext,cardRenderer:()=> 'card'});
// @ts-expect-error Shared sessions need their subscription and review lifecycle.
renderTrading(tradingModel,sharedTradingRendering,{draft:tradingSession.draft});
void [nativeTradingNode,nativeTradingDispose,sharedTradingView,bareTradingNode,promisedTradingView];
