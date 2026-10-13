import {allocationCodeDemand} from './allocation-planner.js';
import {createCodeIssuerRegistry} from './remote-code-issuer.js';
import {GeneratedCodeIssuanceService} from './code-issuance.js';
import {createBindingFactoryRegistry,snapshotBindingFactoryUser} from './remote-binding-factory.js';
import {BindingFactoryService} from './binding-factories.js';
import {hasPermission} from './access.js';
import {validateAlbumArtwork,validateAlbumPageSize,validateAlbumPageAssignments} from './album-appearance.js';
import {recordContexts} from './record-context.js';
import {validRecordAccounting,recordAccountingField,summarizeRecords} from './record-accounting.js';
import {resolveCapabilities,admitWorkflow,transitionCapabilities,workflowRequirements} from './capability-policy.js';
import {CommandIntentService} from './command-intents.js';
import {completionContext,completionDefaults,completionCapacity,ordinaryRequestCount,reserveCompletion,withCompletion,missingCompletions,reserveDelivery,accountReservationMetadata} from './completion.js';
import {ExternalPurchaseService} from './external-purchases.js';
import {deriveStats,inspectCardPolicy} from './card-policy.js';
import {CardPolicyService,validateGovernedCatalog,redactGovernedCard} from './card-policy-service.js';
import {randomInt, randomUUID, createHash} from 'node:crypto';
import {types as utilTypes} from 'node:util';
import {check, integer, text, jsonObject, validateCatalog} from './catalog.js';
import {MemoryStore} from './store.js';
import {memoryQueries} from './storage-query.js';
import {prepareImport,contentDigest} from './importer.js';
import {page} from './data.js';
import {auditState} from './audit.js';
import {validateTradingPolicy,tradingDefaults,transferPolicyReason,assertTradePolicy} from './trading-policy.js';
import {CommerceService} from './commerce.js';
import {AdminService,adminRevision,adminSite,adminRestrictions,adminTransferReason,effectiveProduct,assertAdminPurchase,invalidateAdminReview} from './admin.js';
import {ActionService,openingActions,enqueueAction} from './actions.js';
import {cardBehavior} from './card-types.js';
import {CodeService,importedVariantDemand,codeStockAvailable,codeSummary,codeTransferReason} from './codes.js';
import {createRemotePurchasePolicy} from './remote-purchase-policy.js';
import {PolicyProposalCoordinator} from './policy-proposals.js';
import {createRemoteListingPolicy} from './remote-listing-policy.js';
import {listingPolicyProtocol,validateListingPolicyRequest} from './listing-policy-contracts.js';
import {createRemoteTransferPolicy} from './remote-transfer-policy.js';
import {createRemoteTradePolicy} from './remote-trade-policy.js';
import {TransferPolicyAdmission} from './transfer-policy-admission.js';
import {createRemoteAllocationStrategy} from './remote-allocation-strategy.js';
import {createRemoteStockAllocationStrategy} from './remote-stock-allocation-strategy.js';
import {stockAllocationStrategyProtocol,validateStockAllocationStrategyRequest,validateStockAllocationStrategyV2Request,validateStockAllocationStrategyV3Request,validateStockAllocationStrategyV4Request} from './stock-allocation-strategy-contracts.js';
import {validateAllocationSolverAdmission} from './allocation-feasibility.js';
import {createRemoteExternalAllocationStrategy} from './remote-external-allocation-strategy.js';
import {ExternalAllocationCoordinator} from './external-allocation.js';
import {AllocationIntentService} from './allocation-intents.js';

const clone = value => structuredClone(value);
const id = () => randomUUID();
const lookup = (list,key) => list.find(x=>x.id===key);
const nowISO = () => new Date().toISOString();
function fingerprint(value) {
  const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x==='object'
    ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])) : x;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export class CardFramework {
  #store; #clock; #random; #bindings; #policies; #limits; #codes; #actions; #subscriptions; #commerce; #cardPolicies; #administration; #externalPurchases;#commandIntents;#workerPlanCache;#remotePurchasePolicy;#remoteListingPolicy;#remoteTransferPolicy;#remoteTradePolicy;#transferPolicies;#policyPreflights=new WeakSet();#inventoryPolicyReads=new WeakSet();#remoteAllocation;#allocationIntents;#allocationAdmissions=new WeakMap();#remoteStockAllocation;#stockAllocationIntents;#allocationActive=new Map();#remoteExternalAllocation;#externalAllocation;
  #codeIssuerRegistry;#codeIssuance;#bindingFactoryRegistry;#bindingFactories;
  constructor({store=new MemoryStore(), clock=nowISO, random=randomInt, bindings={}, policies={},limits={},codeVault,codeLimits={},codeGenerators={},allocationCodeIssuers={},allocationBindingFactories={},actionHandlers={},actionOptions={},eventSubscriptions=[],raffleRandom=randomInt,externalPurchaseProviders={},externalPurchaseLimits={},remotePolicies={},remoteAllocation=null,remoteStockAllocation=null,remoteExternalAllocation=null}={}) {
    this.#store=store; this.#clock=clock; this.#random=random;
    this.#cardPolicies=new CardPolicyService({read:fn=>store.read(fn),operate:(...args)=>this.#operatorCommand(...args),clock});
    this.#administration=new AdminService({read:fn=>store.read(fn),operate:(...args)=>this.#operatorCommand(...args),now:clock,mint:(...args)=>this.#mint(...args),open:(...args)=>this.#openCopy(...args),removePlacements:(...args)=>this.#removePlacements(...args)});
    const allowedLimits=['users','copies','packs','requests','albums','trades','copiesPerUser','packsPerUser','actionJobs','shops','listings','orders','events','commandIntents',...Object.keys(completionDefaults)];
    check(limits&&typeof limits==='object'&&!Array.isArray(limits),'INVALID_INPUT','Limits must be an object');
    for(const [name,value]of Object.entries(limits)){check(allowedLimits.includes(name),'INVALID_INPUT','Unknown installation limit '+name);integer(value,'Installation limit '+name,1,name==='completionBytes'?1073741824:10000000);}
    this.#bindings=bindings; this.#policies=policies;this.#limits={actionJobs:50000,shops:1000,listings:10000,orders:50000,commandIntents:100000,...completionDefaults,...limits};
    check(Array.isArray(eventSubscriptions)&&eventSubscriptions.length<=50,'INVALID_INPUT','At most 50 event subscriptions');
    this.#subscriptions=eventSubscriptions.map(x=>{text(x.id,'subscription ID',100);text(x.handler,'subscription handler',100);check(Array.isArray(x.events)&&x.events.every(e=>typeof e==='string'),'INVALID_INPUT','Subscription events required');return clone(x);});
    check(new Set(this.#subscriptions.map(x=>x.id)).size===this.#subscriptions.length,'INVALID_INPUT','Duplicate event subscription ID');
    this.#actions=new ActionService({store,clock,handlers:actionHandlers,options:actionOptions,limits:this.#limits});
    this.#codes=new CodeService({store,vault:codeVault,clock,generators:codeGenerators,...codeLimits,emit:(s,type,data,at)=>this.#event(s,type,data,at)});
    try{this.#codeIssuerRegistry=createCodeIssuerRegistry({allocationCodeIssuers});this.#codes.setAllocationIssuers(this.#codeIssuerRegistry.issuers);this.#codeIssuance=new GeneratedCodeIssuanceService({store,vault:codeVault,issuers:this.#codeIssuerRegistry.issuers,clock,maxCodes:codeLimits.maxCodes});
    this.#bindingFactoryRegistry=createBindingFactoryRegistry({allocationBindingFactories});this.#bindingFactories=new BindingFactoryService({store,vault:codeVault,factories:this.#bindingFactoryRegistry.factories,clock,actions:this.#actions,templates:(...args)=>this.#factoryTemplates(...args),drafts:(...args)=>this.#factoryDrafts(...args),activation:(...args)=>this.#bindingFactories.recoverActivations(...args)});this.#actions.setBindingActivation((...args)=>this.#bindingFactories.deliverActivation(...args));this.#codes.setIssuanceCustody((...args)=>this.#codeIssuance.verifyCustody(...args)+this.#bindingFactories.verifyCustody(...args));
    this.#externalPurchases=new ExternalPurchaseService({store,clock,user:(s,a)=>this.#user(s,a),capacity:s=>this.#capacity(s,true),capture:(s,u,q)=>this.#captureExternalPurchase(s,u,q),allocate:(s,row,plan)=>this.#allocateExternalPurchase(s,row,plan),cancelAllocationEffects:(s,row)=>this.#cancelExternalAllocationEffects(s,row),claimAllocation:(s,row)=>this.#claimExternalAllocation(s,row),runAllocation:(attempt,signal,evaluate)=>this.#externalAllocation?this.#externalAllocation.run(attempt,signal,evaluate):evaluate(signal??new AbortController().signal),evaluateAllocation:(...args)=>{check(this.#externalAllocation,'ALLOCATION_UNAVAILABLE','External allocation strategy is not configured',503);return this.#evaluateExternalIssuance(...args);},validateAllocation:(s,row,evaluation)=>this.#validateExternalAllocation(s,row,evaluation),completeAllocation:(s,row,plan,evaluation)=>this.#completeExternalAllocation(s,row,plan,evaluation),releaseAllocation:(s,row)=>{if(row.allocationAttemptId)this.#releaseExternalAllocation(s,row);},legacy:(s,row)=>this.#reconcileLegacyPurchase(s,row),resolveLegacy:(s,row,key)=>this.#resolveLegacyPurchase(s,row,key),resolutionCandidate:(s,row)=>this.#legacyResolutionCandidate(s,row)},{providers:externalPurchaseProviders,limits:externalPurchaseLimits});
    check(remotePolicies&&typeof remotePolicies==='object'&&!Array.isArray(remotePolicies)&&(Object.getPrototypeOf(remotePolicies)===Object.prototype||Object.getPrototypeOf(remotePolicies)===null)&&Object.keys(remotePolicies).every(hook=>['canPurchase','canList','canTransfer','canTrade'].includes(hook)),'POLICY_UNSUPPORTED','Unknown remote policy hook');
      if(Object.hasOwn(remotePolicies,'canPurchase'))this.#remotePurchasePolicy=createRemotePurchasePolicy(remotePolicies.canPurchase);
      if(Object.hasOwn(remotePolicies,'canList'))this.#remoteListingPolicy=createRemoteListingPolicy(remotePolicies.canList);
      if(Object.hasOwn(remotePolicies,'canTransfer'))this.#remoteTransferPolicy=createRemoteTransferPolicy(remotePolicies.canTransfer);
      if(Object.hasOwn(remotePolicies,'canTrade'))this.#remoteTradePolicy=createRemoteTradePolicy(remotePolicies.canTrade);
      if(remoteAllocation!==null)this.#remoteAllocation=createRemoteAllocationStrategy(remoteAllocation);
      if(remoteStockAllocation!==null)this.#remoteStockAllocation=createRemoteStockAllocationStrategy(remoteStockAllocation);
      if(remoteExternalAllocation!==null)this.#remoteExternalAllocation=createRemoteExternalAllocationStrategy(remoteExternalAllocation);
    }catch(error){this.#remotePurchasePolicy?.close();this.#remoteListingPolicy?.close();this.#remoteTransferPolicy?.close();this.#remoteTradePolicy?.close();this.#remoteAllocation?.close();this.#remoteStockAllocation?.close();this.#remoteExternalAllocation?.close();this.#codeIssuerRegistry?.close();this.#bindingFactoryRegistry?.close();throw error;}
    if(this.#remoteExternalAllocation)this.#externalAllocation=new ExternalAllocationCoordinator({provider:this.#remoteExternalAllocation,active:this.#allocationActive,clock});
    this.#transferPolicies=new TransferPolicyAdmission({canTransfer:this.#remoteTransferPolicy,canTrade:this.#remoteTradePolicy});
    if(this.#remoteAllocation)this.#allocationIntents=new AllocationIntentService({store,issuance:this.#codeIssuance,factories:this.#bindingFactories,provider:this.#remoteAllocation,clock,active:this.#allocationActive,prepare:(...args)=>this.#prepareAllocation(...args),commit:(...args)=>this.#commitAllocation(...args),reference:(...args)=>this.#commandIntents.allocationReference(...args),abandon:(...args)=>this.#commandIntents.failAllocationWithinTransaction(...args)});
    this.#commerce=new CommerceService({
      read:fn=>store.read(fn),transact:fn=>store.transact(fn),now:clock,
      raffleCommand:(actor,key,type,input,fn)=>this.#raffleRecords(actor,key,type,input,fn),
      raffleOperator:(actor,key,permission,type,input,fn)=>this.#raffleRecords(actor,key,type,input,fn,'draw'),
      raffleRead:(actor,input,fn)=>this.#raffleRecords(actor,null,null,input,fn,'read'),
      cancelListingCommand:(actor,key,type,input,fn)=>this.#cancelListingRecords(actor,key,input,fn),
      createListingCommand:(actor,key,type,input,fn,receipt,allocation)=>this.#createListingRecords(actor,key,input,fn,true,receipt,allocation),
      createListingRead:(actor,input,fn)=>this.#createListingRecords(actor,null,input,fn,false),
      allocateListingStock:(actor,key,input,options)=>{check(this.#stockAllocationIntents,'ALLOCATION_UNAVAILABLE','Stock allocation strategy is not configured',503);return this.#stockAllocationIntents.purchase(actor,key,input,options);},
      creationReceipt:(actor,key,input)=>this.#purchaseReceipt(actor,key,input,'listing.created'),
      listingRead:(actor,input,fn)=>this.#listingRecords(actor,null,input,fn,false),listingCommand:(actor,key,type,input,fn,receipt)=>this.#listingRecords(actor,key,input,fn,true,receipt),
      purchaseReceipt:(actor,key,input)=>this.#purchaseReceipt(actor,key,input),
      selectDueExpirations:(collection,at,limit)=>store.selectDueExpirations?store.selectDueExpirations(collection,at,limit):store.read(s=>Object.values(s[collection]??{}).filter(l=>l.status==='active'&&[l.endsAt,l.draw?.claimUntil].some(date=>Date.parse(date)<=Date.parse(at))).slice(0,limit).map(l=>l.id)),expireListing:(listingId,release)=>this.#expireListingRecords(listingId,release),
      user:(s,a)=>this.#user(s,a),currency:(s,id)=>this.#currency(s,id),blocked:(s,a,b)=>this.#blocked(s,a,b),
      command:(...args)=>this.#command(...args),operator:(...args)=>this.#operatorCommand(...args),
      bindingFactoryTerms:(...args)=>this.#factoryTerms(...args),mint:(...args)=>this.#mint(...args),allocatePacks:(...args)=>this.#allocatePacks(...args),
      adjust:(...args)=>this.#adjust(...args),event:(...args)=>this.#event(...args),notify:(...args)=>this.#notify(...args),
      complete:(s,kind,entityId,fn)=>this.#complete(s,kind,entityId,fn),
      workflow:(s,name,paid=false)=>this.#workflow(s,name,paid),
      copyView:(...args)=>this.#copyView(...args),packView:p=>this.#packView(p),
      transferAllowed:(s,c,from,to,channel,ignoreLock)=>{const reason=this.#tradeReason(c,from,s,{channel,toUserId:to,ignoreLock});check(!reason,'TRANSFER_BLOCKED',reason,409);},
      transferPreflight:(s,c,from,to,channel,ignoreLock)=>this.#nativePolicyRead(s,()=>{const reason=this.#tradeReason(c,from,s,{channel,toUserId:to,ignoreLock});check(!reason,'TRANSFER_BLOCKED',reason,409);}),
      resalePreflight:(s,from,to,give,receive)=>this.#nativePolicyRead(s,()=>{if(receive.currencies.length)check(this.#currency(s,receive.currencies[0].currencyId).tradable===true,'TRANSFER_BLOCKED','Resale currency is not tradable',403);this.#checkTrade(s,{channel:'sale',fromUserId:from,toUserId:to,give,receive});}),
      checkResale:(s,from,to,units,price)=>{if(price.amount>0)check(this.#currency(s,price.currencyId).tradable===true,'TRANSFER_BLOCKED','Resale currency is not tradable',403);const copyIds=units.flatMap(unit=>unit.kind==='copy'?[unit.copyId]:s.packs[unit.packId].copyIds);this.#checkTrade(s,{channel:'sale',fromUserId:from,toUserId:to,give:{copyIds,currencies:[]},receive:{copyIds:[],currencies:price.amount>0?[price]:[]}});s.users[from].lastTradeAt=this.#clock();s.users[to].lastTradeAt=this.#clock();},
      deliverCopy:(...args)=>this.#deliverCopy(...args),deliverPack:(...args)=>this.#deliverPack(...args),
      canList:policies.canList,canPurchase:policies.canPurchase,
    },{random:raffleRandom,remotePolicy:this.#remotePurchasePolicy,policyCoordinator:this.#remotePurchasePolicy?new PolicyProposalCoordinator(this.#remotePurchasePolicy):undefined,
      remoteListingPolicy:this.#remoteListingPolicy,listingPolicyCoordinator:this.#remoteListingPolicy?new PolicyProposalCoordinator(this.#remoteListingPolicy,{protocol:listingPolicyProtocol,operation:'canList',validateRequest:validateListingPolicyRequest}):undefined,transferPolicies:this.#transferPolicies});
    if(this.#remoteStockAllocation)this.#stockAllocationIntents=new AllocationIntentService({store,issuance:this.#codeIssuance,factories:this.#bindingFactories,provider:this.#remoteStockAllocation,clock,active:this.#allocationActive,command:'createListing',protocol:stockAllocationStrategyProtocol,scope:'commerce-stock',validate:validateStockAllocationStrategyRequest,validateV2:validateStockAllocationStrategyV2Request,validateV3:validateStockAllocationStrategyV3Request,validateV4:validateStockAllocationStrategyV4Request,transaction:{allocationListing:true},prepare:(...args)=>this.#prepareStockAllocation(...args),beforeEvaluate:(...args)=>this.#commerce.evaluateStockListingPolicy(...args),beforePlan:(...args)=>this.#commerce.admitStockListingPolicy(...args),beforeIssue:(...args)=>this.#commerce.assertStockListingPolicy(...args),commit:(tx,actor,row,plan,options)=>this.#commerce.commitStockAllocation(actor,row,plan,options,tx),reference:(tx,actor,key,inputDigest)=>this.#commandIntents.allocationReference(tx,actor,key,inputDigest,'createListing'),abandon:(tx,actor,row)=>{this.#stockAllocationOwner(tx,actor,row.input.shopId);return this.#commandIntents.failAllocationWithinTransaction(tx,actor,row);}});
    this.#commandIntents=new CommandIntentService({store,clock,limits:this.#limits,admit:(s,completion)=>this.#capacity(s,completion),execute:(actor,command,input)=>this[command==='preferences'?'setPreferences':command](actor,input),executeAsync:(actor,command,input,options)=>this[command==='purchase'?'purchaseAsync':command==='buyListing'?'buyListingAsync':command==='createListing'?'createListingAsync':['proposeTrade','counterTrade','acceptTrade'].includes(command)?command+'Async':command==='preferences'?'setPreferences':command](actor,input,options),completion:(s,actor,command,input)=>!!(input.key&&(s.requests[actor.userId+':'+input.key]||s.operatorRequests?.[actor.userId+':'+input.key]))||command==='openPack'&&Object.hasOwn(s.packs,input.packId)&&s.packs[input.packId]&&!s.packs[input.packId].receipt||['acceptTrade','cancelTrade'].includes(command)&&s.trades[input.tradeId]?.status==='pending'||command==='cancelListing'&&s.listings?.[input.listingId]?.status==='active'});

  }
  adminOverview(actor){return this.#administration.overview(actor);}
  configureAdmin(actor,input){return this.#administration.configure(actor,input);}
  adminUsers(actor,options){return this.#administration.users(actor,options);}
  adminUser(actor,input){return this.#administration.user(actor,input);}
  adminHistory(actor,options){return this.#administration.history(actor,options);}
  administerCards(actor,input){return this.#administration.cards(actor,input);}
  cardPolicies(actor){return this.#cardPolicies.get(actor);}
  effectiveCardPolicy(actor,input){return this.#cardPolicies.effective(actor,input);}
  saveCardPolicy(actor,input){return this.#cardPolicies.save(actor,input);}
  previewCardPolicy(actor,input){return this.#cardPolicies.preview(actor,input);}
  activateCardPolicy(actor,input){return this.#cardPolicies.activate(actor,input);}
  retireCardPolicy(actor,input){return this.#cardPolicies.retire(actor,input);}
  restoreCardPolicy(actor,input){return this.#cardPolicies.restore(actor,input);}
  saveCardResource(actor,input){return this.#cardPolicies.resource(actor,input);}
  retireCardResource(actor,input){return this.#cardPolicies.retireResource(actor,input);}
  restoreCardResource(actor,input){return this.#cardPolicies.restoreResource(actor,input);}
  updateCopyStats(actor,input){return this.#cardPolicies.updateCopyStats(actor,input);}
  registerCardPresentation(actor,archive){return this.#cardPolicies.registerPresentation(actor,archive);}
  commerceSettings(){return this.#commerce.settings();}
  configureCommerce(actor,input){return this.#commerce.configure(actor,input);}
  createShop(actor,input){return this.#commerce.createShop(actor,input);}
  setShopEnabled(actor,input){return this.#commerce.setShop(actor,input);}
  shops(actor,options){return this.#commerce.shops(actor,options);}
  createListing(actor,input){return this.#commerce.createListing(actor,input);}
  createListingAsync(actor,input,options){return this.#commerce.createListingAsync(actor,input,options);}
  listings(actor,options){return this.#commerce.listings(actor,options);}
  quoteListing(actor,input){return this.#commerce.quote(actor,input);}
  buyListing(actor,input){return this.#commerce.buy(actor,input);}
  quoteListingAsync(actor,input,options){return this.#commerce.quoteAsync(actor,input,options);}
  buyListingAsync(actor,input,options){return this.#commerce.buyAsync(actor,input,options);}
  setRemotePolicyEnabled(actor,{hook,enabled}){this.#admin(actor,['canTransfer','canTrade'].includes(hook)?'trading.manage':'commerce.manage');const provider=hook==='canPurchase'?this.#remotePurchasePolicy:hook==='canList'?this.#remoteListingPolicy:hook==='canTransfer'?this.#remoteTransferPolicy:hook==='canTrade'?this.#remoteTradePolicy:null;check(provider,'POLICY_UNSUPPORTED','Remote policy is not configured');return provider.setEnabled(enabled);}
  #purchaseReceipt(actor,key,input,type='shop.purchased'){
    text(key,'idempotency key',128);
    return this.#query(q=>{const user=this.#queryUser(q,actor),previous=q.get('requests',user.id+':'+key);if(!previous)return {found:false};check(previous.hash===fingerprint({type,input}),'IDEMPOTENCY_CONFLICT','Request key was used for another command',409);return {found:true,result:previous.result};});
  }
  orders(actor,options){return this.#commerce.orders(actor,options);}
  cancelListing(actor,input){return this.#commerce.cancel(actor,input);}
  expireListings(actor){return this.#commerce.expire(actor);}
  enterRaffle(actor,input){return this.#commerce.enter(actor,input);}
  raffleStatus(actor,input){return this.#commerce.raffleStatus(actor,input);}
  drawRaffle(actor,input){return this.#commerce.draw(actor,input);}
  drawDueRaffles(actor,{limit=20}={}){this.#admin(actor,'raffles.draw');integer(limit,'draw limit',1,100);const at=this.#clock(),ids=this.#store.selectDueRaffles?this.#store.selectDueRaffles(at,limit):this.#store.read(s=>Object.values(s.listings??{}).filter(l=>l.status==='active'&&l.raffle&&!l.draw&&Date.parse(l.raffle.entryClosesAt)<=Date.parse(at)&&(!l.endsAt||Date.parse(l.endsAt)>Date.parse(at))).slice(0,limit).map(l=>l.id)),results=[];let failure;for(const listingId of ids)try{results.push(this.drawRaffle(actor,{key:'automatic-draw:'+listingId,listingId}));}catch(error){failure??=error;}if(failure)throw failure;return results;}
  openCard(actor,{key,copyId}){return this.#command(actor,key,'card.revealed',{copyId},(s,u)=>{const copy=s.copies[copyId];check(copy?.ownerId===u.id&&copy.state==='owned','NOT_FOUND','Card not found',404);check(!copy.lockedBy,'CARD_LOCKED','Card is reserved',409);this.#openCopy(s,copy,u.id);return this.#copyView(s,copy,u.id);});}
  #openCopy(s,copy,userId){if(copy.openedAt)return;copy.openedAt=this.#clock();copy.openedBy=userId;copy.version++;openingActions(s,copy,userId,copy.openedAt);this.#event(s,'card.opened',{copyId:copy.id,userId,packId:copy.source?.packId??null,openedAt:copy.openedAt});}
  #primaryLock(copy){const lock=copy.transferLock;check(!lock||lock.until&&Date.parse(lock.until)<=Date.parse(this.#clock()),'TRANSFER_BLOCKED',lock?.reason??'Card is locked',409);}
  #assignUndisclosed(s,copy,userId){for(const codeId of copy.codeIds??[]){const row=s.codes[codeId];check(!row.revealedAt,'CODE_STATE','Stock code was already disclosed',409);row.holderId=userId;row.history.push({type:'code.assigned',at:this.#clock(),actorId:userId});}for(const binding of Object.values(copy.bindings))binding.holderId=userId;}
  #deliverCopy(s,copy,from,to,orderId,primary){
    if(primary)this.#primaryLock(copy);this.#transfer(s,copy.id,from,to,orderId);
    if(primary){this.#assignUndisclosed(s,copy,to);this.#openCopy(s,copy,to);}
    copy.metadata.acquisition={type:'shop',orderId,at:this.#clock()};this.#cleanTransferred(s,copy.id,from);
  }
  #deliverPack(s,pack,from,to,orderId){
    for(const copyId of pack.copyIds){const copy=s.copies[copyId];this.#primaryLock(copy);this.#transfer(s,copyId,from,to,orderId);this.#assignUndisclosed(s,copy,to);copy.metadata.acquisition={type:'shop',orderId,at:this.#clock()};}
    pack.ownerId=to;delete pack.lockedBy;pack.acquisition={type:'shop',orderId,from,at:this.#clock()};
  }
  #cleanTransferred(s,copyId){this.#removePlacements(s,new Set([copyId]));}
  fulfillments(actor,options){return this.#actions.history(actor,options);}
  actionJobs(actor,options){return this.#actions.history(actor,options,true);}
  retryAction(actor,input){return this.#actions.retry(actor,input);}
  claimAction(actor){return this.#actions.claim(actor);}
  settleAction(actor,input){return this.#actions.settle(actor,input);}
  dispatchActions(actor,options){return this.#actions.dispatch(actor,options);}
  tradingPolicy(){return this.#store.read(s=>s.tradingPolicy??{revision:0,policy:clone(tradingDefaults)});}
  configureTrading(actor,{key,expectedRevision,policy}){
    const clean=validateTradingPolicy(policy);
    return this.#operatorCommand(actor,key,'trading.manage','trading.configured',{expectedRevision,policy:clean},s=>{
      check((s.tradingPolicy?.revision??0)===expectedRevision,'POLICY_CHANGED','Trading policy changed',409);
      for(const currencyId of clean.allowedCurrencyIds??[])this.#currency(s,currencyId);
      s.tradingPolicy={revision:expectedRevision+1,policy:clean};return s.tradingPolicy;
    });
  }
  setCardTransferLock(actor,{key,copyId,locked=true,reason='This card cannot be transferred',until=null}){
    check(typeof locked==='boolean','INVALID_INPUT','locked must be boolean');text(reason,'lock reason',300);
    check(until===null||typeof until==='string'&&Number.isFinite(Date.parse(until))&&Date.parse(until)>Date.parse(this.#clock()),'INVALID_INPUT','Lock expiry must be in the future');
    return this.#operatorCommand(actor,key,'trading.manage','card.transfer-lock',{copyId,locked,reason,until},s=>{
      const copy=Object.hasOwn(s.copies,copyId)?s.copies[copyId]:null;check(copy,'NOT_FOUND','Card not found',404);if(locked)copy.transferLock={reason,until,at:this.#clock(),actorId:actor.userId??null};else delete copy.transferLock;copy.version++;return {copyId,version:copy.version,lock:copy.transferLock??null};
    });
  }
  #operatorCommand(actor,key,permission,type,input,fn){
    this.#admin(actor,permission);text(key,'idempotency key',128);
    return this.#store.transact(s=>{s.operatorRequests??={};const token=(actor.userId??'operator')+':'+key,hash=fingerprint({type,input}),previous=s.operatorRequests[token];if(previous){check(previous.hash===hash,'IDEMPOTENCY_CONFLICT','Operator key already used',409);return previous.result;}const result=fn(s);this.#capacity(s);this.#event(s,type,{userId:actor.userId??null});s.operatorRequests[token]={hash,result:clone(result)};return result;});
  }
  #capacity(s,completion=false){
    const context=recordContexts.get(s),baseline=context?.accounting;
    this.#admission(s);
    completionCapacity(s,this.#limits);
    for(const field of ['copies','packs','requests','albums','trades','actionJobs','shops','listings','orders'])if(this.#limits[field]!==undefined)
      check(field==='requests'?ordinaryRequestCount(s)+(completion?0:1)<=this.#limits.requests:Object.values(s[field]??{}).filter(row=>field!=='actionJobs'||!row.completionId).length+(field==='actionJobs'?baseline?.ordinaryJobs??0:baseline?.counts[field]??0)<=this.#limits[field],'INSTALLATION_CAPACITY','Installation '+field+' capacity reached',507);
    if(this.#limits.copiesPerUser!==undefined){const counts={};for(const c of Object.values(s.copies))if(c.state!=='consumed')counts[c.ownerId]=(counts[c.ownerId]??0)+1;for(const [owner,count] of Object.entries(counts))check(count+(context?.ownerCountsById?.[owner]!==undefined?context.ownerCountsById[owner].ownedCopies+context.ownerCountsById[owner].sealedCopies:context?.ownerId===owner?context.ownerCounts.ownedCopies+context.ownerCounts.sealedCopies:0)<=this.#limits.copiesPerUser,'INVENTORY_CAPACITY','Collector inventory capacity reached',507);}
    if(this.#limits.packsPerUser!==undefined){const counts={};for(const p of Object.values(s.packs))counts[p.ownerId]=(counts[p.ownerId]??0)+1;for(const [owner,count] of Object.entries(counts))check(count+(context?.ownerCountsById?.[owner]!==undefined?context.ownerCountsById[owner].packs:context?.ownerId===owner?context.ownerCounts.packs:0)<=this.#limits.packsPerUser,'PACK_CAPACITY','Collector pack capacity reached',507);}
  }
  configureCodePool(actor,input){return this.#codes.configurePool(actor,input);}
  importCodes(actor,input){return this.#codes.importBatch(actor,input);}
  codePools(actor){return this.#codes.pools(actor);}
  codeInventory(actor,options){return this.#codes.inventory(actor,options);}
  codeRegistrationMaterial(actor,codeId){return this.#codes.registrationMaterial(actor,codeId);}
  codeHistory(actor,options){return this.#codes.history(actor,options);}
  revealCode(actor,input){return this.#codes.reveal(actor,input);}
  reportCodeUsage(actor,input){return this.#codes.reportUsage(actor,input);}
  confirmCodeStatus(actor,input){return this.#codes.confirm(actor,input);}
  codeLookupMaterial(actor,codeId){return this.#codes.lookupMaterial(actor,codeId);}
  rotateCodeEncryption(actor){return this.#codes.rotateEncryption(actor);}
  verifyCodeVault(actor){return this.#codes.verifyVault(actor);}
  /** Add evidence-backed origin records to copies issued before provenance v1. */
  backfillProvenance(actor) {
    this.#admin(actor,'maintenance.run');
    return this.#store.transact(s=>{
      let count=0;
      for(const copy of Object.values(s.copies))if(!copy.provenance){
        const pack=s.packs[copy.source?.packId];
        copy.provenance={version:1,reconstructed:true,catalogVersion:pack?.catalogVersion??null,
          issuedAt:copy.createdAt,definitionDigest:contentDigest(copy.definition),variantDigest:contentDigest(copy.variant),...clone(copy.source??{})};
        if(pack)Object.assign(copy.provenance,{packId:pack.id,productId:pack.productId,productRevision:pack.productRevision,
          productDigest:pack.product?contentDigest(pack.product):null,position:pack.copyIds.indexOf(copy.id),
          purchaseId:pack.purchaseId??null,packIndex:pack.batchIndex??null});
        count++;
      }
      if(count)this.#event(s,'provenance.backfilled',{count});
      return {count};
    });
  }
  close() { this.#remotePurchasePolicy?.close();this.#remoteListingPolicy?.close();this.#remoteTransferPolicy?.close();this.#remoteTradePolicy?.close();this.#allocationIntents?.close();this.#stockAllocationIntents?.close();this.#externalAllocation?.close();this.#codeIssuerRegistry?.close();this.#codeIssuance?.close();this.#bindingFactoryRegistry?.close();this.#bindingFactories?.close();this.#store.close(); }
  codeIssuanceStatus(actor,input){return this.#codeIssuance.status(actor,input);}
  recoverCodeIssuance(actor,input,options){return this.#codeIssuance.recover(actor,input,options);}
  audit(actor){this.#admin(actor,'audit.read');return this.#store.read(auditState);}
  #admin(actor,permission) { check(hasPermission(actor,permission),'FORBIDDEN','Operator authority required: '+permission,403); }
  #user(s,actor) {
    check(actor?.disabled!==true && actor?.userId && Object.hasOwn(s.users,actor.userId),'UNAUTHENTICATED','A verified framework user is required',401);
    return s.users[actor.userId];
  }
  #catalog(s) {check(s.catalog,'NO_CATALOG','Publish a catalog first',409); return s.catalog;}
  #feature(s,name) {check(this.#catalog(s).features[name],'FEATURE_DISABLED',name+' is disabled',403);}
  #workflow(s,name,paid=false) {
    const config=this.#catalog(s).capabilities;
    check(config,'CAPABILITY_MIGRATION_REQUIRED','Publish an explicit version 1 capability profile before admitting new workflow operations',503);
    if(Array.isArray(name))name=name.find(candidate=>config.workflows[candidate])??name[0];
    const decision=admitWorkflow(config,name,{permitted:true,eligible:true,paid,ready:{issuance:true,transfer:true,settlement:true}});
    check(decision.allowed,decision.reason==='disabled'?'FEATURE_DISABLED':'CAPABILITY_UNAVAILABLE',name+' is unavailable: '+decision.reason,403);
  }
  #obligations(s,userId=null) {
    const rows=[],add=(id,workflow,principal,requirements)=>rows.push({id,workflow,principal,state:'pending',recoveryRequirements:requirements});
    for(const p of Object.values(s.packs??{}))if(!p.receipt&&(!userId||p.ownerId===userId))add(p.id,'packs',p.ownerId,['issuance']);
    for(const t of Object.values(s.trades??{}))if(t.status==='pending'&&(!userId||[t.fromUserId,t.toUserId].includes(userId)))add(t.id,'trading',t.fromUserId,workflowRequirements('trading',!!(t.give.currencies.length+t.receive.currencies.length)));
    for(const l of Object.values(s.listings??{}))if(l.status==='active'&&(!userId||l.sellerId===userId||l.entries?.[userId])){const workflow=l.kind==='mint-pack'?'packs':['mint-card','action'].includes(l.kind)?'directSales':'resale';add(l.id,workflow,l.sellerId,workflowRequirements(workflow,l.price.amount>0));}
    for(const p of Object.values(s.externalPurchases??{}))if(['prepared','allocation_pending','refund_required','quarantined'].includes(p.state)&&(!userId||p.terms.userId===userId))add(p.preparationId,'packs',p.terms.userId,['issuance','settlement']);
    return rows;
  }
  #transitionCapabilities(next,s){try{return transitionCapabilities(next,this.#obligations(s));}catch(error){check(false,'CAPABILITY_OBLIGATION',error.message,409);}}
  capabilities(actor) {
    return this.#store.read(s=>{
      const user=this.#user(s,actor),configured=this.#catalog(s).capabilities??resolveCapabilities(),migrationRequired=!this.#catalog(s).capabilities;
      const site=adminSite(s),restrictions=adminRestrictions(s,user.id),commerce=s.commerceSettings?.settings?.enabled!==false;
      const available={packs:configured.workflows.packs&&!site.packPurchasesPaused&&!restrictions.buyingBlocked,
        directSales:configured.workflows.directSales&&commerce&&!restrictions.buyingBlocked,
        trading:configured.workflows.trading&&!site.tradingPaused&&!restrictions.tradingBlocked,
        resale:configured.workflows.resale&&commerce&&!site.playerShopsPaused&&(!restrictions.buyingBlocked||!restrictions.sellingBlocked)};
      const draining=[...new Set(this.#obligations(s,user.id).map(row=>row.workflow).filter(name=>!available[name]))];
      const history={codes:Object.values(s.codes??{}).some(row=>s.copies[row.copyId]?.state!=='sealed'&&(row.holderId===user.id||row.holderHistory?.includes(user.id))),rewards:Object.values(s.actionJobs??{}).some(row=>row.userId===user.id)};
      return {version:1,configured:configured.workflows,available,draining,migrationRequired,history};
    });
  }
  workerPlan(actor) {
    this.#admin(actor,'maintenance.run');
    return this.#query(q=>{
      const revision=q.value('revision');if(this.#workerPlanCache?.revision===revision)return this.#workerPlanCache.value;
      let accounting;try{accounting=JSON.parse(q.value(recordAccountingField));}catch{}
      const value=validRecordAccounting(accounting,revision)?{actions:accounting.workers.actions>0,maintenance:accounting.workers.trades+accounting.workers.listings>0}
        :{actions:Object.values(q.value('actionJobs')??{}).some(job=>['pending','running'].includes(job.status)),maintenance:Object.values(q.value('trades')??{}).some(trade=>trade.status==='pending')||Object.values(q.value('listings')??{}).some(listing=>listing.status==='active')};
      this.#workerPlanCache={revision,value};return value;
    });
  }
  #event(s,type,data,at=this.#clock()) {
    this.#admission(s);
    const baseline=recordContexts.get(s)?.accounting,completion=completionContext(s),event={id:id(),sequence:(baseline?.counts.events??0)+s.events.length+1,type,data,at,...(completion?{completionId:completion.id}:{})};s.events.push(event);
    for(const subscription of completion?completion.subscriptions.filter(original=>this.#subscriptions.some(current=>current.id===original.id&&current.handler===original.handler&&(current.events.includes(type)||current.events.includes('*')))):this.#subscriptions)if(subscription.events.includes(type)||subscription.events.includes('*'))enqueueAction(s,{handler:subscription.handler,userId:data.userId??data.ownerId??null,params:{event:clone(event)},source:{type:'event',eventId:event.id,subscriptionId:subscription.id}},event.at);
    check(Object.values(s.actionJobs??{}).filter(row=>!row.completionId).length+(baseline?.ordinaryJobs??0)<=this.#limits.actionJobs,'INSTALLATION_CAPACITY','Action queue capacity reached',507);
    if(this.#limits.events!==undefined)check(s.events.filter(row=>!row.completionId).length+(baseline?.ordinaryEvents??0)<=this.#limits.events,'INSTALLATION_CAPACITY','Event journal capacity reached',507);
    completionCapacity(s,this.#limits);
  }
  #reserve(s,kind,entityId){
    const entity=(kind==='trade'?s.trades:kind==='listing'?s.listings:s.packs)?.[entityId];check(entity,'NOT_FOUND','Completion obligation not found',404);
    const copyIds=kind==='trade'?[...entity.give.copyIds,...entity.receive.copyIds]:kind==='pack'?entity.copyIds:(entity.units??[]).flatMap(unit=>unit.kind==='copy'?[unit.copyId]:s.packs[unit.packId]?.copyIds??[]);
    const projections=kind==='pack'?copyIds.map(id=>this.#copyView(s,s.copies[id],entity.ownerId)):[];
    return reserveCompletion(s,{kind,entity,copyIds,projections},this.#subscriptions,this.#limits);
  }
  #complete(s,kind,entityId,fn){const measure=state=>this.#store.measure?.(state)??{usedBytes:Buffer.byteLength(JSON.stringify(state))};const before=measure(s).usedBytes;return withCompletion(s,this.#reserve(s,kind,entityId),fn,measure,before);}
  #admission(s){if(!completionContext(s))check(missingCompletions(s).length+(recordContexts.get(s)?.accounting.missingCompletions??0)===0,'COMPLETION_MIGRATION_REQUIRED','Reserve existing completion obligations before admitting new work',503);}
  backfillCompletionReservations(actor){
    this.#admin(actor,'maintenance.run');
    return this.#store.transact(s=>{
      const missing=missingCompletions(s);if(!missing.length)return {count:0};
      const measure=state=>this.#store.measure?.(state)??{usedBytes:Buffer.byteLength(JSON.stringify(state))},before=measure(s).usedBytes,rows=[];
      for(const item of missing){if(item.kind==='action'){const job=s.actionJobs[item.id];reserveDelivery(s,job);rows.push(s.completionObligations[job.deliveryCompletionId]);}else rows.push(this.#reserve(s,item.kind,item.id));}
      accountReservationMetadata(s,rows,measure,before);completionCapacity(s,this.#limits);return {count:rows.length};
    });
  }
  commandIntent(actor,input,options){return this.#commandIntents.get(actor,input,options);}
  commandIntents(actor,options){return this.#commandIntents.pending(actor,options);}
  registerCommandIntent(actor,input,options){return this.#commandIntents.register(actor,input,options);}
  executeCommandIntent(actor,input,options){return this.#commandIntents.execute(actor,input,options);}
  executeCommandIntentAsync(actor,input,options){return this.#commandIntents.executeAsync(actor,input,options);}
  acknowledgeCommandIntent(actor,input,options){return this.#commandIntents.acknowledge(actor,input,options);}

  #notify(s,userId,type,data){s.notifications??=[];s.notifications.push({id:id(),userId,type,data,at:this.#clock(),read:false});const own=s.notifications.filter(n=>n.userId===userId);if(own.length>2000){const remove=new Set(own.slice(0,own.length-2000).map(n=>n.id));s.notifications=s.notifications.filter(n=>!remove.has(n.id));}}
  #preferences(user){return {inventoryVisibility:'traders',favoriteCopyIds:[],wishlistCardIds:[],blockedUserIds:[],...user.preferences};}
  #query(fn){return this.#store.query?this.#store.query(fn):this.#store.read(s=>fn(memoryQueries(s)));}
  #queryUser(q,actor){check(actor?.disabled!==true&&typeof actor?.userId==='string','UNAUTHENTICATED','A verified framework user is required',401);const user=q.get('users',actor.userId);check(user,'UNAUTHENTICATED','A verified framework user is required',401);return user;}
  #viewState(q,copies=[],userIds=[]){
    const ids=[...new Set([...userIds,...copies.flatMap(copy=>[copy.ownerId,copy.openedBy])].filter(Boolean))],codeIds=[...new Set(copies.flatMap(copy=>copy.codeIds??[]))];
    const records=(field,keys)=>{const result={};for(let i=0;i<keys.length;i+=2000)Object.assign(result,q.records(field,{ids:keys.slice(i,i+2000)}));return result;};
    return {catalog:q.value('catalog'),adminControls:q.value('adminControls'),cardAuthoring:q.value('cardAuthoring'),cardValidation:q.value('cardValidation'),tradingPolicy:q.value('tradingPolicy'),users:records('users',ids),copies:Object.fromEntries(copies.map(copy=>[copy.id,copy])),codes:records('codes',codeIds)};
  }
  #inventoryViews(s,copies,userId){return copies.map(copy=>{check(copy.ownerId===userId&&copy.state==='owned','INVALID_STATE','Indexed card ownership differs',500);const reason=this.#inventoryTradeReason(copy,userId,s);return {...this.#copyView(s,copy,userId),tradable:!reason&&!this.#remoteTransferPolicy&&!this.#remoteTradePolicy,untradableReason:reason,...(!reason&&(this.#remoteTransferPolicy||this.#remoteTradePolicy)?{remoteReviewRequired:true}:{})};});}
  me(actor){return this.#query(q=>{const u=this.#queryUser(q,actor),s={adminControls:q.value('adminControls')};return {userId:u.id,displayName:u.displayName,preferences:this.#preferences(u),adminStatus:{site:adminSite(s),restrictions:adminRestrictions(s,u.id)}};});}
  setPreferences(actor,{key,inventoryVisibility,favoriteCopyIds,wishlistCardIds,blockedUserIds}){
    const input={inventoryVisibility,favoriteCopyIds,wishlistCardIds,blockedUserIds};text(key,'idempotency key',128);
    if(!this.#store.transactRecords)return this.#command(actor,key,'preferences.updated',input,(s,u)=>this.#preferencesBody(s,u,input));
    const execute=()=>this.#store.transactRecords(tx=>{
      const user=this.#queryUser(tx,actor),token=user.id+':'+key,hash=fingerprint({type:'preferences.updated',input}),previous=tx.get('requests',token);
      if(previous){check(previous.hash===hash,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409);return previous.result;}
      let accounting;try{accounting=JSON.parse(tx.value(recordAccountingField));}catch{}check(validRecordAccounting(accounting,tx.value('revision')),'RECORD_MIGRATION_REQUIRED','Prepare revision-bound record accounting',503);
      const state={users:{[user.id]:user},copies:Object.create(null),packs:{},requests:{},events:[],catalog:wishlistCardIds===undefined?undefined:tx.value('catalog')};
      for(const [field,ids]of [['copies',favoriteCopyIds],['users',blockedUserIds]])if(Array.isArray(ids)&&ids.length<=1000&&ids.every(id=>typeof id==='string'))for(const id of ids){const row=tx.get(field,id);if(row)Object.defineProperty(state[field],id,{value:row,enumerable:true,writable:true,configurable:true});}
      const previousFavorites=clone(user.preferences?.favoriteCopyIds??[]);recordContexts.set(state,{accounting});
      try{const result=this.#preferencesBody(state,user,input);state.copies={};state.requests[token]={hash,result:clone(result)};this.#event(state,'preferences.updated',{userId:user.id});this.#capacity(state,true);
        if(favoriteCopyIds!==undefined)for(const id of new Set([...previousFavorites,...user.preferences.favoriteCopyIds])){const refs=tx.get('_copyReferences',id);check(refs,'INVALID_STATE','Copy reference projection is missing; rebuild accounting',500);refs.users=refs.users.filter(id=>id!==user.id);if(user.preferences.favoriteCopyIds.includes(id))refs.users.push(user.id);tx.put('_copyReferences',id,refs);}
        tx.put('users',user.id,user);for(const field of ['requests','actionJobs','completionObligations'])for(const [id,value]of Object.entries(state[field]??{}))tx.put(field,id,value);for(const event of state.events)tx.append('events',event);return result;
      }finally{recordContexts.delete(state);}
    },{preferences:true});
    try{return execute();}catch(error){if(error.code!=='RECORD_MIGRATION_REQUIRED')throw error;this.#store.read(state=>this.#admission(state));this.#store.prepareRecordTransactions();return execute();}
  }
  #preferencesBody(s,u,{inventoryVisibility,favoriteCopyIds,wishlistCardIds,blockedUserIds}){
      const next=this.#preferences(u);
      if(inventoryVisibility!==undefined){check(['private','traders','public'].includes(inventoryVisibility),'INVALID_INPUT','Invalid inventory visibility');next.inventoryVisibility=inventoryVisibility;}
      for(const [field,value]of Object.entries({favoriteCopyIds,wishlistCardIds,blockedUserIds}))if(value!==undefined){check(Array.isArray(value)&&value.length<=1000&&new Set(value).size===value.length&&value.every(id=>typeof id==='string'),'INVALID_INPUT','Invalid '+field);for(const id of value){if(field==='favoriteCopyIds')check(s.copies[id]?.ownerId===u.id&&s.copies[id]?.state==='owned','NOT_OWNED','Favorite must be owned',403);if(field==='wishlistCardIds')check(lookup(this.#catalog(s).cards,id),'INVALID_INPUT','Wishlist card not found');if(field==='blockedUserIds')check(Object.hasOwn(s.users,id)&&s.users[id]&&id!==u.id,'INVALID_INPUT','Block requires another user');}next[field]=value;}
      u.preferences=next;return next;
  }
  #blocked(s,a,b){return this.#preferences(s.users[a]).blockedUserIds.includes(b)||this.#preferences(s.users[b]).blockedUserIds.includes(a);}
  directory(actor,options={}){return this.#store.read(s=>{const viewer=this.#user(s,actor);return page(Object.values(s.users).filter(u=>u.id!==viewer.id&&!this.#blocked(s,viewer.id,u.id)).map(u=>({id:u.id,name:u.displayName,createdAt:u.createdAt,inventoryVisible:this.#catalog(s).features.inventoryBrowsing&&this.#preferences(u).inventoryVisibility!=='private'})),{...options,sort:'name'});});}
  #tradeReason(copy,userId,s,{channel='trade',toUserId=null,ignoreLock=false}={}){const adminReason=adminTransferReason(s,userId,toUserId,channel);if(adminReason)return adminReason;if(copy.lockedBy&&!ignoreLock)return 'Reserved by another transaction';if(!cardBehavior(copy.definition).tradable)return 'This card type is not tradable';const rule=transferPolicyReason(s,copy,channel,this.#clock());if(rule)return rule;if(Object.values(copy.bindings).some(binding=>binding.state==='activation-pending')){if(this.#inventoryPolicyReads.has(s))return 'Binding activation is pending';check(false,'BINDING_PENDING','Binding activation is pending',409);}const codeReason=codeTransferReason(s,copy);if(codeReason)return codeReason;if(Object.values(copy.bindings).some(b=>b.transfer==='block'))return 'Attached data blocks transfer';if(!this.#policyPreflights.has(s)&&this.#policies.canTransfer){const decision=this.#policies.canTransfer(clone(copy),userId,{channel,toUserId});if(decision!==true)return typeof decision==='string'?decision:'Host policy blocks transfer';}if(!this.#policyPreflights.has(s)&&!this.#inventoryPolicyReads.has(s))this.#transferPolicies.assertTransfer(s,copy.id,userId,toUserId,channel);return null;}
  #inventoryTradeReason(copy,userId,s){this.#inventoryPolicyReads.add(s);try{return this.#tradeReason(copy,userId,s);}finally{this.#inventoryPolicyReads.delete(s);}}
  #nativePolicyRead(s,fn){this.#policyPreflights.add(s);try{return fn();}finally{this.#policyPreflights.delete(s);}}
  #checkTrade(s,context){context={channel:'trade',...context};const adminReason=adminTransferReason(s,context.fromUserId,context.toUserId,context.channel);check(!adminReason,'TRANSFER_BLOCKED',adminReason,403);assertTradePolicy(s,context,this.#clock());if(!this.#policyPreflights.has(s)){this.#transferPolicies.assertTrade(s,context);}if(!this.#policyPreflights.has(s)&&this.#policies.canTrade){const result=this.#policies.canTrade(clone(context));check(result===true,'TRANSFER_BLOCKED',typeof result==='string'?result:'Host trade policy rejected offer',403);}}
  tradeInventory(actor,userId,options={}){return this.#store.read(s=>{
    const viewer=this.#user(s,actor),owner=s.users[userId];check(owner,'NOT_FOUND','Inventory not available',404);
    if(owner.id!==viewer.id){this.#feature(s,'inventoryBrowsing');check(!this.#blocked(s,viewer.id,owner.id)&&this.#preferences(owner).inventoryVisibility!=='private','NOT_FOUND','Inventory not available',404);if(this.#preferences(owner).inventoryVisibility==='traders')this.#feature(s,'cardTrading');}
    const cards=Object.values(s.copies).filter(c=>c.ownerId===owner.id&&c.state==='owned').map(c=>{const reason=this.#inventoryTradeReason(c,owner.id,s);return {...this.#copyView(s,c,viewer.id),tradable:!reason&&!this.#remoteTransferPolicy&&!this.#remoteTradePolicy,untradableReason:reason,...(!reason&&(this.#remoteTransferPolicy||this.#remoteTradePolicy)?{remoteReviewRequired:true}:{})};});
    return {owner:{id:owner.id,name:owner.displayName},...page(cards,options)};
  });}
  inventoryPage(actor,options={}){return this.#query(q=>{
    const user=this.#queryUser(q,actor);
    if(options.search||options.sort==='name'){
      // Legacy free-text and locale-name semantics operate on public projections.
      // This optional path loads the matching account inventory, not all state.
      const copies=[];let after='';do{const result=q.pageCopies({...options,search:'',sort:'ordinal',ownerId:user.id,state:'owned',limit:200,after});copies.push(...result.items);after=result.next;}while(after);
      return page(this.#inventoryViews(this.#viewState(q,copies,[user.id]),copies,user.id),options);
    }
    const result=q.pageCopies({...options,ownerId:user.id,state:'owned'}),s=this.#viewState(q,result.items,[user.id]);return {...result,items:this.#inventoryViews(s,result.items,user.id)};
  });}
  collectionSummary(actor,options={}){return this.#query(q=>{const user=this.#queryUser(q,actor),result=q.variantCounts({...options,ownerId:user.id}),copies=Object.values(q.records('copies',{ids:result.items.map(row=>row.copyId)})),s=this.#viewState(q,copies,[user.id]),views=new Map(this.#inventoryViews(s,copies,user.id).map(copy=>[copy.id,copy]));return {...result,items:result.items.map(({copyId,...row})=>({...row,card:views.get(copyId)}))};});}
  notifications(actor,options={}){return this.#query(q=>{const user=this.#queryUser(q,actor);return page(q.notifications(user.id),options);});}
  readNotifications(actor,{key,ids}){check(Array.isArray(ids)&&ids.length<=200,'INVALID_INPUT','Select at most 200 notifications');return this.#command(actor,key,'notifications.read',{ids},(s,u)=>{for(const n of s.notifications??[])if(n.userId===u.id&&ids.includes(n.id))n.read=true;return {ok:true};});}
  #command(actor,key,type,input,fn,receipt) {
    text(key,'idempotency key',128);
    return this.#store.transact(s=>{
      const user=this.#user(s,actor), token=user.id+':'+key, hash=fingerprint({type,input});
      if(type==='packs.purchased')check(!Object.values(s.externalPurchases??{}).some(row=>row.terms.userId===user.id&&row.legacy?.purchaseKey===key),'EXTERNAL_PURCHASE_STATE','Legacy purchase is managed by external reconciliation',409);
      const previous=s.requests[token];
      if (previous) {check(previous.hash===hash,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409); return previous.result;}
      const pending=(type==='trade.cancelled'||type==='trade.accepted')&&s.trades[input.tradeId]?.status==='pending'?['trade',input.tradeId]:type==='listing.canceled'&&s.listings?.[input.listingId]?.status==='active'?['listing',input.listingId]:type==='pack.opened'&&s.packs[input.packId]&&!s.packs[input.packId].receipt?['pack',input.packId]:null;
      const execute=()=>{
        const result=fn(s,user);
        if(type==='trade.proposed'||type==='trade.countered')this.#reserve(s,'trade',result.id);
        if(type==='listing.created')this.#reserve(s,'listing',result.id);
        if(type==='shop.purchased'&&s.listings[input.listingId]?.units.every(unit=>unit.status!=='available')){const row=s.completionObligations?.['listing:'+input.listingId];if(row)row.status='completed';}
        const completion=completionContext(s);s.requests[token]={hash,result:clone(result),...(completion?{completionId:completion.id}:{}),...(receipt?.policyAdmission?{policyAdmission:clone(receipt.policyAdmission)}:{}),...(receipt?.policyAdmissions?{policyAdmissions:clone(receipt.policyAdmissions)}:{})};
        this.#event(s,type,{userId:user.id});this.#capacity(s,true);return result;
      };
      return pending?this.#complete(s,...pending,execute):execute();
    });
  }
  #validateRevision(catalog,previous) {
      if (previous) {
        check(catalog.version>previous.version,'CATALOG_CONFLICT','Catalog version must increase',409);
        // Published IDs retain identity; retirement uses enabled:false. Old owned copies use snapshots.
        for (const section of ['currencies','lines','rarities','cards','variants','products','recipes']) {
          for (const old of previous[section]) {
            const next=lookup(catalog[section],old.id);
            check(next,'CATALOG_CONFLICT','Retain published '+section+' id '+old.id,409);
            if (section==='variants') check(next.cardId===old.cardId && next.rarityId===old.rarityId && next.supplyLimit===old.supplyLimit,'CATALOG_CONFLICT','Variant identity/edition limits are immutable',409);
            if (section==='cards') check(next.lineId===old.lineId,'CATALOG_CONFLICT','Card line identity is immutable',409);
            if (section==='products' && fingerprint(next)!==fingerprint(old)) check(next.revision>old.revision,'CATALOG_CONFLICT','Changed product needs a higher revision',409);
          }
        }
      }
  }
  publishCatalog(actor,manifest) {
    this.#admin(actor,'catalog.publish'); const catalog=validateCatalog(manifest);
    return this.#store.transact(s=>{
      check(!s.catalog||s.catalog.capabilities||Object.hasOwn(manifest,'capabilities'),'CAPABILITY_MIGRATION_REQUIRED','Include an explicit version 1 capability profile when migrating an installed catalog',503);
      this.#validateRevision(catalog,s.catalog);
      this.#transitionCapabilities(catalog.capabilities,s);
      s.cardValidation={...s.cardValidation,...validateGovernedCatalog(s,catalog,{actor})};
      if(s.catalog)invalidateAdminReview(s);s.catalog=catalog;for(const product of catalog.products)effectiveProduct(s,product); this.#event(s,'catalog.published',{version:catalog.version});
      return this.#publicCatalog(catalog,s);
    });
  }
  operatorCatalog(actor){this.#admin(actor,'catalog.read');return this.#store.read(s=>this.#catalog(s));}
  previewImport(actor,input){this.#admin(actor,'catalog.preview');return this.#store.read(s=>{const preview=prepareImport({...input,base:s.catalog});this.#validateRevision(preview.manifest,s.catalog);validateGovernedCatalog(s,preview.manifest,{actor});for(const product of preview.manifest.products)effectiveProduct({...s,catalog:preview.manifest},product);return {...preview,policyRevision:s.cardAuthoring?.revision??0};});}
  commitImport(actor,{key,manifest,digest,expectedVersion,policyRevision}) {
    this.#admin(actor,'catalog.publish');text(key,'import key',128);
    return this.#store.transact(s=>{
      s.operatorRequests??={};const token=(actor.userId??'operator')+':'+key,inputHash=contentDigest({manifest,digest,expectedVersion,policyRevision:policyRevision??0});
      if(s.operatorRequests[token]){check(s.operatorRequests[token].hash===inputHash,'IDEMPOTENCY_CONFLICT','Import key already used',409);return s.operatorRequests[token].result;}
      if(this.#limits.requests!==undefined)check(ordinaryRequestCount(s)<this.#limits.requests,'INSTALLATION_CAPACITY','Installation requests capacity reached',507);
      check((s.catalog?.version??0)===expectedVersion,'STALE_IMPORT','Catalog changed; preview again',409);
      check((s.cardAuthoring?.revision??0)===(policyRevision??0),'POLICY_CHANGED','Card policy changed; preview again',409);
      const catalog=validateCatalog(manifest);check(contentDigest(catalog)===digest,'IMPORT_CHANGED','Preview differs from the submitted catalog',409);
      this.#validateRevision(catalog,s.catalog);this.#transitionCapabilities(catalog.capabilities,s);s.cardValidation={...s.cardValidation,...validateGovernedCatalog(s,catalog,{actor})};if(s.catalog)invalidateAdminReview(s);s.catalog=catalog;for(const product of catalog.products)effectiveProduct(s,product);
      this.#event(s,'catalog.imported',{version:catalog.version,userId:actor.userId??null,digest});
      const result={version:catalog.version,digest,importedAt:this.#clock()};s.operatorRequests[token]={hash:inputHash,result};return result;
    });
  }
  #publicCatalog(c,s) {
    const result=clone(c);result.products=c.products.map(product=>effectiveProduct(s,product));result.adminStatus={revision:adminRevision(s),site:adminSite(s)};
    for(const card of result.cards)redactGovernedCard(s,card);
    for(const variant of result.variants)if(variant.stats){const card=result.cards.find(c=>c.id===variant.cardId);variant.stats=redactGovernedCard(s,{...card,stats:variant.stats},'variant','public',s.cardValidation?.[variant.id]?.fields).stats;}
    for (const v of result.variants) for (const [name,b] of Object.entries(v.bindings)) {
      if (b.visibility==='owner') {delete b.data; delete b.factory;}
    }
    return result;
  }
  catalog() {return this.#query(q=>{const s=this.#viewState(q);return this.#publicCatalog(this.#catalog(s),s);});}
  catalogVersion(){return this.#query(q=>q.get('catalog','version')??0);}
  userByIdentity(actor,{provider,subject}){this.#admin(actor,'accounts.register');text(provider,'identity provider',2048);text(subject,'identity subject',300);return this.#query(q=>q.userByIdentity(provider,subject)??null);}
  providerIdentity(actor,userId){this.#admin(actor,'accounts.register');text(userId,'user ID',100);return this.#query(q=>q.providerIdentity(userId)??null);}
  registerUser(actor,{provider,subject,displayName}) {
    this.#admin(actor,'accounts.register'); text(provider,'identity provider',2048); text(subject,'identity subject',300); text(displayName,'display name',100);
    const unchanged=this.#query(q=>q.userByIdentity(provider,subject));
    if(unchanged?.displayName===displayName)return unchanged;
    return this.#store.transact(s=>{
      const existing=Object.values(s.users).find(u=>u.provider===provider && u.subject===subject);
      if (existing) {existing.displayName=displayName; return existing;}
      if(this.#limits.users!==undefined)check(Object.keys(s.users).length<this.#limits.users,'INSTALLATION_CAPACITY','Installation user capacity reached',507);
      const user={id:id(),provider,subject,displayName,createdAt:this.#clock()};
      s.users[user.id]=user; s.balances[user.id]={};
      this.#event(s,'user.registered',{userId:user.id});
      return user;
    });
  }
  grantCurrency(actor,{userId,currencyId,amount,reason,key}) {
    this.#admin(actor,'currency.grant'); integer(amount,'grant amount'); text(reason,'grant reason');
    return this.#command({userId},key,'currency.granted',{currencyId,amount,reason},s=>{
      this.#currency(s,currencyId); this.#adjust(s,userId,currencyId,amount,'grant',reason);
      return {userId,currencyId,amount,balance:s.balances[userId][currencyId]};
    });
  }
  settleExternalCredit(actor, input) {
    this.#admin(actor, 'currency.settle');
    const {providerId,transactionId,userId,currencyId,amount,externalCurrency,externalUnits}=input;
    for(const [name,value] of Object.entries({providerId,transactionId,userId,currencyId,externalCurrency,externalUnits})) text(value,name,300);
    integer(amount,'external credit amount',1,Number.MAX_SAFE_INTEGER);
    check(/^[1-9][0-9]{0,39}$/.test(externalUnits),'INVALID_INPUT','Invalid external units');
    const token=fingerprint({providerId,transactionId}), hash=fingerprint({userId,currencyId,amount,externalCurrency,externalUnits});
    return this.#store.transact(s=>{
      check(!s.externalPurchases?.['ep_'+fingerprint({providerId,transactionId})],'EXTERNAL_PURCHASE_STATE','Use the existing external purchase lifecycle',409);
      this.#user(s,{userId});this.#currency(s,currencyId);s.externalSettlements??={};
      const old=s.externalSettlements[token];
      if(old){check(old.hash===hash,'SETTLEMENT_CONFLICT','External transaction already credited with different terms',409);return old.result;}
      if(this.#limits.requests!==undefined)check(ordinaryRequestCount(s)<this.#limits.requests,'INSTALLATION_CAPACITY','Settlement capacity reached',507);
      this.#adjust(s,userId,currencyId,amount,'external-credit',token);
      const result={providerId,transactionId,userId,currencyId,amount,balance:s.balances[userId][currencyId],at:this.#clock()};
      s.externalSettlements[token]={hash,result,externalCurrency,externalUnits};
      this.#event(s,'currency.external-settled',{providerId,transactionId,userId,currencyId,amount});
      return result;
    });
  }
  #currency(s,currencyId) {
    const currency=lookup(this.#catalog(s).currencies,currencyId);
    check(currency,'UNKNOWN_CURRENCY','Currency not found',404); return currency;
  }
  prepareExternalPurchase(actor,input){return this.#externalPurchases.prepare(actor,input);}
  commitExternalPurchase(actor,input){return this.#externalPurchases.commit(actor,input);}
  commitExternalPurchaseAsync(actor,input,options){return this.#externalPurchases.commitAsync(actor,input,options);}
  setRemoteExternalAllocationEnabled(actor,{enabled}){this.#admin(actor,'commerce.manage');check(this.#remoteExternalAllocation,'ALLOCATION_UNAVAILABLE','External allocation strategy is not configured',503);return this.#remoteExternalAllocation.setEnabled(enabled);}
  cancelExternalPurchase(actor,input){return this.#externalPurchases.cancel(actor,input);}
  confirmExternalCompensation(actor,input){return this.#externalPurchases.compensate(actor,input);}
  externalPurchaseStatus(actor,input){return this.#externalPurchases.status(actor,input);}
  lookupExternalPurchase(actor,input){return this.#externalPurchases.lookup(actor,input);}
  pendingExternalPurchases(actor,input){return this.#externalPurchases.pending(actor,input);}
  reconcileLegacyExternalPurchase(actor,input){return this.#externalPurchases.legacy(actor,input);}
  resolveLegacyExternalPurchase(actor,input){return this.#externalPurchases.resolveLegacy(actor,input);}
  #captureExternalPurchase(s,user,quote,{recovery=false}={}){
    const catalog=this.#catalog(s),base=lookup(catalog.products,quote.productId);
    check(base&&base.enabled!==false,'UNAVAILABLE','Pack product unavailable',404);
    assertAdminPurchase(s,user.id,base);const product=effectiveProduct(s,base);this.#productTime(product);
    if(!recovery)this.#workflow(s,'packs',product.price.amount>0);
    check(quote.quantity<=product.maxQuantity,'INVALID_INPUT','Quantity exceeds product limit');
    const factorySnapshot=product.allocationStrategy?.version>=3?this.#bindingFactories.prepare(user,[...new Set(product.slots.flatMap(slot=>slot.pool.map(entry=>entry.variantId)))].map(id=>lookup(catalog.variants,id)),product,quote.quantity):null;const expected={...(factorySnapshot?.activationMaximum?{bindingActivation:{maximum:factorySnapshot.activationMaximum}}:{}),productId:product.id,quantity:quote.quantity,productRevision:product.revision,catalogVersion:catalog.version,adminRevision:adminRevision(s),price:{currencyId:product.price.currencyId,amount:product.price.amount*quote.quantity},...(product.allocationStrategy?{allocationDigest:this.#allocationDigest(product,quote.quantity,catalog)}:{})};
    check(fingerprint(expected)===fingerprint(quote),'STALE_QUOTE','Get a fresh quote before buying',409);
    const maxCopies=product.slots.reduce((total,slot)=>total+slot.count,0)*quote.quantity;
    for(const [field,count,added]of [['copies',Object.keys(s.copies).length,maxCopies],['packs',Object.keys(s.packs).length,quote.quantity],['copiesPerUser',Object.values(s.copies).filter(c=>c.ownerId===user.id&&c.state!=='consumed').length,maxCopies],['packsPerUser',Object.values(s.packs).filter(p=>p.ownerId===user.id).length,quote.quantity]])if(this.#limits[field]!==undefined)check(count+added<=this.#limits[field],'INSTALLATION_CAPACITY','Purchase exceeds '+field+' capacity',507);
    let allocation;if(product.allocationStrategy){check(!recovery,'ALLOCATION_UNSUPPORTED','Legacy weighted allocation recovery is not supported',409);check(this.#externalAllocation,'ALLOCATION_UNAVAILABLE','External allocation strategy is not configured',503);const variants=[...new Set(product.slots.flatMap(slot=>slot.pool.map(e=>e.variantId)))].map(id=>catalog.variants.find(v=>v.id===id));const resources=product.allocationStrategy.version>=3?this.#loadAllocationCodes(s,variants,product,quote.quantity):null;allocation={...(factorySnapshot?{factorySnapshot}:{}),context:this.#allocationContext(s,user,variants,product,quote.quantity,'personalized',resources),...(resources?{codeSnapshot:resources.codeSnapshot}:{}),snapshotDigest:this.#externalAllocationDigest(s,product,user.id,resources?.codeSnapshot,quote.quantity)};}
    const readiness=allocation?.codeSnapshot?{...s,allocationIssuanceReady:!!allocation.codeSnapshot.generated,codes:Object.fromEntries(allocation.codeSnapshot.pools.flatMap(p=>p.prefix.map(e=>[e.codeId,s.codes[e.codeId]])))}:s;this.#assertExternalAllocationReady(readiness,user,product,quote.quantity);
    return {catalog:clone(catalog),product:clone(product),cardValidation:clone(s.cardValidation??{}),...(allocation?{allocation}:{})};
  }
  #assertExternalAllocationReady(s,user,product,quantity){
    const catalog=this.#catalog(s),at=this.#clock(),checked=new Set(),readiness=new Map(),guaranteedCodes=new Map(),guaranteedVariants=new Map();let minimumGeneratedTotal=0;
    for(const slot of product.slots){
      if(slot.probability?.numerator===0)continue;
      let available=this.#available(s,slot.pool);
      if(slot.role!=='insert'&&product.duplicatePolicy.scope==='inventory'&&product.duplicatePolicy.fallback!=='allow'){
        const owned=new Set(Object.values(s.copies).filter(copy=>copy.ownerId===user.id&&['sealed','owned'].includes(copy.state)).map(copy=>copy.cardId));
        available=available.filter(entry=>!owned.has(lookup(catalog.variants,entry.variantId).cardId));
      }
      const mandatory=!slot.probability||slot.probability.numerator===slot.probability.denominator;
      check(!mandatory||available.length,'POOL_EXHAUSTED','No eligible card remains in this pack slot',409);
      const variants=available.map(entry=>lookup(catalog.variants,entry.variantId));
      for(const variant of variants)if(!checked.has(variant.id)){
        checked.add(variant.id);
        for(const spec of Object.values(variant.bindings??{}))if(spec.factory){
          if(product.allocationStrategy?.version>=3&&this.#bindingFactoryRegistry.factories[spec.factory])continue;const factory=Object.hasOwn(this.#bindings,spec.factory)&&this.#bindings[spec.factory];
          check(typeof factory==='function','MISSING_PROVIDER','Binding factory unavailable: '+spec.factory,409);
          check(!utilTypes.isAsyncFunction(factory)&&!utilTypes.isGeneratorFunction(factory)&&!['[object AsyncFunction]','[object GeneratorFunction]','[object AsyncGeneratorFunction]'].includes(Object.prototype.toString.call(factory)),'INVALID_PROVIDER','Binding factories must return synchronously',500);
        }
        const governed=s.cardValidation?.[variant.id];
        if(governed?.fields.some(field=>field.scope==='copy')){
          const fields=governed.fields,defaults=Object.fromEntries(fields.filter(field=>field.scope==='copy'&&(Object.hasOwn(field,'default')||Object.hasOwn(field,'fixed'))).map(field=>[field.key,clone(Object.hasOwn(field,'fixed')?field.fixed:field.default)]));
          const stats=deriveStats(fields,defaults,'copy'),policy={fields,defaults:{},requirements:{},references:governed.policies,provenance:{}};
          check(!inspectCardPolicy(policy,{copy:{stats}}).length,'COPY_STATS','Required copy stats need valid issuance defaults',409);
        }
        readiness.set(variant.id,this.#codes.assertAllocationReady(s,variant.codes??[],at));
      }
      if(mandatory&&variants.length){
        const draws=slot.count*quantity;
        minimumGeneratedTotal+=Math.min(...variants.map(variant=>readiness.get(variant.id).generatedCodes))*draws;
        if(variants.length===1)guaranteedVariants.set(variants[0].id,(guaranteedVariants.get(variants[0].id)??0)+draws);
        const pools=new Set(variants.flatMap(variant=>(variant.codes??[]).map(spec=>spec.poolId)));
        for(const poolId of pools){const count=Math.min(...variants.map(variant=>(variant.codes??[]).filter(spec=>spec.poolId===poolId).length))*draws;if(count)guaranteedCodes.set(poolId,(guaranteedCodes.get(poolId)??0)+count);}
      }
    }
    for(const [variantId,count]of guaranteedVariants){const variant=lookup(catalog.variants,variantId);check(variant.supplyLimit===undefined||(s.supply[variantId]??0)+count<=variant.supplyLimit,'SOLD_OUT','Edition cannot satisfy this purchase',409);}
    const specs=[];for(const [poolId,count]of guaranteedCodes)for(let n=0;n<count;n++)specs.push({poolId});
    this.#codes.assertAllocationReady(s,specs,at);
    if(minimumGeneratedTotal>0)this.#codes.assertGeneratedCapacity(s,minimumGeneratedTotal);
  }
  #allocateExternalPurchase(s,row,plan){
    const attempt=row.allocationAttemptId?s.allocationAttempts[row.allocationAttemptId]:null;
    if(attempt?.factorySnapshot)return this.#bindingFactories.within(s,tx=>{const reservation=tx.get('bindingFactoryReservations',attempt.id);tx.reserveTradeCompletion('binding-factory:'+reservation.batchId);return this.#allocateExternalPurchaseBody(s,row,plan);});
    return this.#allocateExternalPurchaseBody(s,row,plan);
  }
  #allocateExternalPurchaseBody(s,row,plan){
    const user=this.#user(s,{userId:row.terms.userId});
    check(!adminRestrictions(s,user.id).buyingBlocked,'ACCOUNT_RESTRICTED','This account cannot buy',403);
    check(row.snapshot,'STALE_QUOTE','Original allocation terms are unavailable',409);
    const currentCatalog=s.catalog,currentValidation=s.cardValidation;
    s.catalog=clone(row.snapshot.catalog);s.cardValidation=clone(row.snapshot.cardValidation);
    const attempt=row.allocationAttemptId?s.allocationAttempts[row.allocationAttemptId]:null,generated=attempt?.codeSnapshot?.generated?.length?this.#codeIssuance.within(s,tx=>this.#codeIssuance.admission(tx,attempt)):null,factory=attempt?.factorySnapshot?this.#bindingFactories.within(s,tx=>this.#bindingFactories.admission(tx,attempt)):null;
    if(plan)this.#allocationAdmissions.set(s,{productId:row.snapshot.product.id,quantity:row.terms.quote.quantity,plan,scope:'external-fulfillment',selection:factory?.selection??generated?.batch.selection,factoryCopies:factory?.copies});
    const codes=this.#codes.admitAllocation(s,attempt?.codeSnapshot,generated);try{
      const purchaseId=this.#allocationAdmissions.get(s)?.selection?.purchaseId??id(),packs=this.#allocatePacks(s,user,row.snapshot.product,row.terms.quote.quantity,{purchaseId,externalPreparationId:row.preparationId});
      if(codes)attempt.codeAssignments=clone(codes.assignments);this.#event(s,'packs.purchased',{userId:user.id,preparationId:row.preparationId,purchaseId});
      return {id:purchaseId,packs,paid:clone(row.terms.quote.price),...(factory?.deferred?{bindingActivation:{state:'pending',count:factory.deferred}}:{})};
    }finally{this.#codes.releaseAllocation(s);this.#allocationAdmissions.delete(s);s.catalog=currentCatalog;if(currentValidation===undefined)delete s.cardValidation;else s.cardValidation=currentValidation;}
  }
  #externalAllocationDigest(s,product,userId,codeSnapshot,quantity=1){const ids=[...new Set(product.slots.flatMap(slot=>slot.pool.map(e=>e.variantId)))];const factoryTerms=this.#factoryTerms(product,s.catalog);return contentDigest({product,...(factoryTerms.length?{factoryTerms}:{}),catalogVersion:s.catalog.version,adminControls:s.adminControls,cardAuthoringRevision:s.cardAuthoring?.revision??0,supply:ids.map(id=>[id,s.supply[id]??0]),cardValidation:ids.map(id=>[id,s.cardValidation?.[id]??null]),...(product.allocationStrategy.version>=3?{codeSnapshot:codeSnapshot??this.#loadAllocationCodes(s,ids.map(id=>lookup(s.catalog.variants,id)),product,quantity).codeSnapshot}:{}),...(product.allocationStrategy.version>=2?{eligibility:this.#allocationEligibility(s,userId,ids.map(id=>lookup(s.catalog.variants,id)),product)}:{})});}
  #claimExternalAllocation(s,row){check(this.#externalAllocation,'ALLOCATION_UNAVAILABLE','External allocation strategy is not configured',503);this.#externalAllocation.claim(s,row);const attempt=s.allocationAttempts[row.allocationAttemptId];if(attempt.codeSnapshot?.generated?.length){const reserved=this.#codeIssuance.within(s,tx=>this.#codeIssuance.reserve(tx,attempt));row.codeIssuanceBatchId=reserved.batchId;}if(attempt.factorySnapshot){const reserved=this.#bindingFactories.within(s,tx=>this.#bindingFactories.reserve(tx,attempt));row.bindingFactoryBatchId=reserved.batchId;}}
  #cancelExternalAllocationEffects(s,row){const attempt=s.allocationAttempts?.[row.allocationAttemptId];if(attempt?.codeSnapshot?.generated?.length)this.#codeIssuance.within(s,tx=>this.#codeIssuance.cancel(tx,attempt));if(attempt?.factorySnapshot)this.#bindingFactories.within(s,tx=>this.#bindingFactories.cancel(tx,attempt));}
  #completeExternalAllocation(s,row,plan,evaluation){const attempt=s.allocationAttempts[row.allocationAttemptId];this.#externalAllocation.complete(s,row,plan,evaluation);if(attempt.codeSnapshot?.generated?.length)this.#codeIssuance.within(s,tx=>this.#codeIssuance.complete(tx,this.#codeIssuance.admission(tx,attempt)));if(attempt.factorySnapshot)this.#bindingFactories.within(s,tx=>this.#bindingFactories.complete(tx,this.#bindingFactories.admission(tx,attempt)));}
  async #evaluateExternalIssuance(attempt,signal){const evaluation=await this.#externalAllocation.evaluate(attempt,signal);if(!attempt.codeSnapshot?.generated?.length&&!attempt.factorySnapshot)return evaluation;
    const assertLive=tx=>{if(tx){const row=tx.get('externalPurchases',attempt.preparationId);check(row?.state==='allocation_pending','ALLOCATION_STALE','Paid allocation is no longer pending',409);const {state}=this.#allocationState(tx,{userId:attempt.userId},{productId:attempt.productId,quantity:attempt.context.quantity});state.allocationAttempts={[attempt.id]:tx.get('allocationAttempts',attempt.id)};state.allocationHeads={[attempt.headId]:tx.get('allocationHeads',attempt.headId)};this.#validateExternalAllocation(state,row,evaluation,state.allocationCodeResources?.codeSnapshot);this.#bindingFactories.assertSnapshot(tx,attempt);}this.#remoteExternalAllocation.assertGrant(evaluation.request);check(!signal.aborted,'POLICY_ABORTED','Paid allocation was cancelled',503);check(Date.now()<evaluation.request.deadline,'POLICY_TIMEOUT','Paid allocation admission expired',504);};
    const stage=service=>this.#store.transact(s=>{const row=s.externalPurchases[attempt.preparationId];check(row?.state==='allocation_pending','EXTERNAL_PURCHASE_STATE','Paid allocation is no longer pending',409);const plan=this.#validateExternalAllocation(s,row,evaluation);return service.within(s,tx=>{this.#bindingFactories.assertSnapshot(tx,attempt);return service.select(tx,attempt,plan);});});
    const codeBatch=attempt.codeSnapshot?.generated?.length?stage(this.#codeIssuance):null,factoryBatch=attempt.factorySnapshot?stage(this.#bindingFactories):null;
    if(factoryBatch)await this.#bindingFactories.prepareResults(factoryBatch,{signal,assertLive});if(codeBatch)await this.#codeIssuance.issue(codeBatch,{signal,assertLive});return evaluation;
  }
  #validateExternalAllocation(s,row,evaluation,codeSnapshot){const user=this.#user(s,{userId:row.terms.userId});check(row.snapshot,'ALLOCATION_STALE','Paid allocation snapshot is unavailable',409);assertAdminPurchase(s,user.id,row.snapshot.product);this.#workflow(s,'packs',row.snapshot.product.price.amount>0);this.#productTime(row.snapshot.product);return this.#externalAllocation.assert(s,row,evaluation,this.#externalAllocationDigest(s,row.snapshot.product,user.id,codeSnapshot,row.terms.quote.quantity));}
  #releaseExternalAllocation(s,row){const attempt=s.allocationAttempts?.[row.allocationAttemptId];check(attempt?.preparationId===row.preparationId&&attempt.userId===row.terms.userId,'EXTERNAL_PURCHASE_INVARIANT','Paid allocation attempt differs',500);check(attempt.state==='prepared'||attempt.state==='acknowledged','EXTERNAL_PURCHASE_STATE','Delivered allocation cannot be abandoned',409);this.#cancelExternalAllocationEffects(s,row);if(attempt.state==='prepared'){attempt.state='acknowledged';attempt.acknowledgedAt=this.#clock();}const head=s.allocationHeads[attempt.headId];if(head?.attemptId===attempt.id)head.attemptId=null;}
  #reconcileLegacyPurchase(s,row){
    const terms=row.terms,quote=terms.quote,token=fingerprint({providerId:terms.providerId,transactionId:terms.transactionId});
    const settlement=s.externalSettlements?.[token],request=s.requests[terms.userId+':'+row.legacy.purchaseKey];
    const expectedSettlement=fingerprint({userId:terms.userId,currencyId:quote.price.currencyId,amount:quote.price.amount,externalCurrency:terms.externalCurrency,externalUnits:terms.externalUnits});
    const credits=s.ledger.filter(entry=>entry.type==='external-credit'&&entry.reference===token);
    if(settlement&&(settlement.hash!==expectedSettlement||settlement.externalCurrency!==terms.externalCurrency||settlement.externalUnits!==terms.externalUnits||settlement.result?.providerId!==terms.providerId||settlement.result?.transactionId!==terms.transactionId||settlement.result?.userId!==terms.userId||settlement.result?.currencyId!==quote.price.currencyId||settlement.result?.amount!==quote.price.amount))return {quarantine:'LEGACY_SETTLEMENT_CONFLICT'};
    if(settlement&&(credits.length!==1||credits[0].userId!==terms.userId||credits[0].currencyId!==quote.price.currencyId||credits[0].delta!==quote.price.amount||!Number.isSafeInteger(settlement.result.balance)||settlement.result.balance<0||settlement.result.balance!==credits[0].balance))return {quarantine:'LEGACY_CREDIT_EVIDENCE'};
    if(!settlement&&credits.length)return {quarantine:'LEGACY_CREDIT_EVIDENCE'};
    if(request){
      const input={productId:quote.productId,quantity:quote.quantity,productRevision:quote.productRevision,catalogVersion:quote.catalogVersion};
      const hashes=[fingerprint({type:'packs.purchased',input}),fingerprint({type:'packs.purchased',input:{...input,adminRevision:quote.adminRevision}})];
      const result=request.result,debits=s.ledger.filter(entry=>entry.type==='purchase'&&entry.reference===result?.id);
      if(!settlement||!hashes.includes(request.hash)||!result?.paid||fingerprint(result.paid)!==fingerprint(quote.price)||typeof result?.id!=='string'||!Array.isArray(result?.packs)||result.packs.length!==quote.quantity||new Set(result.packs.map(pack=>pack?.id)).size!==quote.quantity||debits.length!==1||debits[0].userId!==terms.userId||debits[0].currencyId!==quote.price.currencyId||debits[0].delta!==-quote.price.amount)return {quarantine:'LEGACY_PURCHASE_CONFLICT'};
      if(s.ledger.indexOf(debits[0])<=s.ledger.indexOf(credits[0]))return {quarantine:'LEGACY_PURCHASE_CONFLICT'};
      if(Object.values(s.externalPurchases??{}).some(other=>other.preparationId!==row.preparationId&&other.purchase?.id===result.id)||Object.entries(s.requests).some(([key,receipt])=>key!==terms.userId+':'+row.legacy.purchaseKey&&receipt.result?.id===result.id))return {quarantine:'LEGACY_PURCHASE_ALREADY_BOUND'};
      for(const receipt of result.packs){
        const pack=s.packs[receipt?.id];
        if(!pack||!receipt||receipt.ownerId!==terms.userId||receipt.purchaseId!==result.id||pack.purchaseId!==result.id||pack.productId!==quote.productId||receipt.productId!==pack.productId||pack.productRevision!==quote.productRevision||receipt.productRevision!==pack.productRevision||pack.catalogVersion!==quote.catalogVersion||receipt.catalogVersion!==pack.catalogVersion||!Array.isArray(pack.copyIds)||new Set(pack.copyIds).size!==pack.copyIds.length||receipt.cardCount!==pack.copyIds.length||!receipt.product||!pack.product||fingerprint(receipt.product)!==fingerprint(pack.product)||pack.product?.price?.currencyId!==quote.price.currencyId||pack.product.price.amount*quote.quantity!==quote.price.amount)return {quarantine:'LEGACY_DELIVERY_EVIDENCE'};
        for(const copyId of pack.copyIds){const copy=s.copies[copyId];if(!copy||copy.source?.packId!==pack.id||copy.source?.purchaseId!==result.id||(!pack.openedAt&&(copy.state!=='sealed'||copy.ownerId!==pack.ownerId))||(copy.codeIds??[]).some(codeId=>s.codes?.[codeId]?.copyId!==copyId))return {quarantine:'LEGACY_DELIVERY_EVIDENCE'};}
      }
      return {purchase:request.result};
    }
    if(settlement){
      const entries=s.ledger.filter(entry=>entry.userId===terms.userId&&entry.currencyId===quote.price.currencyId);
      if(entries.slice(entries.indexOf(credits[0])+1).some(entry=>entry.delta<0)||(s.balances[terms.userId]?.[quote.price.currencyId]??0)<quote.price.amount)return {quarantine:'LEGACY_CREDIT_SPENT'};
      this.#adjust(s,terms.userId,quote.price.currencyId,-quote.price.amount,'external-credit-reversed',row.preparationId);
      row.legacy.reversedCredit=true;
    }
    try{return {snapshot:this.#captureExternalPurchase(s,this.#user(s,{userId:terms.userId}),quote,{recovery:true})};}catch(error){return {failure:error.code??'LEGACY_TERMS_UNAVAILABLE'};}
  }
  #resolveLegacyPurchase(s,row,purchaseKey){
    check(Object.hasOwn(s.requests,row.terms.userId+':'+purchaseKey),'LEGACY_RESOLUTION_REJECTED','Existing purchase receipt required',409);
    const candidate={...row,legacy:{...row.legacy,purchaseKey}},resolution=this.#reconcileLegacyPurchase(s,candidate);
    check(resolution.purchase,'LEGACY_RESOLUTION_REJECTED','Purchase evidence does not match the paid obligation',409);
    const terms=row.terms,token=fingerprint({providerId:terms.providerId,transactionId:terms.transactionId}),entries=s.ledger.filter(entry=>entry.userId===terms.userId&&entry.currencyId===terms.quote.price.currencyId);
    const index=entries.findIndex(entry=>entry.type==='external-credit'&&entry.reference===token),credit=entries[index],debit=entries[index+1],amount=terms.quote.price.amount;
    check(index>=0&&credit.delta===amount&&credit.balance===amount&&(index===0||entries[index-1].balance===0)&&debit?.type==='purchase'&&debit.reference===resolution.purchase.id&&debit.delta===-amount&&debit.balance===0,'LEGACY_RESOLUTION_REJECTED','Unambiguous credit-funded purchase evidence required',409);
    return resolution.purchase;
  }
  #legacyResolutionCandidate(s,row){
    const terms=row.terms,token=fingerprint({providerId:terms.providerId,transactionId:terms.transactionId}),entries=s.ledger.filter(entry=>entry.userId===terms.userId&&entry.currencyId===terms.quote.price.currencyId),index=entries.findIndex(entry=>entry.type==='external-credit'&&entry.reference===token),next=entries[index+1];
    if(index<0||next?.type!=='purchase')return null;
    const requests=Object.entries(s.requests).filter(([key,request])=>key.startsWith(terms.userId+':')&&request.result?.id===next.reference);
    if(requests.length!==1)return null;
    const purchaseKey=requests[0][0].slice(terms.userId.length+1);
    try{return {purchaseKey,purchase:this.#resolveLegacyPurchase(s,row,purchaseKey)};}catch(error){if(error.code==='LEGACY_RESOLUTION_REJECTED')return null;throw error;}
  }
  #adjust(s,userId,currencyId,delta,type,reference) {
    const old=s.balances[userId][currencyId]??0;
    check(Number.isSafeInteger(old)&&Number.isSafeInteger(delta),'INVALID_STATE','Invalid balance arithmetic',500);
    const exact=BigInt(old)+BigInt(delta);
    let refundable=BigInt(recordContexts.get(s)?.refundableEscrow?.[userId]?.[currencyId]??0);
    if(delta>0)for(const trade of Object.values(s.trades))if(trade.status==='pending'&&trade.fromUserId===userId)for(const money of trade.give.currencies)if(money.currencyId===currencyId){
      check(Number.isSafeInteger(money.amount)&&money.amount>0,'INVALID_STATE','Invalid refundable escrow',500);refundable+=BigInt(money.amount);
    }
    check(exact<=BigInt(Number.MAX_SAFE_INTEGER)&&exact+refundable<=BigInt(Number.MAX_SAFE_INTEGER),'BALANCE_OVERFLOW','Balance and refundable escrow exceed integer range',409);
    const next=Number(exact);
    check(next>=0,'INSUFFICIENT_FUNDS','Insufficient '+currencyId,409);
    s.balances[userId][currencyId]=next;
    s.ledger.push({id:id(),userId,currencyId,delta,balance:next,type,reference,at:this.#clock()});
  }
  wallet(actor) {return this.#query(q=>{const u=this.#queryUser(q,actor);return q.get('balances',u.id);});}
  history(actor) {return this.#store.read(s=>{const u=this.#user(s,actor); return s.ledger.filter(e=>e.userId===u.id);});}
  #weighted(pool) {
    const sum=pool.reduce((n,x)=>n+x.weight,0), roll=this.#random(sum);
    check(Number.isInteger(roll) && roll>=0 && roll<sum,'INVALID_PROVIDER','Random provider returned invalid draw',500);
    let cursor=roll;
    for (const entry of pool) {cursor-=entry.weight; if(cursor<0) return entry.variantId;}
    throw new Error('Unreachable weighted draw');
  }
  #available(s,pool) {
    const c=this.#catalog(s);
    return pool.filter(e=>{
      const v=lookup(c.variants,e.variantId);
      return v.enabled!==false && (v.supplyLimit===undefined || (s.supply[v.id]??0)<v.supplyLimit) && codeStockAvailable(s,v.codes,this.#clock());
    });
  }
  #mint(s,ownerId,variantId,source,state='owned') {
    const c=this.#catalog(s), variant=lookup(c.variants,variantId), card=lookup(c.cards,variant.cardId);
    const issued=(s.supply[variant.id]??0)+1;
    check(variant.supplyLimit===undefined || issued<=variant.supplyLimit,'SOLD_OUT','Edition exhausted',409);
    s.supply[variant.id]=issued;
    const selected=this.#allocationAdmissions.get(s)?.selection?.copies.find(row=>row.packIndex===source.packIndex&&row.slotId===source.slotId&&row.ordinal===source.slotOrdinal);const copy={id:selected?.copyId??id(),ownerId,cardId:card.id,variantId,lineId:card.lineId,rarityId:variant.rarityId,
      state,serialNumber:variant.supplyLimit===undefined?null:issued,editionTotal:variant.supplyLimit??null,
      createdAt:this.#clock(),openedAt:null,openedBy:null,acquiredAt:this.#clock(),source,version:1,
      definition:clone(card),variant:clone({...variant,bindings:undefined}),bindings:{},metadata:{}};
    const preparedCopy=this.#allocationAdmissions.get(s)?.factoryCopies?.find(row=>row.id===copy.id);
    if(preparedCopy){check(preparedCopy.ownerId===ownerId&&preparedCopy.variantId===variantId&&preparedCopy.serialNumber===copy.serialNumber&&contentDigest(preparedCopy.source)===contentDigest(source)&&contentDigest(preparedCopy.definition)===contentDigest(copy.definition)&&contentDigest(preparedCopy.variant)===contentDigest(JSON.parse(JSON.stringify(copy.variant))),'ALLOCATION_STALE','Frozen binding mint draft changed',409);Object.assign(copy,clone(preparedCopy));}
    for (const [name,spec] of Object.entries(variant.bindings)) {
      if(preparedCopy)continue;
      const factory=spec.factory && Object.hasOwn(this.#bindings,spec.factory) && this.#bindings[spec.factory];
      check(!spec.factory || factory,'MISSING_PROVIDER','Binding factory unavailable: '+spec.factory,409);
      const data=factory ? factory({copy:clone(copy),user:clone(s.users[ownerId]),spec:clone(spec)}) : spec.data;
      check(!data?.then,'INVALID_PROVIDER','Binding factories must be synchronous',500);
      copy.bindings[name]={visibility:spec.visibility,transfer:spec.transfer,holderId:ownerId,state:'active',data:jsonObject(data)};
    }
    copy.cardPolicy=clone(s.cardValidation?.[variant.id]??null);
    if(copy.cardPolicy?.fields.some(f=>f.scope==="copy")){
      const fields=copy.cardPolicy.fields,policy={fields,defaults:{},requirements:{},references:copy.cardPolicy.policies,provenance:{}};
      const defaults=Object.fromEntries(fields.filter(f=>f.scope==="copy"&&(Object.hasOwn(f,"default")||Object.hasOwn(f,"fixed"))).map(f=>[f.key,clone(Object.hasOwn(f,"fixed")?f.fixed:f.default)]));
      copy.stats=deriveStats(fields,defaults,"copy");
      const issues=inspectCardPolicy(policy,{copy});
      check(!issues.length,"COPY_STATS","Required copy stats need valid issuance defaults",409);
      copy.issuedStats=clone(copy.stats);
    }
    copy.provenance={version:1,catalogVersion:c.version,issuedAt:copy.createdAt,definitionDigest:contentDigest(card),variantDigest:contentDigest(variant),...clone(source)};
    s.copies[copy.id]=copy;this.#codes.allocate(s,copy,variant.codes,this.#clock());
    this.#event(s,'card.issued',{copyId:copy.id,ownerId,variantId,provenance:clone(copy.provenance)});return copy;
  }
  quote(actor,{productId,quantity=1}) {
    integer(quantity,'quantity',1,100);
    return this.#query(q=>{
      const user=this.#queryUser(q,actor),s={catalog:q.value('catalog'),adminControls:q.value('adminControls')},c=this.#catalog(s),base=lookup(c.products,productId);
      check(base && base.enabled!==false,'UNAVAILABLE','Pack product unavailable',404);
      assertAdminPurchase(s,user.id,base);const product=effectiveProduct(s,base);
      this.#workflow(s,'packs',product.price.amount>0);
      this.#productTime(product);
      check(quantity<=product.maxQuantity,'INVALID_INPUT','Quantity exceeds product limit');
      const total=product.price.amount*quantity; integer(total,'total price');
      const factorySnapshot=product.allocationStrategy?.version>=3?this.#bindingFactories.prepare(user,[...new Set(product.slots.flatMap(slot=>slot.pool.map(entry=>entry.variantId)))].map(id=>lookup(c.variants,id)),product,quantity):null;return {productId,quantity,productRevision:product.revision,catalogVersion:c.version,adminRevision:adminRevision(s),price:{currencyId:product.price.currencyId,amount:total},...(factorySnapshot?.activationMaximum?{bindingActivation:{maximum:factorySnapshot.activationMaximum}}:{}),...(product.allocationStrategy?{allocationDigest:this.#allocationDigest(product,quantity,c)}:{})};
    });
  }
  #productTime(product){const time=Date.parse(this.#clock());check(!product.availableFrom||time>=Date.parse(product.availableFrom),'NOT_RELEASED','This pack is not available yet',409);check(!product.availableUntil||time<Date.parse(product.availableUntil),'PRODUCT_ENDED','This pack is no longer available',409);}
  availability(){return this.#query(q=>{const s={catalog:q.value('catalog'),supply:q.value('supply'),adminControls:q.value('adminControls')},c=this.#catalog(s);return {version:c.version,variants:c.variants.map(v=>({id:v.id,issued:s.supply[v.id]??0,remaining:v.supplyLimit===undefined?null:Math.max(0,v.supplyLimit-(s.supply[v.id]??0))})),products:c.products.map(base=>{const p=effectiveProduct(s,base);return {id:p.id,available:p.enabled!==false&&(!p.availableFrom||Date.parse(this.#clock())>=Date.parse(p.availableFrom))&&(!p.availableUntil||Date.parse(this.#clock())<Date.parse(p.availableUntil)),pity:p.pity??null};})};});}
  pityProgress(actor){return this.#store.read(s=>{const u=this.#user(s,actor);return s.pity?.[u.id]??{};});}
  purchase(actor,{key,productId,quantity=1,productRevision,catalogVersion,adminRevision:quotedAdminRevision,allocationDigest}) {
    integer(quantity,'quantity',1,100);
    const input={productId,quantity,productRevision,catalogVersion,...(quotedAdminRevision===undefined?{}:{adminRevision:quotedAdminRevision}),...(allocationDigest===undefined?{}:{allocationDigest})};
    return this.#command(actor,key,'packs.purchased',input,(s,user)=>this.#purchaseBody(s,user,input));
  }
  #purchaseBody(s,user,{productId,quantity,productRevision,catalogVersion,adminRevision:quotedAdminRevision}){
      const c=this.#catalog(s),base=lookup(c.products,productId);
      check(base && base.enabled!==false,'UNAVAILABLE','Pack product unavailable',404);
      assertAdminPurchase(s,user.id,base);const product=effectiveProduct(s,base);
      check(!product.allocationStrategy||this.#allocationAdmissions.has(s),'ALLOCATION_ASYNC_REQUIRED','Use asynchronous allocation strategy evaluation',503);
      this.#workflow(s,'packs',product.price.amount>0);
      this.#productTime(product);
      check(product.revision===productRevision && c.version===catalogVersion && adminRevision(s)===(quotedAdminRevision??0),'STALE_QUOTE','Get a fresh quote before buying',409);
      check(quantity<=product.maxQuantity,'INVALID_INPUT','Quantity exceeds product limit');
      const total=product.price.amount*quantity; integer(total,'total price');
      const purchaseId=this.#allocationAdmissions.get(s)?.selection?.purchaseId??id(); this.#adjust(s,user.id,product.price.currencyId,-total,'purchase',purchaseId);
      const packs=this.#allocatePacks(s,user,product,quantity,{purchaseId});
      const deferred=this.#allocationAdmissions.get(s)?.factoryCopies?.reduce((n,copy)=>n+Object.values(copy.bindings).filter(binding=>binding.state==='activation-pending').length,0)??0;
      return {id:purchaseId,packs,paid:{currencyId:product.price.currencyId,amount:total},...(deferred?{bindingActivation:{state:'pending',count:deferred}}:{})};
  }
  allocationStatus(actor,input){check(this.#allocationIntents,'ALLOCATION_UNAVAILABLE','Allocation strategy is not configured',503);return this.#allocationIntents.status(actor,input);}
  acknowledgeAllocation(actor,input){const command=this.#query(q=>{this.#queryUser(q,actor);const row=q.get('allocationAttempts',input.attemptId);check(row?.userId===actor.userId,'NOT_FOUND','Allocation attempt not found',404);check(row.command!=='commitExternalPurchase','EXTERNAL_PURCHASE_STATE','External allocation requires verified cancellation or compensation',409);return row.command??'purchase';}),service=command==='createListing'?this.#stockAllocationIntents:this.#allocationIntents;check(service,'ALLOCATION_UNAVAILABLE','Allocation strategy is not configured',503);return service.acknowledge(actor,input);}
  setRemoteAllocationEnabled(actor,{enabled}){this.#admin(actor,'commerce.manage');check(this.#remoteAllocation,'ALLOCATION_UNAVAILABLE','Allocation strategy is not configured',503);return this.#remoteAllocation.setEnabled(enabled);}
  #allocationDigest(product,quantity,catalog){const factoryTerms=this.#factoryTerms(product,catalog);return contentDigest({...(factoryTerms.length?{factoryTerms}:{}),strategy:product.allocationStrategy,productId:product.id,productRevision:product.revision,slots:product.slots,...(product.allocationStrategy.version>=2?{duplicatePolicy:product.duplicatePolicy,pity:product.pity??null}:{}),...(product.allocationStrategy.version>=3?{attachments:[...new Set(product.slots.flatMap(slot=>slot.pool.map(e=>e.variantId)))].map(id=>({variantId:id,codes:lookup(catalog.variants,id).codes}))}:{}),quantity,adminRevision:product.adminRevision??0});}
  #allocationState(tx,actor,input){
    const user=this.#queryUser(tx,actor),catalog=tx.value('catalog'),base=catalog?.products.find(p=>p.id===input.productId);check(base?.allocationStrategy,'ALLOCATION_STALE','Allocation state changed; review again',409);
    const variants=[...new Set(base.slots.flatMap(slot=>slot.pool.map(entry=>entry.variantId)))].map(id=>catalog.variants.find(v=>v.id===id));
    const state={schemaVersion:1,revision:tx.value('revision'),catalog,adminControls:tx.value('adminControls'),cardAuthoring:tx.value('cardAuthoring'),users:{[user.id]:user},balances:{[user.id]:tx.get('balances',user.id)},supply:{},pity:{[user.id]:tx.get('pity',user.id)??{}},cardValidation:{},copies:{},packs:{},trades:{},requests:{},ledger:[],events:[]};
    for(const variant of variants){state.supply[variant.id]=tx.get('supply',variant.id)??0;const validation=tx.get('cardValidation',variant.id);if(validation)state.cardValidation[variant.id]=validation;}
    if(base.allocationStrategy.version>=2&&base.duplicatePolicy.scope==='inventory')state.allocationOwnedCards=tx.ownedCardPresence(user.id,[...new Set(variants.map(v=>v.cardId))]);
    const product=effectiveProduct(state,base);if(product.allocationStrategy.version>=3){state.allocationFactorySnapshot=this.#bindingFactories.prepare(user,variants,product,input.quantity);state.allocationCodeResources=this.#loadAllocationCodes(state,variants,product,input.quantity,tx);}return {state,user,variants,product};
  }
  setRemoteStockAllocationEnabled(actor,{enabled}){this.#admin(actor,'commerce.manage');check(this.#remoteStockAllocation,'ALLOCATION_UNAVAILABLE','Stock allocation strategy is not configured',503);return this.#remoteStockAllocation.setEnabled(enabled);}
  #stockAllocationOwner(tx,actor,shopId){const user=this.#queryUser(tx,actor),shop=tx.get('shops',shopId);return this.#commerce.stockAllocationOwner({users:{[user.id]:user},shops:shop?{[shopId]:shop}:{},commerceSettings:tx.value('commerceSettings'),adminControls:tx.value('adminControls')},actor,shopId);}
  quoteMintPackStock(actor,{shopId,productId,quantity}){return this.#createListingRecords(actor,null,{shopId,items:{kind:'mint-pack',productId,quantity}},s=>{const terms=this.#commerce.stockAllocationTerms(s,actor,{shopId,productId,quantity}),variants=[...new Set(terms.product.slots.flatMap(slot=>slot.pool.map(e=>e.variantId)))].map(id=>s.catalog.variants.find(v=>v.id===id));this.#allocationContext(s,{id:actor.userId},variants,terms.product,quantity,'stock');return {shopId,productId,quantity,allocationDigest:terms.allocationDigest,...(s.allocationFactorySnapshot?.activationMaximum?{bindingActivation:{maximum:s.allocationFactorySnapshot.activationMaximum}}:{})};},false);}
  stockAllocationStatus(actor,{shopId,productId}){return this.#query(q=>{this.#stockAllocationOwner(q,actor,shopId);text(productId,'product ID',100);const head=q.get('allocationHeads',contentDigest({userId:actor.userId,productId,algorithm:'weighted-deck@1'})),row=head?.lastAttemptId?q.get('allocationAttempts',head.lastAttemptId):null;return {shopId,productId,attemptId:row?.id??null,state:row?.state??'idle',errorCode:row?.errorCode??null,command:row?(row.command??'purchase'):null,attemptShopId:row?.command==='createListing'?row.input.shopId:null,...(row&&q.get('bindingFactoryReservations',row.id)?{bindingFactoryBatchId:q.get('bindingFactoryReservations',row.id).batchId}:{}),...(row&&q.get('codeIssuanceReservations',row.id)?{codeIssuanceBatchId:q.get('codeIssuanceReservations',row.id).batchId}:{})};});}
  #prepareStockAllocation(tx,actor,input,row){return this.#createListingRecords(actor,null,input,s=>{const prepared=this.#commerce.prepareStockAllocation(s,actor,input,row),variants=[...new Set(prepared.product.slots.flatMap(slot=>slot.pool.map(e=>e.variantId)))].map(id=>s.catalog.variants.find(v=>v.id===id)),context={...this.#allocationContext(s,{id:actor.userId},variants,prepared.product,input.items.quantity,'stock'),shop:{id:prepared.shop.id,ownerId:prepared.shop.ownerId}};return {context,...(s.allocationFactorySnapshot?{factorySnapshot:s.allocationFactorySnapshot}:{}),...(s.allocationCodeResources?{codeSnapshot:s.allocationCodeResources.codeSnapshot}:{}),preparation:prepared,snapshotDigest:contentDigest({listing:prepared.snapshotDigest,product:prepared.product,adminControls:s.adminControls,supply:s.supply,cardValidation:s.cardValidation,...(s.allocationCodeResources?{codeSnapshot:s.allocationCodeResources.codeSnapshot}:{}),...(s.allocationFactorySnapshot?{factorySnapshot:s.allocationFactorySnapshot}:{})})};},false,null,{tx});}
  #prepareAllocation(tx,actor,input){
    const {state,user,variants,product}=this.#allocationState(tx,actor,input);assertAdminPurchase(state,user.id,product);this.#workflow(state,'packs',product.price.amount>0);this.#productTime(product);
    check(product.enabled!==false&&product.revision===input.productRevision&&state.catalog.version===input.catalogVersion&&adminRevision(state)===(input.adminRevision??0)&&this.#allocationDigest(product,input.quantity,state.catalog)===input.allocationDigest,'ALLOCATION_STALE','Allocation state changed; review again',409);

    check(input.quantity<=product.maxQuantity,'INVALID_INPUT','Quantity exceeds product limit');const total=product.price.amount*input.quantity;integer(total,'total');check((state.balances[user.id][product.price.currencyId]??0)>=total,'INSUFFICIENT_FUNDS','Insufficient purchase currency',409);
    const context=this.#allocationContext(state,user,variants,product,input.quantity);
    return {context,...(state.allocationFactorySnapshot?{factorySnapshot:state.allocationFactorySnapshot}:{}),...(state.allocationCodeResources?{codeSnapshot:state.allocationCodeResources.codeSnapshot}:{}),snapshotDigest:contentDigest({product,catalogVersion:state.catalog.version,adminControls:state.adminControls,cardAuthoringRevision:state.cardAuthoring?.revision??0,supply:state.supply,cardValidation:state.cardValidation,...(state.allocationCodeResources?{codeSnapshot:state.allocationCodeResources.codeSnapshot}:{}),...(state.allocationFactorySnapshot?{factorySnapshot:state.allocationFactorySnapshot}:{}),...(product.allocationStrategy.version>=2?{eligibility:this.#allocationEligibility(state,user.id,variants,product)}:{})})};
  }
  #allocationContext(state,user,variants,product,quantity,mode='personalized',codeResources=state.allocationCodeResources){
    const v2=product.allocationStrategy.version>=2,v3=product.allocationStrategy.version>=3;
    check((v2||!product.pity&&product.duplicatePolicy.scope==='none')&&variants.every(v=>(v3||!v.codes?.length)&&Object.values(v.bindings).every(b=>!b.factory||v3&&!!this.#bindingFactoryRegistry.factories[b.factory])),'ALLOCATION_UNSUPPORTED','Allocation strategy does not support these product features',409);
    check(product.slots.reduce((n,s)=>n+s.count,0)*quantity<=2000,'ALLOCATION_LIMIT','Allocation batch exceeds 2000 cards',502);
    const remaining=new Map(variants.map(v=>[v.id,v.enabled===false?0:v.supplyLimit===undefined?null:Math.max(0,v.supplyLimit-(state.supply[v.id]??0))])),seenFinite=new Set();
    // Retain exhausted v4 candidates for independent optional presence; remaining zero always excludes selection.
    const slots=product.slots.map(slot=>{if(product.allocationStrategy.version<4)for(const e of slot.pool)if(remaining.get(e.variantId)!==null){check(!seenFinite.has(e.variantId),'ALLOCATION_UNSUPPORTED','Overlapping finite-supply slot pools are not supported',409);seenFinite.add(e.variantId);}const bounded=slot.pool.map(e=>({...e,weight:remaining.get(e.variantId)===null?e.weight:Math.min(e.weight,remaining.get(e.variantId))})),pool=product.allocationStrategy.version===4?bounded.map(e=>({...e,weight:Math.max(1,e.weight)})):bounded.filter(e=>e.weight>0);if(product.allocationStrategy.version<4)check(pool.reduce((n,e)=>n+e.weight,0)>=(slot.probability?.numerator===0?0:slot.count*quantity),'ALLOCATION_STALE','Allocation state changed; review again',409);return {id:slot.id,role:slot.role,count:slot.count,probability:slot.probability??{numerator:1,denominator:1},pool};});
    const context={userId:user.id,product:{id:product.id,revision:product.revision,strategy:product.allocationStrategy,slots},quantity:quantity,variants:variants.map(v=>({id:v.id,remaining:remaining.get(v.id)}))};
    if(v2){const eligibility=this.#allocationEligibility(state,user.id,variants,product,mode);Object.assign(context,eligibility);Object.assign(context.product,{duplicatePolicy:{scope:product.duplicatePolicy.scope,fallback:product.duplicatePolicy.fallback},pity:product.pity?{after:product.pity.after,rarityId:product.pity.rarityId,minimumRank:lookup(state.catalog.rarities,product.pity.rarityId).rank}:null});context.variants=variants.map(v=>({id:v.id,cardId:v.cardId,rarityRank:lookup(state.catalog.rarities,v.rarityId).rank,remaining:remaining.get(v.id)}));}
    if(v3){const resources=codeResources??this.#loadAllocationCodes(state,variants,product,quantity);context.codePools=resources.codePools;for(const variant of context.variants)variant.codeDemand=resources.resources.find(v=>v.id===variant.id).codeDemand;}
    if(product.allocationStrategy.version===4)validateAllocationSolverAdmission(context);return context;
  }
  #loadAllocationCodes(state,variants,product,quantity,tx){
    const demand=allocationCodeDemand(product,variants.map(v=>({id:v.id,codeDemand:importedVariantDemand(v)})),quantity);if(tx){check(tx.value('_codePoolRevisionsReady')===true&&tx.value('_codeImportOrderReady')===true,'RECORD_MIGRATION_REQUIRED','Prepare imported code allocation projections',503);state.codes??={};state.codePools={};state._codePoolRevisions={};state._codeImportOrder={'@cursor':tx.get('_codeImportOrder','@cursor')??0};state.codeIndexCheck=tx.value('codeIndexCheck');state.allocationCodeCount=tx.count?tx.count('codes'):(JSON.parse(tx.value(recordAccountingField)).counts.codes??0);for(const id of demand.keys()){state.codePools[id]=tx.get('codePools',id);state._codePoolRevisions[id]=tx.get('_codePoolRevisions',id)??0;}}
    return this.#codes.prepareAllocation(state,product,quantity,this.#clock(),(id,needed,at)=>{const entries=tx?tx.importedCodePrefix(id,needed,at):memoryQueries(state).importedCodePrefix(id,needed,at);if(tx)for(const {row}of entries)state.codes[row.id]=row;return entries;});
  }
  #allocationEligibility(state,userId,variants,product,mode='personalized'){
    const ids=[...new Set(variants.map(v=>v.cardId))],personalized=mode==='personalized',ownedCards=personalized&&product.duplicatePolicy.scope==='inventory'?(state.allocationOwnedCards??memoryQueries(state).ownedCardPresence(userId,ids)):[];return {mode,ownedCards,pityCount:personalized&&product.pity?(state.pity?.[userId]?.[product.id]??0):0};
  }
  #factoryProduct(tx,attempt){const catalog=tx.value('catalog');return attempt.command==='createListing'?attempt.preparation.product:attempt.command==='commitExternalPurchase'?tx.get('externalPurchases',attempt.preparationId).snapshot.product:effectiveProduct({catalog,adminControls:tx.value('adminControls')},lookup(catalog.products,attempt.productId));}
  #factoryTerms(product,catalog){if(!(product.allocationStrategy?.version>=3))return [];return [...new Set(product.slots.flatMap(slot=>slot.pool.map(entry=>entry.variantId)))].flatMap(id=>Object.entries(lookup(catalog.variants,id).bindings).filter(([,spec])=>spec.factory).map(([namespace,spec])=>{const factory=this.#bindingFactoryRegistry.factories[spec.factory];check(factory,'MISSING_PROVIDER','Allocation binding factory is unavailable',503);return {variantId:id,namespace,visibility:spec.visibility,transfer:spec.transfer,name:spec.factory,kind:factory.kind,providerId:factory.providerId,revision:factory.revision,userFields:[...factory.userFields]};}));}
  #factoryCopy(tx,attempt,product,variant,position,selection,issued){const catalog=tx.value('catalog'),card=lookup(catalog.cards,variant.cardId),slotIndex=product.slots.findIndex(slot=>slot.id===position.slotId),slot=product.slots[slotIndex],purchaseId=attempt.command==='createListing'?null:selection.purchaseId,source={type:'pack',packId:selection.packs[position.packIndex],purchaseId,productId:product.id,productRevision:product.revision,...(attempt.command==='createListing'?{listingId:selection.listingId}:attempt.command==='commitExternalPurchase'?{externalPreparationId:attempt.preparationId}:{}),productDigest:contentDigest(product),packIndex:position.packIndex,slotId:slot.id,slotIndex,slotRole:slot.role??'card',slotOrdinal:position.ordinal,position:selection.plan.filter(draw=>draw.packIndex===position.packIndex&&product.slots.findIndex(row=>row.id===draw.slotId)<slotIndex).reduce((n,draw)=>n+draw.variantIds.length,0)+position.ordinal,slotMetadata:clone(slot.metadata??{}),packMetadata:clone(product.metadata??{})},variantView=clone(variant);delete variantView.bindings;return {id:position.copyId,ownerId:attempt.userId,cardId:card.id,variantId:variant.id,lineId:card.lineId,rarityId:variant.rarityId,state:'sealed',serialNumber:variant.supplyLimit===undefined?null:issued,editionTotal:variant.supplyLimit??null,createdAt:selection.createdAt,openedAt:null,openedBy:null,acquiredAt:selection.createdAt,source,version:1,definition:clone(card),variant:variantView,bindings:{},metadata:{}};}
  #factoryDrafts(tx,attempt,selection){const catalog=tx.value('catalog'),product=this.#factoryProduct(tx,attempt),counts=new Map();return selection.copies.map(position=>{const variant=lookup(catalog.variants,position.variantId),issued=(counts.get(variant.id)??tx.get('supply',variant.id)??0)+1;counts.set(variant.id,issued);return {copy:this.#factoryCopy(tx,attempt,product,variant,position,selection,issued),specs:clone(variant.bindings)};}).filter(draft=>Object.values(draft.specs).some(spec=>spec.factory));}
  #factoryTemplates(tx,attempt){const catalog=tx.value('catalog'),product=this.#factoryProduct(tx,attempt),user=tx.get('users',attempt.userId),uuid='ffffffff-ffff-4fff-bfff-ffffffffffff',inputs=[],drafts=[],finalCopies=[],selection={createdAt:'9999-12-31T23:59:59.999Z',purchaseId:uuid,listingId:uuid,packs:Array.from({length:attempt.context.quantity},()=>uuid),copies:[],plan:[]};
    for(let packIndex=0;packIndex<attempt.context.quantity;packIndex++)for(const slot of product.slots){const longest=slot.pool.reduce((a,b)=>Buffer.byteLength(JSON.stringify(a.variantId))>=Buffer.byteLength(JSON.stringify(b.variantId))?a:b);selection.plan.push({packIndex,slotId:slot.id,variantIds:Array.from({length:slot.count},()=>longest.variantId)});for(let ordinal=0;ordinal<slot.count;ordinal++)selection.copies.push({packIndex,slotId:slot.id,ordinal,variantId:longest.variantId,copyId:uuid});}
    for(const slot of product.slots)for(const candidate of slot.pool){const variant=lookup(catalog.variants,candidate.variantId);if(!Object.values(variant.bindings).some(spec=>spec.factory))continue;const copy=this.#factoryCopy(tx,attempt,product,variant,{copyId:uuid,packIndex:0,slotId:slot.id,ordinal:0},selection,Number.MAX_SAFE_INTEGER);copy.source.packIndex=99;copy.source.slotOrdinal=99;copy.source.position=1999;drafts.push({copy:clone(copy),specs:clone(variant.bindings)});for(const [namespace,spec]of Object.entries(variant.bindings)){if(spec.factory){const factory=this.#bindingFactoryRegistry.factories[spec.factory];inputs.push({copy:clone(copy),user:snapshotBindingFactoryUser(user,factory.userFields),spec:clone(spec)});}copy.bindings[namespace]={visibility:spec.visibility,transfer:spec.transfer,holderId:user.id,state:'active',data:spec.factory?{value:'x'.repeat(32756)}:clone(spec.data)};}finalCopies.push(copy);}
    return {inputs,drafts,copies:finalCopies,selection};
  }
  bindingFactoryStatus(actor,input){return this.#bindingFactories.status(actor,input);}
  recoverBindingFactories(actor,input,options){return this.#bindingFactories.recover(actor,input,options);}
  #commitAllocation(tx,actor,row,plan,{codeAssignments=[],factory}={}){
    const {state,user,product}=this.#allocationState(tx,actor,row.input);let accounting;try{accounting=JSON.parse(tx.value(recordAccountingField));}catch{}check(validRecordAccounting(accounting,tx.value('revision')),'RECORD_MIGRATION_REQUIRED','Prepare revision-bound record accounting',503);
    recordContexts.set(state,{accounting,ownerId:user.id,ownerCounts:tx.ownerCounts(user.id),codeCount:tx.count('codes')-Object.keys(state.codes??{}).length,codeIdentityExists:(fingerprint,providerId,externalId)=>!!tx.get('_codeIdentities',JSON.stringify(['fingerprint',fingerprint]))||!!(externalId&&tx.get('_codeIdentities',JSON.stringify(['external',providerId,externalId])))});this.#allocationAdmissions.set(state,{productId:product.id,quantity:row.input.quantity,plan,ownedCards:row.context.ownedCards,selection:factory?.selection??this.#codeIssuance.admission(tx,row)?.batch.selection,factoryCopies:factory?.copies});
    const codes=this.#codes.admitAllocation(state,row.codeSnapshot,this.#codeIssuance.admission(tx,row));try{const result=this.#purchaseBody(state,user,row.input);if(codes)codeAssignments.push(...codes.assignments);state.requests[user.id+':'+row.key]={hash:row.receiptHash,result:clone(result),allocationAttemptId:row.id};this.#event(state,'packs.purchased',{userId:user.id});this.#capacity(state,true);
      for(const field of ['balances','supply','pity','copies','packs','codes','requests','actionJobs','completionObligations'])for(const [id,value]of Object.entries(state[field]??{}))tx.put(field,id,value);for(const field of ['ledger','events'])for(const value of state[field])tx.append(field,value);return result;
    }finally{this.#codes.releaseAllocation(state);this.#allocationAdmissions.delete(state);recordContexts.delete(state);}
  }
  async purchaseAsync(actor,request,{signal}={}){
    const principal=clone(actor),reviewed=clone(request);
    await Promise.resolve();
    if(!this.#store.transactRecords)return this.purchase(principal,reviewed);
    const {key,productId,quantity=1,productRevision,catalogVersion,adminRevision:quotedAdminRevision,allocationDigest}=reviewed;
    integer(quantity,'quantity',1,100);text(key,'idempotency key',128);
    const input={productId,quantity,productRevision,catalogVersion,...(quotedAdminRevision===undefined?{}:{adminRevision:quotedAdminRevision}),...(allocationDigest===undefined?{}:{allocationDigest})};
    const execute=()=>this.#store.transactRecords(tx=>{
      check(principal?.disabled!==true&&typeof principal?.userId==='string','UNAUTHENTICATED','A verified framework user is required',401);
      const user=tx.get('users',principal.userId);check(user,'UNAUTHENTICATED','A verified framework user is required',401);
      const token=user.id+':'+key,hash=fingerprint({type:'packs.purchased',input}),previous=tx.get('requests',token);
      const catalog=previous?null:tx.value('catalog'),base=catalog?.products.find(product=>product.id===productId);
      check(!base?.allocationStrategy,'ALLOCATION_ASYNC_REQUIRED','Use asynchronous allocation strategy evaluation',503);
      let accounting;try{accounting=JSON.parse(tx.value(recordAccountingField));}catch{}
      check(validRecordAccounting(accounting,tx.value('revision')),previous?'RECORD_PATH_UNAVAILABLE':'RECORD_MIGRATION_REQUIRED','Prepare revision-bound record accounting',503);
      check(!accounting.legacyPurchases,'RECORD_PATH_UNAVAILABLE','Legacy external purchases require the compatibility path',409);
      if(previous){check(previous.hash===hash,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409);return previous.result;}
      check(base,'UNAVAILABLE','Pack product unavailable',404);
      const variants=[...new Set(base.slots.flatMap(slot=>slot.pool.map(entry=>entry.variantId)))].map(variantId=>catalog.variants.find(variant=>variant.id===variantId));
      check(base.duplicatePolicy.scope!=='inventory'&&variants.every(variant=>!variant.codes?.length&&!Object.values(variant.bindings).some(binding=>binding.factory)),'RECORD_PATH_UNAVAILABLE','This product requires the compatibility acquisition path',409);
      const state={schemaVersion:1,revision:accounting.revision,catalog,adminControls:tx.value('adminControls'),cardAuthoring:tx.value('cardAuthoring'),
        users:{[user.id]:user},balances:{[user.id]:tx.get('balances',user.id)},supply:Object.create(null),pity:{[user.id]:tx.get('pity',user.id)??{}},cardValidation:Object.create(null),
        copies:{},packs:{},trades:{},requests:{},ledger:[],events:[]};
      for(const variant of variants){state.supply[variant.id]=tx.get('supply',variant.id)??0;const validation=tx.get('cardValidation',variant.id);if(validation)state.cardValidation[variant.id]=validation;}
      recordContexts.set(state,{accounting,ownerId:user.id,ownerCounts:tx.ownerCounts(user.id)});
      try{
        const result=this.#purchaseBody(state,user,input);state.requests[token]={hash,result:clone(result)};
        this.#event(state,'packs.purchased',{userId:user.id});this.#capacity(state,true);
        for(const field of ['balances','supply','pity','copies','packs','requests','actionJobs','completionObligations'])for(const [recordId,value]of Object.entries(state[field]??{}))tx.put(field,recordId,value);
        for(const field of ['ledger','events'])for(const value of state[field])tx.append(field,value);
        return result;
      }finally{recordContexts.delete(state);}
    });
    try{return execute();}catch(error){
      if(error.code==='ALLOCATION_ASYNC_REQUIRED'){check(this.#allocationIntents,'ALLOCATION_UNAVAILABLE','Allocation strategy is not configured',503);return this.#allocationIntents.purchase(principal,key,input,{signal});}
      if(error.code==='RECORD_MIGRATION_REQUIRED'){this.#store.prepareRecordTransactions();try{return execute();}catch(retry){if(retry.code==='RECORD_PATH_UNAVAILABLE')return this.purchase(principal,reviewed);throw retry;}}
      if(error.code==='RECORD_PATH_UNAVAILABLE')return this.purchase(principal,reviewed);
      throw error;
    }
  }
  #allocatePacks(s,user,product,quantity,source={},personalized=true){
    const c=this.#catalog(s),purchaseId=source.purchaseId??null,admission=this.#allocationAdmissions.get(s);
    if(product.allocationStrategy)check((personalized||admission?.scope==='commerce-stock')&&admission?.productId===product.id&&admission.quantity===quantity,'ALLOCATION_UNSUPPORTED','This allocation strategy requires its asynchronous wallet purchase path',409);
      const packs=[];
      s.pity??={};s.pity[user.id]??={};
      for (let n=0;n<quantity;n++) {
        const pack={id:admission?.selection?.packs[n]??id(),ownerId:user.id,productId:product.id,productRevision:product.revision,lineId:product.lineId,catalogVersion:c.version,
          product:clone(product),purchaseId,batchIndex:n,metadata:clone(product.metadata??{}),createdAt:admission?.selection?.createdAt??this.#clock(),openedAt:null,copyIds:[],receipt:null};
        const excluded=new Set();
        if(personalized&&product.duplicatePolicy.scope==='inventory')for(const owned of admission?.ownedCards??[])if(owned.owned)excluded.add(owned.cardId);
        if(personalized&&product.duplicatePolicy.scope==='inventory') for(const copy of Object.values(s.copies))
          if(copy.ownerId===user.id && ['owned','sealed'].includes(copy.state)) excluded.add(copy.cardId);
        let qualified=false;const pityDue=personalized&&product.pity&&(s.pity[user.id][product.id]??0)>=product.pity.after-1;
        const firstCardSlot=product.slots.findIndex(slot=>(slot.role??'card')==='card');
        for(const [slotIndex,slot]of product.slots.entries()) {
          const planned=product.allocationStrategy?admission.plan.find(row=>row.packIndex===n&&row.slotId===slot.id):null;if(planned&&!planned.variantIds.length)continue;
          if(!planned&&slot.probability&&slot.probability.numerator<slot.probability.denominator){const roll=this.#random(slot.probability.denominator);check(Number.isInteger(roll)&&roll>=0&&roll<slot.probability.denominator,'INVALID_PROVIDER','Invalid slot probability draw',500);if(roll>=slot.probability.numerator)continue;}
          for(let i=0;i<slot.count;i++) {
          let available=this.#available(s,slot.pool);
          if(pityDue&&slotIndex===firstCardSlot&&i===0)available=available.filter(e=>lookup(c.rarities,lookup(c.variants,e.variantId).rarityId).rank>=lookup(c.rarities,product.pity.rarityId).rank);
          let pool=available;
          if(slot.role!=='insert'&&product.duplicatePolicy.scope!=='none') pool=pool.filter(e=>!excluded.has(lookup(c.variants,e.variantId).cardId));
          if(!pool.length && product.duplicatePolicy.fallback==='allow') pool=available;
          check(pool.length,'POOL_EXHAUSTED','No eligible card remains in this pack slot',409);
          if(planned)check(pool.some(e=>e.variantId===planned.variantIds[i]),'INVALID_ALLOCATION_RESPONSE','Allocation outcome violates native eligibility',502);
          const copy=this.#mint(s,user.id,planned?planned.variantIds[i]:this.#weighted(pool),{type:'pack',packId:pack.id,purchaseId,productId:product.id,productRevision:product.revision,...source,productDigest:contentDigest(product),packIndex:n,slotId:slot.id??'slot-'+slotIndex,slotIndex,slotRole:slot.role??'card',slotOrdinal:i,position:pack.copyIds.length,slotMetadata:clone(slot.metadata??{}),packMetadata:clone(product.metadata??{})},'sealed');
          if(slot.role!=='insert'&&personalized&&product.pity&&lookup(c.rarities,copy.rarityId).rank>=lookup(c.rarities,product.pity.rarityId).rank)qualified=true;
          pack.copyIds.push(copy.id); if(slot.role!=='insert')excluded.add(copy.cardId);
          }
        }
        if(personalized&&product.pity)s.pity[user.id][product.id]=qualified?0:(s.pity[user.id][product.id]??0)+1;
        s.packs[pack.id]=pack;this.#reserve(s,'pack',pack.id); packs.push(this.#packView(pack));
      }
    return packs;
  }
  #packView(pack) {const {copyIds,receipt,...view}=clone(pack); return {...view,cardCount:copyIds.length};}
  packs(actor) {return this.#query(q=>{const user=this.#queryUser(q,actor),items=[];let after='';do{const result=q.pagePacks({ownerId:user.id,after,limit:200,sort:'ordinal'});items.push(...result.items.map(pack=>this.#packView(pack)));after=result.next;}while(after);return items;});}
  packsPage(actor,options={}){return this.#query(q=>{const user=this.#queryUser(q,actor),result=q.pagePacks({...options,ownerId:user.id});return {...result,items:result.items.map(pack=>{check(pack.ownerId===user.id,'INVALID_STATE','Indexed pack ownership differs',500);return this.#packView(pack);})};});}
  packPage(actor,options={}){return this.packsPage(actor,options);}
  #bindingView(binding){const result=clone(binding);delete result.activationId;if(['activation-pending','activation-failed'].includes(result.state)){delete result.data;delete result.usedAt;}return result;}
  #copyView(s,copy,viewerId) {
    const result=clone(copy);
    const visibility=viewerId===copy.ownerId?'owner':'public',fields=copy.cardPolicy?.fields;
    redactGovernedCard(s,result.definition,'card',visibility,fields);
    if(result.variant.stats)result.variant.stats=redactGovernedCard(s,{...result.definition,stats:result.variant.stats},'variant',visibility,fields).stats;
    if(result.issuedStats)result.issuedStats=redactGovernedCard(s,{...result.definition,stats:result.issuedStats},"copy",visibility,fields??[]).stats;
    if(result.stats)result.stats=redactGovernedCard(s,{...result.definition,stats:result.stats},"copy",visibility,fields??[]).stats;
    if(result.cardPolicy)delete result.cardPolicy.fields;
    result.openedByName=copy.openedBy ? s.users[copy.openedBy]?.displayName??null:null;
    for(const binding of Object.values(result.variant.bindings??{}))if(binding.visibility==='owner'){delete binding.data;delete binding.factory;}
    result.bindings=Object.fromEntries(Object.entries(result.bindings).filter(([,b])=>b.visibility==='public' || b.holderId===viewerId).map(([name,binding])=>[name,this.#bindingView(binding)]));
    result.codes=(copy.codeIds??[]).map(codeId=>codeSummary(s,s.codes[codeId],viewerId,this.#clock()));delete result.codeIds;
    if(viewerId!==copy.ownerId){delete result.metadata.transfers;for(const value of [result.source,result.provenance])if(value){delete value.purchaseId;delete value.packMetadata;delete value.slotMetadata;}}
    return result;
  }
  openPack(actor,{key,packId}) {
    text(key,'idempotency key',128);const input={packId},fallback=()=>this.#command(actor,key,'pack.opened',input,(s,user)=>this.#openPackBody(s,user,packId));
    if(!this.#store.transactRecords)return fallback();
    try{return this.#store.transactRecords(tx=>{
      const user=this.#queryUser(tx,actor),token=user.id+':'+key,hash=fingerprint({type:'pack.opened',input}),previous=tx.get('requests',token);if(previous){check(previous.hash===hash,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409);return previous.result;}
      const pack=typeof packId==='string'?tx.get('packs',packId):undefined;check(pack?.ownerId===user.id,'NOT_FOUND','Pack not found',404);check(!pack.lockedBy,'PACK_LOCKED','Pack is reserved in a listing',409);
      let accounting;try{accounting=JSON.parse(tx.value(recordAccountingField));}catch{}check(validRecordAccounting(accounting,tx.value('revision'))&&!pack.receipt,'RECORD_PATH_UNAVAILABLE','Opening requires the compatibility completion path',409);
      const obligation=tx.get('completionObligations','pack:'+pack.id);check(obligation?.status==='reserved','RECORD_PATH_UNAVAILABLE','Opening requires the compatibility reservation path',409);
      const copies=Object.create(null);for(const copyId of pack.copyIds){const copy=tx.get('copies',copyId);check(copy,'INVALID_STATE','Pack copy is missing',500);check(!(copy.codeIds?.length||copy.variant.codes?.length),'RECORD_PATH_UNAVAILABLE','Code attachments require compatibility opening',409);copies[copyId]=copy;}
      const state={schemaVersion:1,revision:accounting.revision,catalog:tx.value('catalog'),cardAuthoring:tx.value('cardAuthoring'),users:{[user.id]:user},copies,packs:{[pack.id]:pack},requests:{},events:[],notifications:[],completionObligations:{[obligation.id]:obligation}};
      const prior=summarizeRecords(state);for(const field of ['copies','packs'])accounting.counts[field]-=prior.counts[field];for(const field of Object.keys(accounting.completion))accounting.completion[field]-=prior.completion[field];
      const ownerCounts=tx.ownerCounts(user.id);ownerCounts.packs--;for(const copy of Object.values(copies)){if(copy.state==='owned')ownerCounts.ownedCopies--;if(copy.state==='sealed')ownerCounts.sealedCopies--;}
      const seen=new Set();for(const cardId of new Set(Object.values(copies).map(copy=>copy.cardId))){const variants=state.catalog.variants.filter(variant=>variant.cardId===cardId).map(variant=>variant.id);check(variants.length<=2000,'RECORD_PATH_UNAVAILABLE','Card history requires compatibility opening',409);if(tx.ownedVariantCount(user.id,variants)>0)seen.add(cardId);}
      recordContexts.set(state,{accounting,ownerId:user.id,ownerCounts});
      try{const result=this.#complete(state,'pack',pack.id,()=>{const receipt=this.#openPackBody(state,user,packId,seen);state.requests[token]={hash,result:clone(receipt),completionId:obligation.id};this.#event(state,'pack.opened',{userId:user.id});this.#capacity(state,true);return receipt;});
        for(const field of ['copies','packs','requests','actionJobs','completionObligations'])for(const [id,row]of Object.entries(state[field]??{}))tx.put(field,id,row);for(const field of ['events','notifications'])for(const row of state[field])tx.append(field,row);tx.trimNotifications(user.id);tx.reservePackCompletion(obligation.id);return result;
      }finally{recordContexts.delete(state);}
    },{packCompletion:true});}catch(error){if(['RECORD_PATH_UNAVAILABLE','TRANSACTION_BUDGET'].includes(error.code))return fallback();throw error;}
  }
  #openPackBody(s,user,packId,priorSeen) {
      const pack=s.packs[packId]; check(pack && pack.ownerId===user.id,'NOT_FOUND','Pack not found',404);check(!pack.lockedBy,'PACK_LOCKED','Pack is reserved in a listing',409);
      if(pack.receipt) return pack.receipt;
      const seen=priorSeen??new Set(Object.values(s.copies).filter(x=>x.ownerId===user.id && x.state==='owned').map(x=>x.cardId));
      const openedAt=this.#clock(), cards=[];
      for(const copyId of pack.copyIds) {
        const copy=s.copies[copyId]; copy.state='owned'; copy.openedAt=openedAt; copy.openedBy=user.id; copy.version++;
        openingActions(s,copy,user.id,openedAt);
        this.#event(s,'card.opened',{copyId,packId,userId:user.id,openedAt});
        cards.push({...this.#copyView(s,copy,user.id),isNew:!seen.has(copy.cardId)}); seen.add(copy.cardId);
      }
      pack.openedAt=openedAt; pack.receipt={id:pack.id,openedAt,cards};
      this.#notify(s,user.id,'pack.opened',{packId:pack.id,count:cards.length});
      return pack.receipt;
  }
  inventory(actor) {return this.#query(q=>{const user=this.#queryUser(q,actor),copies=[];let after='';do{const result=q.pageCopies({ownerId:user.id,after,limit:200,sort:'ordinal'});copies.push(...result.items);after=result.next;}while(after);return this.#inventoryViews(this.#viewState(q,copies,[user.id]),copies,user.id);});}
  inspectCard(actor,copyId) {
    return this.#query(q=>{
      const user=this.#queryUser(q,actor),copy=q.get('copies',copyId);
      check(copy && copy.ownerId===user.id && copy.state==='owned','NOT_FOUND','Owned card not found',404);
      return this.#copyView(this.#viewState(q,[copy],[user.id]),copy,user.id);
    });
  }
  consumeBinding(actor,{key,copyId,namespace}) {
    return this.#command(actor,key,'binding.used',{copyId,namespace},(s,user)=>{
      const copy=s.copies[copyId], binding=copy?.bindings[namespace];
      check(copy && copy.state==='owned' && binding && binding.holderId===user.id,'NOT_FOUND','Binding not found',404);
      check(!copy.lockedBy,'CARD_LOCKED','Cancel the trade before using this card',409);
      check(binding.state!=='activation-pending','BINDING_PENDING','Binding activation is pending',409);check(binding.state!=='activation-failed','BINDING_UNAVAILABLE','Binding activation was refused',409);check(binding.state==='active','ALREADY_USED','Binding already used',409);
      binding.state='used'; binding.usedAt=this.#clock(); copy.version++;
      return {copyId,namespace,state:binding.state,usedAt:binding.usedAt};
    });
  }
  convert(actor,{key,from,to,amount,rounding='exact',catalogVersion}) {
    integer(amount,'conversion amount'); check(from!==to,'INVALID_INPUT','Choose different currencies');
    check(['exact','floor'].includes(rounding),'INVALID_INPUT','Invalid conversion rounding');
    return this.#command(actor,key,'currency.converted',{from,to,amount,rounding,catalogVersion},(s,user)=>{
      this.#feature(s,'conversion');
      const c=this.#catalog(s); check(c.version===catalogVersion,'STALE_QUOTE','Conversion values changed; refresh',409);
      const a=this.#currency(s,from), b=this.#currency(s,to);
      check(a.convertible!==false && b.convertible!==false,'CONVERSION_DISABLED','Currency conversion disabled',403);
      const numerator=BigInt(amount)*BigInt(a.value.numerator)*BigInt(b.value.denominator);
      const denominator=BigInt(a.value.denominator)*BigInt(b.value.numerator);
      const remainder=numerator%denominator, output=Number(numerator/denominator);
      check(rounding==='floor' || remainder===0n,'INEXACT_CONVERSION','Amount cannot convert exactly; choose floor explicitly',409);
      integer(output,'converted amount');
      const conversionId=id(); this.#adjust(s,user.id,from,-amount,'conversion',conversionId); this.#adjust(s,user.id,to,output,'conversion',conversionId);
      return {id:conversionId,from,to,amount,received:output,remainderNumerator:String(remainder),remainderDenominator:String(denominator)};
    });
  }
  tradeUp(actor,{key,recipeId,copyIds}) {
    check(Array.isArray(copyIds),'INVALID_INPUT','copyIds required');
    return this.#command(actor,key,'cards.tradedUp',{recipeId,copyIds},(s,user)=>{
      this.#feature(s,'tradeUps'); const recipe=lookup(this.#catalog(s).recipes,recipeId);
      check(recipe && recipe.enabled!==false,'NOT_FOUND','Recipe unavailable',404);
      check(copyIds.length===recipe.inputCount && new Set(copyIds).size===copyIds.length,'INVALID_INPUT','Select exactly '+recipe.inputCount+' distinct copies');
      const inputs=copyIds.map(copyId=>s.copies[copyId]);
      for (const copy of inputs) {
        check(copy && copy.ownerId===user.id && copy.state==='owned','NOT_OWNED','Trade-up input is not owned',403);
        check(!copy.lockedBy,'CARD_LOCKED','Card is reserved by a trade',409);
        check(copy.lineId===recipe.lineId && copy.rarityId===recipe.inputRarityId,'RECIPE_MISMATCH','Input does not match recipe');
        check(Object.keys(copy.bindings).length===0,'BOUND_CARD','Bound cards require a dedicated trade-up policy',409);
        check(cardBehavior(copy.definition).tradeUp && !(copy.codeIds?.length),'BOUND_CARD','This card type or attached code cannot be consumed in a trade-up',409);
      }
      if(recipe.duplicatesOnly) check(new Set(inputs.map(x=>x.variantId)).size===1,'RECIPE_MISMATCH','Recipe requires copies of the same variant');
      const pool=this.#available(s,recipe.outputPool); check(pool.length,'POOL_EXHAUSTED','Recipe outputs exhausted',409);
      const output=this.#mint(s,user.id,this.#weighted(pool),{type:'tradeUp',recipeId,inputIds:copyIds});
      this.#openCopy(s,output,user.id);
      for(const copy of inputs) {copy.state='consumed'; copy.version++;}
      this.#removePlacements(s,new Set(copyIds));
      return this.#copyView(s,output,user.id);
    });
  }
  #offer(s,userId,offer,toUserId=null,recovery=false) {
    check(offer && Array.isArray(offer.copyIds) && Array.isArray(offer.currencies),'INVALID_INPUT','Trade offers need copyIds and currencies arrays');
    check(offer.copyIds.length<=1000 && offer.currencies.length<=100,'INVALID_INPUT','Trade offer too large');
    check(new Set(offer.copyIds).size===offer.copyIds.length,'INVALID_INPUT','Duplicate copy in offer');
    if(!recovery&&offer.copyIds.length) this.#feature(s,'cardTrading');
    if(!recovery&&offer.currencies.length) this.#feature(s,'currencyTrading');
    for(const copyId of offer.copyIds) {
      const copy=s.copies[copyId]; check(copy && copy.ownerId===userId && copy.state==='owned','NOT_OWNED','Trade card not owned',403);
      check(!copy.lockedBy,'CARD_LOCKED','Trade card already reserved',409);
      const reason=this.#tradeReason(copy,userId,s,{toUserId});check(!reason,'TRANSFER_BLOCKED',reason,409);
      check(!Object.values(copy.bindings).some(b=>b.transfer==='block'),'TRANSFER_BLOCKED','Card has a nontransferable binding',409);
    }
    const seen=new Set();
    for(const money of offer.currencies) {
      integer(money.amount,'trade currency amount');
      check(!seen.has(money.currencyId),'INVALID_INPUT','Duplicate currency in offer'); seen.add(money.currencyId);
      check(this.#currency(s,money.currencyId).tradable===true,'TRANSFER_BLOCKED','Currency is not tradable',403);
      check((s.balances[userId][money.currencyId]??0)>=money.amount,'INSUFFICIENT_FUNDS','Insufficient trade currency',409);
    }
    return clone(offer);
  }
  #tradeDigest(trade){return contentDigest({id:trade.id,fromUserId:trade.fromUserId,toUserId:trade.toUserId,give:trade.give,receive:trade.receive,createdAt:trade.createdAt,expiresAt:trade.expiresAt,message:trade.message??'',snapshots:trade.snapshots??null});}
  #createTrade(s,user,{toUserId,give,receive,expiresInSeconds=Math.min(86400,(s.tradingPolicy?.policy??tradingDefaults).maxExpirySeconds),message='',versions={},parentTradeId=null},preview=false){
    this.#workflow(s,'trading',!!(give?.currencies?.length||receive?.currencies?.length));
    integer(expiresInSeconds,'expiry seconds',1,604800);
    check(typeof message==='string'&&message.length<=500,'INVALID_INPUT','Trade message must be at most 500 characters');jsonObject(versions,'card versions');
      check(toUserId!==user.id && s.users[toUserId],'INVALID_INPUT','Choose another registered user');
      check(!this.#blocked(s,user.id,toUserId),'TRADE_BLOCKED','Trading between these accounts is blocked',403);
      if(receive?.copyIds?.length)check(this.#preferences(s.users[toUserId]).inventoryVisibility!=='private','INVENTORY_PRIVATE','Recipient inventory is private',403);
      const given=this.#offer(s,user.id,give,toUserId), requested=this.#offer(s,toUserId,receive,user.id);
      this.#checkTrade(s,{fromUserId:user.id,toUserId,give:given,receive:requested,expiresInSeconds});
      check(given.copyIds.length+given.currencies.length+requested.copyIds.length+requested.currencies.length>0,'INVALID_INPUT','Empty trade');
      const ids=[...given.copyIds,...requested.copyIds];for(const copyId of ids)if(versions[copyId]!==undefined)check(s.copies[copyId].version===versions[copyId],'STALE_INVENTORY','A card changed; reload the inventories',409);
      if(preview)return {channel:'trade',fromUserId:user.id,toUserId,give:given,receive:requested,expiresInSeconds};
      const snapshots=Object.fromEntries(ids.map(copyId=>[copyId,this.#copyView(s,s.copies[copyId],null)]));
      const trade={id:id(),fromUserId:user.id,toUserId,give:given,receive:requested,status:'pending',createdAt:this.#clock(),
        expiresAt:new Date(Date.parse(this.#clock())+expiresInSeconds*1000).toISOString(),message,snapshots,parentTradeId};
      trade.digest=this.#tradeDigest(trade);
      s.trades[trade.id]=trade;
      for(const copyId of given.copyIds) s.copies[copyId].lockedBy=trade.id;
      for(const money of given.currencies) this.#adjust(s,user.id,money.currencyId,-money.amount,'trade.escrow',trade.id);
      this.#notify(s,toUserId,'trade.received',{tradeId:trade.id,fromName:user.displayName});
      return trade;
  }
  #tradeRecords(actor,key,type,input,fallback,policyCommit,readFn){
    if(!this.#store.transactRecords)return fallback();const expiring=type==='trade.expired';if(!expiring&&!readFn)text(key,'idempotency key',128);const proposal=type==='trade.proposed',counter=type==='trade.countered',accepting=type==='trade.accepted',admission=proposal||counter;
    const execute=()=> (readFn?fn=>this.#query(fn):fn=>this.#store.transactRecords(fn,counter?{tradeCounter:true}:accepting?{tradeAcceptance:true}:proposal?{tradeProposal:true}:{tradeCompletion:true}))(tx=>{
      const candidate=expiring?tx.get('trades',input.tradeId):null;if(expiring&&(candidate?.status!=='pending'||!(Date.parse(candidate.expiresAt)<=Date.parse(this.#clock()))))return false;const user=expiring?tx.get('users',candidate.fromUserId):this.#queryUser(tx,actor),token=expiring?null:user.id+':'+key,hash=fingerprint({type,input}),previous=expiring||readFn?null:tx.get('requests',token);if(previous){check(previous.hash===hash,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409);return previous.result;}
      let accounting;const rawAccounting=tx.value(recordAccountingField);try{accounting=JSON.parse(rawAccounting);}catch{}if(expiring&&rawAccounting!==undefined&&(!accounting||accounting.revision===tx.value('revision')))check(validRecordAccounting(accounting,tx.value('revision')),'INVALID_STATE','Invalid record accounting',500);check(validRecordAccounting(accounting,tx.value('revision')),admission?'RECORD_MIGRATION_REQUIRED':'RECORD_PATH_UNAVAILABLE','Prepare revision-bound record accounting',503);
      let trade;if(!proposal){trade=candidate??(typeof input.tradeId==='string'?tx.get('trades',input.tradeId):undefined);check(trade&&(counter||accepting?trade.toUserId===user.id:[trade.fromUserId,trade.toUserId].includes(user.id)),'NOT_FOUND','Trade not found',404);check(trade.status==='pending','TRADE_CLOSED','Trade already closed',409);}
      const sender=trade?.fromUserId??user.id,recipient=trade?.toUserId??input.toUserId,users=Object.create(null);users[user.id]=user;
      const loadUser=id=>{if(typeof id==='string'&&!Object.hasOwn(users,id)){const row=tx.get('users',id);if(row)users[id]=row;}};for(const id of [sender,recipient])loadUser(id);
      const offered=proposal?[input.give,input.receive]:counter?[trade.give,trade.receive,input.give,input.receive]:accepting?[trade.give,trade.receive]:[trade.give],copies=Object.create(null),codes=Object.create(null);
      for(const offer of offered){check(offer&&Array.isArray(offer.copyIds)&&Array.isArray(offer.currencies),'INVALID_INPUT','Trade offers need copyIds and currencies arrays');check(offer.copyIds.length<=1000&&offer.currencies.length<=100,'INVALID_INPUT','Trade offer too large');for(const id of offer.copyIds){if(typeof id!=='string')continue;const copy=tx.get('copies',id);if(copy){copies[id]=copy;loadUser(copy.openedBy);for(const codeId of copy.codeIds??[]){const code=tx.get('codes',codeId);check(code,'INVALID_STATE','Attached code is missing',500);codes[codeId]=code;}}}}
      const albums=Object.create(null),references=Object.create(null);if(accepting)for(const id of Object.keys(copies)){const refs=tx.get('_copyReferences',id);check(refs&&Array.isArray(refs.users)&&Array.isArray(refs.albums),'INVALID_STATE','Copy reference projection is missing; rebuild accounting',500);references[id]=refs;for(const userId of refs.users)loadUser(userId);for(const albumId of refs.albums){const album=tx.get('albums',albumId);check(album,'INVALID_STATE','Referenced album is missing',500);albums[albumId]=album;}}
      const balances=Object.create(null),escrows=Object.create(null),refundableEscrow=Object.create(null);for(const id of new Set([sender,recipient]))if(typeof id==='string'&&Object.hasOwn(users,id)){balances[id]=tx.get('balances',id)??{};const escrow=tx.get('_tradeEscrow',id)??{};for(const amount of Object.values(escrow))check(Number.isSafeInteger(amount)&&amount>=0,'INVALID_STATE','Invalid sender escrow projection',500);escrows[id]=escrow;refundableEscrow[id]=clone(escrow);}
      if(trade)for(const money of trade.give.currencies){check((refundableEscrow[sender][money.currencyId]??0)>=money.amount,'INVALID_STATE','Sender escrow projection is incomplete',500);refundableEscrow[sender][money.currencyId]-=money.amount;}
      const state={schemaVersion:1,revision:accounting.revision,catalog:tx.value('catalog'),adminControls:tx.value('adminControls'),cardAuthoring:tx.value('cardAuthoring'),tradingPolicy:tx.value('tradingPolicy'),users,balances,copies,codes,albums,packs:{},trades:trade?{[trade.id]:trade}:{},requests:{},ledger:[],events:[],notifications:[],completionObligations:{}};
      accounting.counts.copies=(accounting.counts.copies??0)-Object.keys(copies).length;accounting.counts.albums=(accounting.counts.albums??0)-Object.keys(albums).length;
      if(trade){const obligation=tx.get('completionObligations','trade:'+trade.id);check(obligation?.status==='reserved','RECORD_PATH_UNAVAILABLE','Trade requires compatibility reservation recovery',409);state.completionObligations[obligation.id]=obligation;accounting.counts.trades--;const part=summarizeRecords({schemaVersion:1,revision:0,trades:state.trades,completionObligations:state.completionObligations});for(const field of Object.keys(accounting.completion))accounting.completion[field]-=part.completion[field];}
      const ownerCountsById=Object.create(null);for(const id of [sender,recipient])if(typeof id==='string'&&users[id])ownerCountsById[id]=(readFn?tx.collectionCounts(id):tx.ownerCounts(id));for(const copy of Object.values(copies)){const counts=ownerCountsById[copy.ownerId]??=(readFn?tx.collectionCounts(copy.ownerId):tx.ownerCounts(copy.ownerId));if(copy.state==='owned')counts.ownedCopies--;if(copy.state==='sealed')counts.sealedCopies--;}
      recordContexts.set(state,{accounting,ownerCountsById,refundableEscrow});
      try{
        if(readFn)return readFn(state,user);
        const receipt={};
        const apply=()=>{if(policyCommit)policyCommit(state,user,receipt);const result=proposal?this.#createTrade(state,user,input):counter?this.#counterTradeBody(state,user,input):accepting?this.#acceptTradeBody(state,user,input):(this.#release(state,trade,expiring?'expired':user.id===sender?'cancelled':'declined'),trade);if(admission)this.#reserve(state,'trade',result.id);if(!expiring){state.requests[token]={hash,result:clone(result),...(!admission?{completionId:'trade:'+result.id}:{}),...(receipt.policyAdmissions?{policyAdmissions:clone(receipt.policyAdmissions)}:{})};this.#event(state,type,{userId:user.id});}this.#capacity(state,true);return result;};
        const result=admission?apply():this.#complete(state,'trade',trade.id,apply);
        const adjustEscrow=(owner,monies,sign)=>{for(const money of monies){const value=(escrows[owner][money.currencyId]??0)+sign*money.amount;check(Number.isSafeInteger(value)&&value>=0,'INVALID_STATE','Invalid sender escrow projection',500);if(value)escrows[owner][money.currencyId]=value;else delete escrows[owner][money.currencyId];}if(monies.length)tx.put('_tradeEscrow',owner,escrows[owner]);};
        if(trade)adjustEscrow(sender,trade.give.currencies,-1);if(admission)adjustEscrow(result.fromUserId,result.give.currencies,1);
        if(accepting&&trade.status==='accepted')for(const [id,refs]of Object.entries(references))tx.put('_copyReferences',id,{users:refs.users.filter(userId=>users[userId]?.preferences?.favoriteCopyIds?.includes(id)),albums:refs.albums.filter(albumId=>albums[albumId].placements.some(row=>row.copyId===id))});
        for(const field of ['users','albums','balances','copies','codes','trades','requests','actionJobs','completionObligations'])for(const [id,row]of Object.entries(state[field]??{}))tx.put(field,id,row);
        for(const field of ['ledger','events','notifications'])for(const row of state[field])tx.append(field,row);
        for(const id of new Set(state.notifications.map(row=>row.userId)))tx.trimNotifications(id);
        if(!admission)tx.reserveTradeCompletion('trade:'+trade.id);return result;
      }finally{this.#transferPolicies.clear(state);recordContexts.delete(state);}
    });
    try{return execute();}catch(error){if(readFn&&['RECORD_MIGRATION_REQUIRED','RECORD_PATH_UNAVAILABLE','TRANSACTION_BUDGET'].includes(error.code))return fallback();if(error.code==='RECORD_MIGRATION_REQUIRED'){this.#store.read(state=>{this.#workflow(state,'trading',!!(input.give?.currencies?.length||input.receive?.currencies?.length));this.#admission(state);});this.#store.prepareRecordTransactions();try{return execute();}catch(retry){if(['RECORD_PATH_UNAVAILABLE','TRANSACTION_BUDGET'].includes(retry.code))return fallback();throw retry;}}if(['RECORD_PATH_UNAVAILABLE','TRANSACTION_BUDGET'].includes(error.code))return fallback();throw error;}
  }
  #tradeRead(actor,type,input,fn){return this.#tradeRecords(actor,null,type,input,()=>this.#store.read(s=>fn(s,this.#user(s,actor))),null,fn);}
  #counterPreview(s,user,input){
    const old=s.trades[input.tradeId];check(old&&old.toUserId===user.id,'NOT_FOUND','Trade not found',404);
    check(old.status==='pending'&&Date.parse(old.expiresAt)>Date.parse(this.#clock()),'TRADE_CLOSED','Offer is no longer active',409);
    if(input.expectedDigest!==undefined)check(input.expectedDigest===this.#tradeDigest(old),'TRADE_CHANGED','Review the current offer',409);
    // The overlay refunds escrow only in this isolated read snapshot.
    const overlay=clone(s);for(const copyId of old.give.copyIds){const c=overlay.copies[copyId];check(c?.ownerId===old.fromUserId&&c.lockedBy===old.id,'TRADE_CONFLICT','Escrow changed',409);delete c.lockedBy;}
    for(const money of old.give.currencies){const value=(overlay.balances[old.fromUserId][money.currencyId]??0)+money.amount;check(Number.isSafeInteger(value),'INVALID_STATE','Escrow balance exceeds integer range',500);overlay.balances[old.fromUserId][money.currencyId]=value;}
    return this.#nativePolicyRead(overlay,()=>this.#createTrade(overlay,overlay.users[user.id],{...input,toUserId:old.fromUserId},true));
  }
  #tradePreview(s,user,type,input){
    if(type==='trade.countered')return this.#counterPreview(s,user,input);
    if(type==='trade.accepted')return this.#nativePolicyRead(s,()=>this.#acceptTradeBody(s,user,input,true));
    return this.#nativePolicyRead(s,()=>this.#createTrade(s,user,input,true));
  }
  #tradeDependencies(s,context,input){
    const ids=[...context.give.copyIds,...context.receive.copyIds],parties=[context.fromUserId,context.toUserId];
    return contentDigest({input,context,copies:ids.map(id=>s.copies[id]),codes:ids.flatMap(id=>s.copies[id]?.codeIds??[]).map(id=>{const c=s.codes[id];return c?{id:c.id,status:c.status,holderId:c.holderId,transfer:c.transfer,revealedAt:c.revealedAt,reportedUsed:c.reportedUsed}:null;}),
      parties:parties.map(id=>({user:s.users[id],balances:s.balances[id]})),trade:input.tradeId?s.trades[input.tradeId]:null,catalogVersion:s.catalog?.version,adminRevision:adminRevision(s),tradingPolicy:s.tradingPolicy,cardRevision:s.cardAuthoring?.revision??0});
  }
  #tradeContexts(s,context){
    const legs=[[context.fromUserId,context.toUserId,context.give.copyIds],[context.toUserId,context.fromUserId,context.receive.copyIds]].filter(([, ,ids])=>ids.length).map(([fromUserId,toUserId,copyIds])=>({fromUserId,toUserId,copyIds:clone(copyIds),versions:copyIds.map(id=>s.copies[id].version)}));
    return {canTransfer:legs.length?{channel:'trade',legs}:null,canTrade:context};
  }
  async #tradeAsync(actor,key,type,input,{signal}={}){
    const principal=clone(actor);input=clone(input);const previous=this.#purchaseReceipt(principal,key,input,type);if(previous.found)return previous.result;
    const prepared=this.#tradeRead(principal,type,input,(s,u)=>{const context=this.#tradePreview(s,u,type,input);return context?{context,contexts:this.#tradeContexts(s,context),snapshotDigest:this.#tradeDependencies(s,context,input)}:{expired:true};});
    let batch;if(!prepared.expired){batch=this.#transferPolicies.prepare({phase:type==='trade.proposed'?'propose':type==='trade.countered'?'counter':'accept',userId:principal.userId,key,input,...prepared});await this.#transferPolicies.evaluate(batch,{signal});}
    const commit=(s,u,receipt)=>{if(!batch)return;const context=this.#tradePreview(s,u,type,input);check(context,'POLICY_STALE','Trade expired during policy evaluation',409);receipt.policyAdmissions=this.#transferPolicies.admit(s,batch,this.#tradeDependencies(s,context,input),{signal});};
    const body=(s,u)=>type==='trade.proposed'?this.#createTrade(s,u,input):type==='trade.countered'?this.#counterTradeBody(s,u,input):this.#acceptTradeBody(s,u,input);
    return this.#tradeRecords(principal,key,type,input,()=>{const receipt={};return this.#command(principal,key,type,input,(s,u)=>{try{commit(s,u,receipt);return body(s,u);}finally{this.#transferPolicies.clear(s);}},receipt);},commit);
  }
  proposeTradeAsync(actor,{key,toUserId,give,receive,expiresInSeconds,message='',versions={} },options){return this.#tradeAsync(actor,key,'trade.proposed',{toUserId,give,receive,expiresInSeconds,message,versions},options);}
  counterTradeAsync(actor,{key,tradeId,give,receive,message='',expiresInSeconds,expectedDigest,versions},options){return this.#tradeAsync(actor,key,'trade.countered',{tradeId,give,receive,message,expiresInSeconds,expectedDigest,...(versions===undefined?{}:{versions})},options);}
  acceptTradeAsync(actor,{key,tradeId,expectedDigest},options){return this.#tradeAsync(actor,key,'trade.accepted',{tradeId,expectedDigest},options);}
  async reviewTransferAsync(actor,input,{signal}={}){
    const principal=clone(actor),clean=clone(input);check(clean&&typeof clean==='object'&&!Array.isArray(clean)&&Object.keys(clean).every(k=>['toUserId','give','receive','versions','expiresInSeconds','message','parentTradeId','expectedDigest'].includes(k)),'INVALID_INPUT','Unknown transfer review field');
    if(clean.parentTradeId!==undefined)check(typeof clean.expectedDigest==='string','REVIEW_REQUIRED','Counter review requires the current offer digest',409);else check(clean.expectedDigest===undefined,'INVALID_INPUT','Trade digest requires a parent offer');
    const type=clean.parentTradeId!==undefined?'trade.countered':'trade.proposed',command={...clean,message:clean.message??'',versions:clean.versions??{},...(clean.parentTradeId!==undefined?{tradeId:clean.parentTradeId}:{})};
    const read=(s,u)=>{if(type==='trade.countered'){const old=s.trades[command.tradeId];check(old?.fromUserId===clean.toUserId,'INVALID_INPUT','Counter recipient differs from the parent offer');}const context=this.#tradePreview(s,u,type,command);return {context,contexts:this.#tradeContexts(s,context),snapshotDigest:this.#tradeDependencies(s,context,command),copyIds:[...context.give.copyIds,...context.receive.copyIds]};};
    const prepared=this.#tradeRead(principal,type,command,read),batch=this.#transferPolicies.prepare({phase:'review',userId:principal.userId,input:command,...prepared});await this.#transferPolicies.evaluate(batch,{signal});
    return this.#tradeRead(principal,type,command,(s,u)=>{try{const current=read(s,u);this.#transferPolicies.admit(s,batch,current.snapshotDigest,{signal});for(const leg of current.contexts.canTransfer?.legs??[])for(const id of leg.copyIds){const copy=clone(s.copies[id]);if(clean.parentTradeId&&copy.lockedBy===clean.parentTradeId)delete copy.lockedBy;const reason=this.#tradeReason(copy,leg.fromUserId,s,{toUserId:leg.toUserId,ignoreLock:true});check(!reason,'TRANSFER_BLOCKED',reason,409);}this.#checkTrade(s,current.context);return this.#transferPolicies.review(batch,contentDigest(command),current.snapshotDigest,current.copyIds);}finally{this.#transferPolicies.clear(s);}});
  }
  proposeTrade(actor,{key,toUserId,give,receive,expiresInSeconds,message='',versions={}}) {
    const input={toUserId,give,receive,expiresInSeconds,message,versions};if(this.#remoteTransferPolicy||this.#remoteTradePolicy){const previous=this.#purchaseReceipt(actor,key,input,'trade.proposed');if(previous.found)return previous.result;check(false,'POLICY_ASYNC_REQUIRED','Use asynchronous transfer policy evaluation',503);}return this.#tradeRecords(actor,key,'trade.proposed',input,()=>this.#command(actor,key,'trade.proposed',input,(s,user)=>this.#createTrade(s,user,input)));
  }
  counterTrade(actor,{key,tradeId,give,receive,message='',expiresInSeconds,expectedDigest,versions}){
    const input={tradeId,give,receive,message,expiresInSeconds,expectedDigest,...(versions===undefined?{}:{versions})};if(this.#remoteTransferPolicy||this.#remoteTradePolicy){const previous=this.#purchaseReceipt(actor,key,input,'trade.countered');if(previous.found)return previous.result;check(false,'POLICY_ASYNC_REQUIRED','Use asynchronous transfer policy evaluation',503);}return this.#tradeRecords(actor,key,'trade.countered',input,()=>this.#command(actor,key,'trade.countered',input,(s,u)=>this.#counterTradeBody(s,u,input)));
  }
  #counterTradeBody(s,u,{tradeId,give,receive,message='',expiresInSeconds,expectedDigest,versions}){
      const old=s.trades[tradeId];check(old&&old.toUserId===u.id,'NOT_FOUND','Trade not found',404);check(old.status==='pending'&&Date.parse(old.expiresAt)>Date.parse(this.#clock()),'TRADE_CLOSED','Offer is no longer active',409);
      if(expectedDigest!==undefined)check(expectedDigest===this.#tradeDigest(old),'TRADE_CHANGED','Review the current offer',409);
      this.#release(s,old,'countered');const counter=this.#createTrade(s,u,{toUserId:old.fromUserId,give,receive,message,expiresInSeconds,versions,parentTradeId:old.id});old.counterTradeId=counter.id;return counter;
  }
  #release(s,trade,status) {return this.#complete(s,'trade',trade.id,()=>{
    trade.status=status; trade.completedAt=this.#clock();
    for(const copyId of trade.give.copyIds) delete s.copies[copyId].lockedBy;
    for(const money of trade.give.currencies) this.#adjust(s,trade.fromUserId,money.currencyId,money.amount,'trade.refund',trade.id);
    this.#event(s,'trade.'+status,{tradeId:trade.id});
    this.#notify(s,trade.fromUserId,'trade.'+status,{tradeId:trade.id});this.#notify(s,trade.toUserId,'trade.'+status,{tradeId:trade.id});
  });}

  #raffleRecords(actor,key,type,input,fn,mode='enter'){
    const reading=mode==='read',drawing=mode==='draw',collection=drawing?'operatorRequests':'requests';
    const fallback=()=>reading?this.#store.read(s=>fn(s)):drawing?this.#operatorCommand(actor,key,'raffles.draw',type,input,fn):this.#command(actor,key,type,input,fn);
    if(drawing)this.#admin(actor,'raffles.draw');if(!reading)text(key,'idempotency key',128);
    if(!this.#store.transactRecords)return fallback();let invoked=false;
    const run=reading?callback=>this.#query(callback):(callback,options)=>this.#store.transactRecords(callback,options);
    try{return run(tx=>{
      const user=drawing?null:this.#queryUser(tx,actor),token=(drawing?(actor.userId??'operator'):user.id)+':'+key,hash=fingerprint({type,input});
      if(!reading){const previous=tx.get(collection,token);if(previous){check(previous.hash===hash,'IDEMPOTENCY_CONFLICT',drawing?'Operator key already used':'Request key was used for another command',409);return previous.result;}}
      const listing=typeof input.listingId==='string'?tx.get('listings',input.listingId):undefined;check(listing?.raffle,'NOT_FOUND','Raffle not found',404);
      if(reading){invoked=true;return fn({users:{[user.id]:user},listings:{[listing.id]:listing}},user);}
      let accounting;const raw=tx.value(recordAccountingField);try{accounting=JSON.parse(raw);}catch{}
      if(raw!==undefined&&(!accounting||accounting.revision===tx.value('revision')))check(validRecordAccounting(accounting,tx.value('revision')),'INVALID_STATE','Invalid record accounting',500);
      check(validRecordAccounting(accounting,tx.value('revision')),'RECORD_PATH_UNAVAILABLE','Prepare revision-bound record accounting',503);
      const users=user?{[user.id]:user}:{},seller=drawing?null:tx.get('users',listing.sellerId),shop=drawing?null:tx.get('shops',listing.shopId);if(seller)users[seller.id]=seller;
      const state={schemaVersion:1,revision:accounting.revision,catalog:drawing?null:tx.value('catalog'),adminControls:drawing?null:tx.value('adminControls'),commerceSettings:drawing?null:tx.value('commerceSettings'),users,shops:shop?{[shop.id]:shop}:{},listings:{[listing.id]:listing},copies:{},packs:{},requests:{},operatorRequests:{},events:[],notifications:[],actionJobs:{},completionObligations:{}};
      const obligation=tx.get('completionObligations','listing:'+listing.id);check(obligation,'RECORD_PATH_UNAVAILABLE','Raffle requires compatibility reservation recovery',409);state.completionObligations[obligation.id]=obligation;
      const part=summarizeRecords(state);accounting.counts.listings--;if(shop)accounting.counts.shops--;for(const field of Object.keys(accounting.completion))accounting.completion[field]-=part.completion[field];
      // Entries are embedded: this scope grows with this raffle, not unrelated listings.
      const winners=drawing&&!listing.draw?Math.min(Object.keys(listing.entries).length,listing.raffle.winners,listing.units.length):0;
      check(winners*3+this.#subscriptions.length*3<3000&&Buffer.byteLength(JSON.stringify(state))*3+winners*1024<8*1024*1024,'RECORD_PATH_UNAVAILABLE','Raffle requires compatibility scope',409);
      recordContexts.set(state,{accounting});
      try{invoked=true;const result=fn(state,user);state[collection][token]={hash,result:clone(result)};this.#event(state,type,{userId:drawing?actor.userId??null:user.id});this.#capacity(state,true);
        for(const field of ['listings',collection,'actionJobs','completionObligations'])for(const [id,row]of Object.entries(state[field]))tx.put(field,id,row);
        for(const field of ['events','notifications'])for(const row of state[field])tx.append(field,row);for(const id of new Set(state.notifications.map(row=>row.userId)))tx.trimNotifications(id);return result;
      }finally{recordContexts.delete(state);}
    },{raffle:true,raffleDraw:drawing});}catch(error){if(!invoked&&['RECORD_PATH_UNAVAILABLE','TRANSACTION_BUDGET'].includes(error.code))return fallback();throw error;}
  }
  #createListingRecords(actor,key,input,fn,creating=true,receipt,allocation){
    const type='listing.created',fallback=()=>creating?this.#command(actor,key,type,input,fn,receipt):this.#store.read(s=>fn(s,this.#user(s,actor)));if(creating)text(key,'idempotency key',128);
    if(!this.#store.transactRecords)return fallback();let invoked=false;
    const run=allocation?(fn)=>fn(allocation.tx):creating?(fn,options)=>this.#store.transactRecords(fn,options):fn=>this.#query(q=>fn({...q,ownerCounts:id=>q.collectionCounts(id)}));
    try{return run(tx=>{
      const user=this.#queryUser(tx,actor),token=user.id+':'+key,hash=fingerprint({type,input}),previous=tx.get('requests',token);
      if(creating&&previous){check(previous.hash===hash,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409);return previous.result;}
      let accounting;const raw=tx.value(recordAccountingField);try{accounting=JSON.parse(raw);}catch{}
      if(raw!==undefined&&(!accounting||accounting.revision===tx.value('revision')))check(validRecordAccounting(accounting,tx.value('revision')),'INVALID_STATE','Invalid record accounting',500);
      check(validRecordAccounting(accounting,tx.value('revision'))&&tx.value('_listingCreationReady')===true&&tx.value('_listingCreationRevision')===accounting.revision,'RECORD_PATH_UNAVAILABLE','Prepare listing creation projections',503);
      const shop=typeof input.shopId==='string'?tx.get('shops',input.shopId):null,users={[user.id]:user};
      if(shop?.ownerId!==user.id&&shop?.ownerId){const seller=tx.get('users',shop.ownerId);if(seller)users[seller.id]=seller;}
      const state={schemaVersion:1,revision:accounting.revision,catalog:tx.value('catalog'),adminControls:tx.value('adminControls'),cardAuthoring:tx.value('cardAuthoring'),tradingPolicy:tx.value('tradingPolicy'),commerceSettings:tx.value('commerceSettings'),users,shops:shop?{[shop.id]:shop}:{},copies:{},packs:{},codes:{},codePools:{},supply:{},pity:{},cardValidation:{},listings:{},orders:{},trades:{},requests:{},events:[],ledger:[],notifications:[],completionObligations:{}};
      const items=input.items,copyIds=new Set();
      if(['copies','packs'].includes(items.kind)&&Array.isArray(items.ids))for(const id of items.ids){if(typeof id!=='string')continue;if(items.kind==='copies')copyIds.add(id);else{const pack=tx.get('packs',id);if(pack){state.packs[id]=pack;for(const copyId of pack.copyIds)copyIds.add(copyId);const obligation=tx.get('completionObligations','pack:'+id);check(obligation?.status==='reserved','RECORD_PATH_UNAVAILABLE','Stock pack requires its reservation',409);state.completionObligations[obligation.id]=obligation;}}}
      for(const id of copyIds){const copy=tx.get('copies',id);if(!copy)continue;state.copies[id]=copy;for(const codeId of copy.codeIds??[]){const code=tx.get('codes',codeId);check(code,'INVALID_STATE','Attached stock code missing',500);state.codes[codeId]=code;}}
      const product=items.kind==='mint-pack'?effectiveProduct(state,state.catalog?.products.find(row=>row.id===items.productId)):null;
      const variantIds=items.kind==='mint-card'?[items.variantId]:product?[...new Set(product.slots.flatMap(slot=>slot.pool.map(entry=>entry.variantId)))]:[];
      for(const variantId of variantIds){if(typeof variantId!=='string')continue;state.supply[variantId]=tx.get('supply',variantId)??0;const validation=tx.get('cardValidation',variantId);if(validation)state.cardValidation[variantId]=validation;}
      const variants=variantIds.map(id=>state.catalog?.variants.find(row=>row.id===id)).filter(Boolean);
      const demand=new Map(),addDemand=(variantIds,count)=>{for(const poolId of new Set(variantIds.flatMap(id=>(state.catalog?.variants.find(row=>row.id===id)?.codes??[]).map(spec=>spec.poolId)))){const maximum=Math.max(0,...variantIds.map(id=>(state.catalog?.variants.find(row=>row.id===id)?.codes??[]).filter(spec=>spec.poolId===poolId).length));demand.set(poolId,(demand.get(poolId)??0)+maximum*count);}};
      if(Number.isSafeInteger(items.quantity)&&items.quantity>0){if(items.kind==='mint-card')addDemand(variantIds,items.quantity);else if(product)for(const slot of product.slots)addDemand(slot.pool.map(entry=>entry.variantId),items.quantity*slot.count);}
      if(product?.allocationStrategy?.version>=3){state.allocationFactorySnapshot=this.#bindingFactories.prepare(user,variants,product,items.quantity);state.allocationCodeResources=this.#loadAllocationCodes(state,variants,product,items.quantity,tx);}else for(const [poolId,needed]of demand){const pool=tx.get('codePools',poolId);if(pool){state.codePools[poolId]=pool;if(!pool.generator)for(const code of tx.availableCodeStock(poolId,needed,this.#clock()))state.codes[code.id]=code;}}
      const ownerCountsById={};if(shop){const counts=tx.ownerCounts(shop.ownerId);for(const copy of Object.values(state.copies)){if(copy.ownerId===shop.ownerId){if(copy.state==='owned')counts.ownedCopies--;if(copy.state==='sealed')counts.sealedCopies--;}}for(const pack of Object.values(state.packs))if(pack.ownerId===shop.ownerId){counts.packs--;if(!pack.openedAt)counts.unopenedPacks--;}ownerCountsById[shop.ownerId]=counts;if(items.kind==='mint-pack')state.pity[shop.ownerId]=tx.get('pity',shop.ownerId)??{};}
      const part=summarizeRecords(state);for(const field of ['copies','packs','shops'])accounting.counts[field]-=part.counts[field]??0;for(const field of Object.keys(accounting.completion))accounting.completion[field]-=part.completion[field];
      const quantity=Number.isSafeInteger(items.quantity)?items.quantity:0,draws=items.kind==='mint-pack'?quantity*(product?.slots.reduce((n,slot)=>n+slot.count,0)??0):items.kind==='mint-card'?quantity:0;
      check(copyIds.size*5+draws*12+Object.keys(state.codes).length*2+quantity*3<2800&&Buffer.byteLength(JSON.stringify(state))<4*1024*1024,'RECORD_PATH_UNAVAILABLE','Listing creation requires compatibility scope',409);
      const codeCount=(creating?tx.count('codes'):accounting.counts.codes??0)-Object.keys(state.codes).length,activeShopListings=shop?(tx.get('_shopListingCounts',shop.id)??0):0;
      recordContexts.set(state,{accounting,ownerCountsById,activeShopListings,codeCount,codeIdentityExists:(fingerprint,providerId,externalId)=>!!tx.get('_codeIdentities',JSON.stringify(['fingerprint',fingerprint]))||!!(externalId&&tx.get('_codeIdentities',JSON.stringify(['external',providerId,externalId])))});
      if(allocation?.plan)this.#allocationAdmissions.set(state,{productId:items.productId,quantity:items.quantity,plan:allocation.plan,scope:'commerce-stock',selection:allocation.factory?.selection??allocation.generated?.batch.selection,factoryCopies:allocation.factory?.copies});
      const codeAdmission=allocation?.codeSnapshot?this.#codes.admitAllocation(state,allocation.codeSnapshot,allocation.generated):null;try{invoked=true;const result=fn(state,user);if(codeAdmission)allocation.codeAssignments?.push(...codeAdmission.assignments);if(!creating)return result;this.#reserve(state,'listing',result.id);state.requests[token]={hash,result:clone(result),...(allocation?.attemptId?{allocationAttemptId:allocation.attemptId}:{}),...(receipt?.policyAdmission?{policyAdmission:clone(receipt.policyAdmission)}:{}),...(receipt?.policyAdmissions?{policyAdmissions:clone(receipt.policyAdmissions)}:{})};this.#event(state,type,{userId:user.id});this.#capacity(state,true);
        for(const field of ['supply','pity','copies','packs','codes','listings','requests','actionJobs','completionObligations'])for(const [id,row]of Object.entries(state[field]??{}))tx.put(field,id,row);
        for(const row of state.events)tx.append('events',row);return result;
      }finally{this.#codes.releaseAllocation(state);this.#allocationAdmissions.delete(state);recordContexts.delete(state);}
    },creating?{listingCreation:true}:{});}catch(error){if(allocation&&['RECORD_PATH_UNAVAILABLE','TRANSACTION_BUDGET'].includes(error.code))check(false,'ALLOCATION_LIMIT','Stock allocation requires a bounded listing transaction',502);if(!allocation&&!invoked&&['RECORD_PATH_UNAVAILABLE','TRANSACTION_BUDGET'].includes(error.code))return fallback();throw error;}
  }
  #listingRecords(actor,key,input,fn,purchasing=true,receipt){
    const type='shop.purchased';
    const fallback=()=>purchasing?this.#command(actor,key,type,input,fn,receipt):this.#store.read(s=>fn(s));
    if(!this.#store.transactRecords)return fallback();if(purchasing)text(key,'idempotency key',128);
    let invoked=false;
    const run=purchasing?(fn,options)=>this.#store.transactRecords(fn,options):fn=>this.#query(q=>fn({...q,ownerCounts:id=>q.collectionCounts(id)}));
    try{return run(tx=>{
      const user=this.#queryUser(tx,actor),token=user.id+':'+key,hash=fingerprint({type,input});
      if(purchasing){const previous=tx.get('requests',token);if(previous){check(previous.hash===hash,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409);return previous.result;}}
      let accounting;const raw=tx.value(recordAccountingField);try{accounting=JSON.parse(raw);}catch{}
      if(raw!==undefined&&(!accounting||accounting.revision===tx.value('revision')))check(validRecordAccounting(accounting,tx.value('revision')),'INVALID_STATE','Invalid record accounting',500);
      check(validRecordAccounting(accounting,tx.value('revision'))&&tx.value('_listingPurchasesReady')===true&&tx.value('_listingPurchasesRevision')===accounting.revision,'RECORD_PATH_UNAVAILABLE','Prepare listing purchase projections',503);
      const listing=typeof input.listingId==='string'?tx.get('listings',input.listingId):undefined;check(listing,'NOT_FOUND','Listing not found',404);
      integer(input.quantity,'quantity',1,1000);
      const quotaKey=JSON.stringify([listing.id,user.id]),purchased=tx.get('_listingPurchases',quotaKey)??0;check(Number.isSafeInteger(purchased)&&purchased>=0,'INVALID_STATE','Invalid listing purchase projection',500);
      const users=Object.create(null),copies=Object.create(null),packs=Object.create(null),codes=Object.create(null),albums=Object.create(null),references=Object.create(null),obligations=Object.create(null);
      users[user.id]=user;const loadUser=id=>{if(typeof id==='string'&&!Object.hasOwn(users,id)){const row=tx.get('users',id);check(row,'INVALID_STATE','Referenced account is missing',500);users[id]=row;}};loadUser(listing.sellerId);
      const winner=listing.raffle?listing.draw?.winners.find(w=>w.userId===user.id):null;
      const units=listing.units.filter(unit=>unit.status==='available'&&(!listing.raffle||unit.id===winner?.unitId)).slice(0,input.quantity);
      const copyIds=new Set();for(const unit of units){if(unit.kind==='copy')copyIds.add(unit.copyId);else if(unit.kind==='pack'){const pack=tx.get('packs',unit.packId);if(pack){packs[pack.id]=pack;for(const id of pack.copyIds)copyIds.add(id);if(!pack.receipt){const obligation=tx.get('completionObligations','pack:'+pack.id);check(obligation?.status==='reserved','RECORD_PATH_UNAVAILABLE','Listed pack requires its reservation',409);obligations[obligation.id]=obligation;}}}}
      for(const id of copyIds){const copy=tx.get('copies',id);if(!copy)continue;copies[id]=copy;loadUser(copy.openedBy);for(const codeId of copy.codeIds??[]){const code=tx.get('codes',codeId);check(code,'INVALID_STATE','Attached code is missing',500);codes[codeId]=code;}if(purchasing){const refs=tx.get('_copyReferences',id);check(refs&&Array.isArray(refs.users)&&Array.isArray(refs.albums),'INVALID_STATE','Copy reference projection is missing; rebuild accounting',500);references[id]=refs;for(const id of refs.users)loadUser(id);for(const id of refs.albums){const album=tx.get('albums',id);check(album,'INVALID_STATE','Referenced album is missing',500);albums[id]=album;}}}
      const listingObligation=tx.get('completionObligations','listing:'+listing.id);check(listingObligation?.status==='reserved','RECORD_PATH_UNAVAILABLE','Listing requires its reservation',409);obligations[listingObligation.id]=listingObligation;
      const balances=Object.create(null),refundableEscrow=Object.create(null),ownerCountsById=Object.create(null);for(const id of new Set([user.id,listing.sellerId])){balances[id]=tx.get('balances',id)??{};refundableEscrow[id]=tx.get('_tradeEscrow',id)??{};ownerCountsById[id]=tx.ownerCounts(id);}
      for(const copy of Object.values(copies)){const counts=ownerCountsById[copy.ownerId]??=tx.ownerCounts(copy.ownerId);if(copy.state==='owned')counts.ownedCopies--;if(copy.state==='sealed')counts.sealedCopies--;}
      for(const pack of Object.values(packs)){const counts=ownerCountsById[pack.ownerId]??=tx.ownerCounts(pack.ownerId);counts.packs--;if(!pack.openedAt)counts.unopenedPacks--;}
      const shop=tx.get('shops',listing.shopId),state={schemaVersion:1,revision:accounting.revision,catalog:tx.value('catalog'),adminControls:tx.value('adminControls'),cardAuthoring:tx.value('cardAuthoring'),tradingPolicy:tx.value('tradingPolicy'),commerceSettings:tx.value('commerceSettings'),users,balances,copies,packs,codes,albums,shops:shop?{[shop.id]:shop}:{},listings:{[listing.id]:listing},orders:{},trades:{},requests:{},ledger:[],events:[],notifications:[],completionObligations:obligations};
      const part=summarizeRecords(state);for(const field of ['copies','packs','albums','shops','listings'])accounting.counts[field]=(accounting.counts[field]??0)-(part.counts[field]??0);for(const field of Object.keys(accounting.completion))accounting.completion[field]-=part.completion[field];
      // Reserve room for command outputs before invoking synchronous host policies.
      check(copyIds.size*8+Object.keys(users).length+Object.keys(albums).length<3000&&Buffer.byteLength(JSON.stringify(state))<8*1024*1024,'RECORD_PATH_UNAVAILABLE','Listing purchase requires the compatibility scope',409);
      recordContexts.set(state,{accounting,ownerCountsById,refundableEscrow,listingPurchases:purchased});
      try{invoked=true;const result=fn(state,user);if(!purchasing)return result;
        if(listing.units.every(unit=>unit.status!=='available'))listingObligation.status='completed';
        state.requests[token]={hash,result:clone(result),...(receipt?.policyAdmission?{policyAdmission:clone(receipt.policyAdmission)}:{}),...(receipt?.policyAdmissions?{policyAdmissions:clone(receipt.policyAdmissions)}:{})};this.#event(state,type,{userId:user.id});this.#capacity(state,true);
        tx.put('_listingPurchases',quotaKey,purchased+input.quantity);
        for(const [id,refs]of Object.entries(references))tx.put('_copyReferences',id,{users:refs.users.filter(userId=>users[userId]?.preferences?.favoriteCopyIds?.includes(id)),albums:refs.albums.filter(albumId=>albums[albumId].placements.some(row=>row.copyId===id))});
        for(const field of ['users','albums','balances','copies','packs','codes','listings','orders','requests','actionJobs','completionObligations'])for(const [id,row]of Object.entries(state[field]??{}))tx.put(field,id,row);
        for(const field of ['ledger','events','notifications'])for(const row of state[field])tx.append(field,row);for(const id of new Set(state.notifications.map(row=>row.userId)))tx.trimNotifications(id);return result;
      }finally{recordContexts.delete(state);}
    },purchasing?{listingPurchase:true}:{});}catch(error){if(!invoked&&['RECORD_PATH_UNAVAILABLE','TRANSACTION_BUDGET'].includes(error.code))return fallback();throw error;}
  }
  #cancelListingRecords(actor,key,input,fn){
    const type='listing.canceled',fallback=()=>this.#command(actor,key,type,input,fn);
    text(key,'idempotency key',128);if(!this.#store.transactRecords)return fallback();let invoked=false;
    try{return this.#store.transactRecords(tx=>{
      const user=this.#queryUser(tx,actor),token=user.id+':'+key,hash=fingerprint({type,input}),previous=tx.get('requests',token);
      if(previous){check(previous.hash===hash,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409);return previous.result;}
      let accounting;const raw=tx.value(recordAccountingField);try{accounting=JSON.parse(raw);}catch{}
      if(raw!==undefined&&(!accounting||accounting.revision===tx.value('revision')))check(validRecordAccounting(accounting,tx.value('revision')),'INVALID_STATE','Invalid record accounting',500);
      check(validRecordAccounting(accounting,tx.value('revision')),'RECORD_PATH_UNAVAILABLE','Prepare revision-bound record accounting',503);
      const listing=typeof input.listingId==='string'?tx.get('listings',input.listingId):undefined;
      check(listing&&(listing.sellerId===user.id||hasPermission(actor,'commerce.manage')),'NOT_FOUND','Listing not found',404);
      const active=listing.status==='active',obligation=active?tx.get('completionObligations','listing:'+listing.id):null;
      if(active)check(obligation&&['reserved','completed'].includes(obligation.status),'RECORD_PATH_UNAVAILABLE','Listing requires compatibility reservation recovery',409);
      const copies=Object.create(null),packs=Object.create(null),users={[user.id]:user},shop=tx.get('shops',listing.shopId);
      if(listing.sellerId!==user.id){const seller=tx.get('users',listing.sellerId);if(seller)users[seller.id]=seller;}
      if(active)for(const unit of listing.units??[]){if(unit.status!=='available')continue;if(unit.kind==='copy'){const copy=tx.get('copies',unit.copyId);if(copy)copies[unit.copyId]=copy;}else if(unit.kind==='pack'){const pack=tx.get('packs',unit.packId);if(pack){packs[pack.id]=pack;for(const id of pack.copyIds){const copy=tx.get('copies',id);if(copy)copies[id]=copy;}}}}
      const state={schemaVersion:1,revision:accounting.revision,users,shops:shop?{[shop.id]:shop}:{},listings:{[listing.id]:listing},copies,packs,requests:{},events:[],completionObligations:obligation?{[obligation.id]:obligation}:{}};
      const part=summarizeRecords(state);for(const field of ['copies','packs','shops','listings'])accounting.counts[field]-=part.counts[field]??0;for(const field of Object.keys(accounting.completion))accounting.completion[field]-=part.completion[field];
      check(Object.keys(copies).length*2+Object.keys(packs).length<3000&&Buffer.byteLength(JSON.stringify(state))<8*1024*1024,'RECORD_PATH_UNAVAILABLE','Listing cancellation requires compatibility scope',409);
      recordContexts.set(state,{accounting});
      try{
        const execute=()=>{invoked=true;const result=fn(state,user),completion=completionContext(state);state.requests[token]={hash,result:clone(result),...(completion?{completionId:completion.id}:{})};this.#event(state,type,{userId:user.id});this.#capacity(state,true);return result;};
        const result=active?this.#complete(state,'listing',listing.id,execute):execute();
        for(const field of ['listings','copies','packs','requests','actionJobs','completionObligations'])for(const [id,row]of Object.entries(state[field]??{}))tx.put(field,id,row);for(const event of state.events)tx.append('events',event);
        if(active)tx.reserveListingCompletion(obligation.id);return result;
      }finally{recordContexts.delete(state);}
    },{listingCancellation:true});}catch(error){if(!invoked&&['RECORD_PATH_UNAVAILABLE','TRANSACTION_BUDGET'].includes(error.code))return fallback();throw error;}
  }
  #expireListingRecords(listingId,release){
    const due=l=>l?.status==='active'&&[l.endsAt,l.draw?.claimUntil].some(at=>Date.parse(at)<=Date.parse(this.#clock()));
    const fallback=()=>this.#store.transact(s=>{const listing=s.listings?.[listingId];if(!due(listing))return false;this.#complete(s,'listing',listingId,()=>release(s,listing,'expired'));return true;});
    if(!this.#store.transactRecords)return fallback();
    try{return this.#store.transactRecords(tx=>{
      const listing=tx.get('listings',listingId);if(!due(listing))return false;
      let accounting;const rawAccounting=tx.value(recordAccountingField);try{accounting=JSON.parse(rawAccounting);}catch{}if(rawAccounting!==undefined&&(!accounting||accounting.revision===tx.value('revision')))check(validRecordAccounting(accounting,tx.value('revision')),'INVALID_STATE','Invalid record accounting',500);check(validRecordAccounting(accounting,tx.value('revision')),'RECORD_PATH_UNAVAILABLE','Prepare revision-bound record accounting',503);
      const obligation=tx.get('completionObligations','listing:'+listingId);check(obligation?.status==='reserved','RECORD_PATH_UNAVAILABLE','Listing requires compatibility reservation recovery',409);
      const copies=Object.create(null),packs=Object.create(null);
      for(const unit of listing.units??[]){if(unit.status!=='available')continue;if(unit.kind==='copy'){const copy=tx.get('copies',unit.copyId);if(copy)copies[unit.copyId]=copy;}else if(unit.kind==='pack'){const pack=tx.get('packs',unit.packId);if(pack){packs[pack.id]=pack;for(const id of pack.copyIds){const copy=tx.get('copies',id);if(copy)copies[id]=copy;}}}}
      const state={schemaVersion:1,revision:accounting.revision,listings:{[listingId]:listing},copies,packs,events:[],completionObligations:{[obligation.id]:obligation}};
      const part=summarizeRecords(state);for(const field of Object.keys(accounting.completion))accounting.completion[field]-=part.completion[field];
      recordContexts.set(state,{accounting});
      try{this.#complete(state,'listing',listingId,()=>release(state,listing,'expired'));for(const field of ['listings','copies','packs','actionJobs','completionObligations'])for(const [id,row]of Object.entries(state[field]??{}))tx.put(field,id,row);for(const event of state.events)tx.append('events',event);tx.reserveListingCompletion(obligation.id);return true;}finally{recordContexts.delete(state);}
    },{listingCompletion:true});}catch(error){if(['RECORD_PATH_UNAVAILABLE','TRANSACTION_BUDGET'].includes(error.code))return fallback();throw error;}
  }
  #expire() {
    const ids=this.#store.selectDueExpirations?this.#store.selectDueExpirations('trades',this.#clock(),32):this.#store.read(s=>Object.values(s.trades).filter(trade=>trade.status==='pending'&&Date.parse(trade.expiresAt)<=Date.parse(this.#clock())).slice(0,32).map(trade=>trade.id));
    const completed=[],failed=[];
    for(const tradeId of ids)try{
      const released=this.#tradeRecords(null,null,'trade.expired',{tradeId},()=>this.#store.transact(s=>{
        const trade=s.trades[tradeId];
        if(trade?.status!=='pending'||!(Date.parse(trade.expiresAt)<=Date.parse(this.#clock())))return false;
        this.#complete(s,'trade',trade.id,()=>this.#release(s,trade,'expired'));return true;
      }));
      if(released)completed.push(tradeId);
    }catch(error){failed.push({tradeId,code:/^[A-Z][A-Z0-9_]{0,80}$/.test(error?.code)?error.code:'INTERNAL_ERROR'});}
    return {ok:failed.length===0,completed,failed};
  }
  sweepExpiredTrades(actor) {this.#admin(actor,'maintenance.run');return this.#expire();}
  trades(actor) {
    this.#store.read(s=>this.#user(s,actor));
    this.#expire();
    return this.#store.read(s=>{const u=this.#user(s,actor);return Object.values(s.trades).filter(t=>t.fromUserId===u.id||t.toUserId===u.id).map(t=>({...t,digest:this.#tradeDigest(t),fromName:s.users[t.fromUserId].displayName,toName:s.users[t.toUserId].displayName}));});
  }
  #transfer(s,copyId,from,to,tradeId) {
    const copy=s.copies[copyId]; copy.ownerId=to; copy.acquiredAt=this.#clock(); copy.version++;
    delete copy.lockedBy;
    for(const b of Object.values(copy.bindings)) if(b.transfer==='follow') b.holderId=to;
    this.#codes.transfer(s,copy,from,to,tradeId,this.#clock());
    copy.metadata.transfers??=[]; copy.metadata.transfers.push({from,to,tradeId,at:this.#clock()});
    this.#event(s,'card.transferred',{copyId,from,to,tradeId});
  }
  acceptTrade(actor,{key,tradeId,expectedDigest}){
    const input={tradeId,expectedDigest};if(this.#remoteTransferPolicy||this.#remoteTradePolicy){const previous=this.#purchaseReceipt(actor,key,input,'trade.accepted');if(previous.found)return previous.result;check(false,'POLICY_ASYNC_REQUIRED','Use asynchronous transfer policy evaluation',503);}return this.#tradeRecords(actor,key,'trade.accepted',input,()=>this.#command(actor,key,'trade.accepted',input,(s,u)=>this.#acceptTradeBody(s,u,input)));
  }
  #acceptTradeBody(s,user,{tradeId,expectedDigest},preview=false){
      const trade=s.trades[tradeId];
      check(trade && trade.toUserId===user.id,'NOT_FOUND','Trade not found',404);
      check(trade.status==='pending','TRADE_CLOSED','Trade already closed',409);
      if(expectedDigest!==undefined)check(expectedDigest===this.#tradeDigest(trade),'TRADE_CHANGED','Review the current offer',409);
      if(Date.parse(trade.expiresAt)<=Date.parse(this.#clock())) {if(preview)return null;this.#release(s,trade,'expired'); return trade;}
      check(!this.#blocked(s,trade.fromUserId,trade.toUserId),'TRADE_BLOCKED','Trading between these accounts is blocked',403);
      for(const [copyId,snapshot]of Object.entries(trade.snapshots??{}))check(s.copies[copyId]?.version===snapshot.version,'STALE_INVENTORY','A card changed after this offer; request a new offer',409);
      this.#checkTrade(s,{fromUserId:trade.fromUserId,toUserId:trade.toUserId,give:trade.give,receive:trade.receive});
      // Accepted escrow can drain after workflow disable; current transfer policies still apply.
      for(const copyId of trade.give.copyIds) {
        const copy=s.copies[copyId];
        check(copy.ownerId===trade.fromUserId && copy.state==='owned' && copy.lockedBy===trade.id,'TRADE_CONFLICT','Escrow changed',409);
          const reason=this.#tradeReason(copy,trade.fromUserId,s,{toUserId:user.id,ignoreLock:true});check(!reason,'TRANSFER_BLOCKED',reason,409);
        check(!Object.values(copy.bindings).some(b=>b.transfer==='block'),'TRANSFER_BLOCKED','Binding blocks transfer',409);
      }
      for(const money of trade.give.currencies) check(this.#currency(s,money.currencyId).tradable===true,'TRANSFER_BLOCKED','Currency trading disabled',403);
      this.#offer(s,user.id,trade.receive,trade.fromUserId,true);
      if(preview)return {channel:'trade',fromUserId:trade.fromUserId,toUserId:trade.toUserId,give:clone(trade.give),receive:clone(trade.receive)};
      trade.status='accepted'; trade.completedAt=this.#clock();
      for(const money of trade.receive.currencies) {
        this.#adjust(s,user.id,money.currencyId,-money.amount,'trade',trade.id);
        this.#adjust(s,trade.fromUserId,money.currencyId,money.amount,'trade',trade.id);
      }
      for(const money of trade.give.currencies) this.#adjust(s,user.id,money.currencyId,money.amount,'trade',trade.id);
      for(const copyId of trade.give.copyIds) this.#transfer(s,copyId,trade.fromUserId,user.id,trade.id);
      for(const copyId of trade.receive.copyIds) this.#transfer(s,copyId,user.id,trade.fromUserId,trade.id);
      this.#removePlacements(s,new Set([...trade.give.copyIds,...trade.receive.copyIds]));
      s.users[trade.fromUserId].lastTradeAt=this.#clock();s.users[trade.toUserId].lastTradeAt=this.#clock();
      trade.status='accepted'; trade.completedAt=this.#clock();this.#notify(s,trade.fromUserId,'trade.accepted',{tradeId});this.#notify(s,user.id,'trade.accepted',{tradeId});return trade;
  }
  cancelTrade(actor,{key,tradeId}) {
    return this.#tradeRecords(actor,key,'trade.cancelled',{tradeId},()=>this.#command(actor,key,'trade.cancelled',{tradeId},(s,user)=>{
      const trade=s.trades[tradeId]; check(trade && [trade.fromUserId,trade.toUserId].includes(user.id),'NOT_FOUND','Trade not found',404);
      check(trade.status==='pending','TRADE_CLOSED','Trade already closed',409);
      this.#release(s,trade,user.id===trade.fromUserId?'cancelled':'declined'); return trade;
    }));
  }
  #removePlacements(s,ids) {for(const u of Object.values(s.users))if(u.preferences)u.preferences.favoriteCopyIds=(u.preferences.favoriteCopyIds??[]).filter(copyId=>!ids.has(copyId));for(const album of Object.values(s.albums)) {
    const filtered=album.placements.filter(x=>!ids.has(x.copyId));
    if(filtered.length!==album.placements.length) {album.placements=filtered; album.version++;}
  }}
  saveAlbum(actor,{key,albumId,name,visibility='private',layout={},placements=[],expectedVersion}) {
    text(name,'album name',100); check(['private','public'].includes(visibility),'INVALID_INPUT','Invalid album visibility');
    check(Array.isArray(placements) && placements.length<=1000,'INVALID_INPUT','Album placements must be an array of at most 1000 items');
    jsonObject(layout,'album layout');
    try{if(layout.artwork!==undefined)validateAlbumArtwork(layout.artwork);if(layout.pageSize!==undefined)validateAlbumPageSize(layout.pageSize);validateAlbumPageAssignments(layout,placements);}catch(error){check(false,'INVALID_INPUT',error.message);}
    return this.#command(actor,key,'album.saved',{albumId,name,visibility,layout,placements,expectedVersion},(s,user)=>{
      if(visibility==='public') this.#feature(s,'publicAlbums');
      const existing=albumId?s.albums[albumId]:null;
      check(!albumId || existing?.ownerId===user.id,'NOT_FOUND','Album not found',404);
      if(existing) check(expectedVersion===existing.version,'VERSION_CONFLICT','Album changed; refresh before saving',409);
      check(new Set(placements.map(x=>x.copyId)).size===placements.length,'INVALID_INPUT','Each copy can appear once per album');
      const clean=placements.map((p,index)=>{
        const copy=s.copies[p.copyId];
        check(copy && copy.ownerId===user.id && copy.state==='owned','NOT_OWNED','Album card is not owned',403);
        check(cardBehavior(copy.definition).albumEligible,'ALBUM_INELIGIBLE','This card is excluded from album placement',409);
        return {copyId:p.copyId,position:p.position===undefined?index:integer(p.position,'position',0,100000),data:jsonObject(p.data??{},'placement data')};
      });
      const album={id:existing?.id??id(),ownerId:user.id,name,visibility,layout:clone(layout),placements:clean,version:(existing?.version??0)+1,updatedAt:this.#clock()};
      s.albums[album.id]=album; return album;
    });
  }
  albums(actor) {return this.#store.read(s=>{const u=this.#user(s,actor); return Object.values(s.albums).filter(a=>a.ownerId===u.id);});}
  #albumView(s,album,viewerId) {
    return {...clone(album),ownerName:s.users[album.ownerId].displayName,cards:album.placements.slice().sort((a,b)=>a.position-b.position)
      .map(p=>({placement:clone(p),copy:this.#copyView(s,s.copies[p.copyId],viewerId)}))};
  }
  viewAlbum(actor,albumId) {
    return this.#store.read(s=>{
      const viewer=actor?.disabled!==true && actor?.userId && Object.hasOwn(s.users,actor.userId)?actor.userId:null, album=s.albums[albumId];
      const allowed=album && (album.ownerId===viewer || (album.visibility==='public' && this.#catalog(s).features.publicAlbums));
      check(allowed,'NOT_FOUND','Album not found',404); return this.#albumView(s,album,viewer);
    });
  }
  publicAlbums() {return this.#store.read(s=>{
    this.#feature(s,'publicAlbums'); return Object.values(s.albums).filter(a=>a.visibility==='public').map(a=>({id:a.id,name:a.name,ownerName:s.users[a.ownerId].displayName,cardCount:a.placements.length}));
  });}
  // Private retained bindings remain accessible to their original holder after transfer.
  bindings(actor) {return this.#store.read(s=>{const u=this.#user(s,actor); return Object.values(s.copies).filter(c=>c.state==='owned')
    .flatMap(c=>Object.entries(c.bindings).filter(([,b])=>b.holderId===u.id).map(([namespace,b])=>({copyId:c.id,namespace,...this.#bindingView(b)})));});}
  events(actor,{after=0,limit=100}={}) {
    this.#admin(actor,'events.read'); integer(after,'event cursor',0); integer(limit,'event limit',1,1000);
    return this.#store.read(s=>s.events.filter(e=>e.sequence>after).slice(0,limit));
  }
}
