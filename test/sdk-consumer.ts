import {createWireTransport} from '@digital-card/framework/wire-client';
import type {Schemas} from '@digital-card/framework/wire-types';
const call=createWireTransport({principal:()=>null});
async function acquisition(){
  const quote=await call('quote',{productId:'sample',quantity:1});
  const price:number=quote.price.amount;
  const purchase=await call('purchase',{...quote,key:'consumer-key'});
  const packId:string=purchase.packs[0]!.id;
  const receipt=await call('openPack',{key:'open-key',packId});
  const state:'sealed'|'owned'|'consumed'=receipt.cards[0]!.state;
  return {price,state};
}
void acquisition;
// Deliberate contract drift must continue to fail the strict consumer check.
// @ts-expect-error quantity is an integer JSON number, not a string
void call('quote',{productId:'sample',quantity:'1'});
// @ts-expect-error missing the required reviewed product revision
void call('purchase',{key:'key',productId:'sample',quantity:1,catalogVersion:1});
// @ts-expect-error quote does not accept an injected principal
void call('quote',{productId:'sample',userId:'other'});
// @ts-expect-error operation names are pinned by the contract
void call('purchaseUnchecked',{key:'key'});
// @ts-expect-error error envelope always requires a message
const error:Schemas['Error']={code:'INVALID_INPUT'};
void error;
// @ts-expect-error production trade acceptance requires the reviewed digest
void call('acceptTrade',{key:'key',tradeId:'trade'});
void call('acceptTrade',{key:'key',tradeId:'trade',expectedDigest:'a'.repeat(64)});
async function collectionAndAdministration(){
  const overview=await call('adminOverview',undefined);
  const cards:number=overview.counts.cards;
  const discount:number=overview.lines[0]!.products[0]!.discountPercent;
  const users=await call('adminUsers',undefined);
  const restricted:boolean=users.items[0]!.restrictions.tradingBlocked;
  const detail=await call('adminUser',undefined,{query:{userId:'account'}});
  const version:number=detail.inventory.items[0]!.version;
  const inventory=await call('inventory',undefined,{query:{limit:50}});
  const copies=Array.isArray(inventory)?inventory:inventory.items;
  const transferable:boolean=copies[0]!.tradable;
  const name:string=copies[0]!.definition.name;
  const rarity:string=copies[0]!.variant.rarityId;
  const trade=await call('proposeTrade',{key:'key',toUserId:'account',give:{copyIds:[],currencies:[]},receive:{copyIds:[],currencies:[]}});
  const status:'pending'|'accepted'|'cancelled'|'declined'|'expired'|'countered'=trade.status;
  return {cards,discount,restricted,version,transferable,name,rarity,status};
}
void collectionAndAdministration;
void call('registerCommandIntent',{command:'purchase',input:{productId:'sample',quantity:1,productRevision:1,catalogVersion:1}});
void call('registerCommandIntent',{command:'configureAdmin',input:{expectedRevision:1,reason:'Configuration update',scope:'site',changes:{packPurchasesPaused:false}}});
// @ts-expect-error registered reviewed purchases retain their required catalog revision
void call('registerCommandIntent',{command:'purchase',input:{productId:'sample',quantity:1,productRevision:1}});
// @ts-expect-error an intent identifier cannot be replaced with caller-supplied command data
void call('executeCommandIntent',{command:'purchase',input:{}});

async function externalCurrency(){
  const receipt=await call('reconcileCurrency',{providerId:'points',transactionId:'settled'});
  const balance:number=receipt.balance;
  return balance;
}
void externalCurrency;
// @ts-expect-error owned stock requires its existing IDs
void call('createListing',{key:'listing',shopId:'shop',title:'Stock',price:{currencyId:'credits',amount:1},items:{kind:'copies'}});
// @ts-expect-error newly issued card stock requires a variant
void call('createListing',{key:'listing',shopId:'shop',title:'Stock',price:{currencyId:'credits',amount:1},items:{kind:'mint-card',quantity:1}});
void call('createListing',{key:'listing',shopId:'shop',title:'Stock',price:{currencyId:'credits',amount:1},items:{kind:'action',handler:'reward',quantity:1}});

// @ts-expect-error required query parameters require call options
void call('codeIssuanceStatus',undefined);
// @ts-expect-error binding status requires a batch ID
void call('bindingFactoryStatus',undefined,{query:{}});
// @ts-expect-error required batch ID cannot be omitted using null
void call('bindingFactoryStatus',undefined,{query:{batchId:null}});
// @ts-expect-error numeric limits are not strings
void call('inventory',undefined,{query:{limit:'50'}});
// @ts-expect-error query names are operation-specific
void call('inventory',undefined,{query:{limti:50}});
// @ts-expect-error operations without query parameters reject extra keys
void call('wallet',undefined,{query:{limit:50}});
// @ts-expect-error path bindings are required
void call('viewAlbum',undefined);
// @ts-expect-error path bindings retain their required key
void call('inspectCard',undefined,{path:{}});
void call('bindingFactoryStatus',undefined,{query:{batchId:'11111111-1111-4111-8111-111111111111'}});
void call('inventory',undefined,{query:{limit:50,after:null,search:undefined,sort:'ordinal'}});
void call('inventory',undefined,{query:{limit:50,sort:'id'}});
void call('viewAlbum',undefined,{path:{albumId:'album'}});

async function walletAndListing(){
  const wallet=await call('wallet',undefined);
  const balance:number|undefined=wallet.credits;
  const conversion=await call('convert',{key:'convert',from:'credits',to:'gems',amount:100,catalogVersion:1});
  const received:number=conversion.received,remainder:string=conversion.remainderNumerator;
  const quote=await call('quoteListing',{listingId:'listing'});
  const total:number=quote.price.amount;
  for(const item of quote.items){
    const unitId:string=item.unitId;
    if(item.kind==='copy'){const cardId:string=item.copy.cardId;void cardId;}
    else if(item.kind==='pack'){const productId:string=item.pack.productId;void productId;}
    else {
      // @ts-expect-error custom goods do not disclose a copy
      void item.copy;
    }
    void unitId;
  }
  return {balance,received,remainder,total};
}
void walletAndListing;
// @ts-expect-error balance entries are integer JSON numbers
const invalidWallet:Schemas['Wallet']={credits:'100'};
void invalidWallet;

async function listingRecords(){
  const listing=await call('createListing',{key:'listing-record',shopId:'shop',title:'Stock',price:{currencyId:'credits',amount:0},items:{kind:'action',handler:'reward',quantity:1}});
  const remaining:number=listing.remaining,metadata:unknown=listing.metadata.custom;
  const canceled=await call('cancelListing',{key:'cancel-record',listingId:listing.id});
  const status:'active'|'canceled'|'expired'=canceled.status;
  const quote=await call('quoteListing',{listingId:listing.id});
  const order=await call('buyListing',{key:'buy-record',listingId:listing.id,quantity:quote.quantity,unitIds:quote.unitIds,digest:quote.digest});
  const fulfillment:'pending'|'complete'|'attention-required'=order.fulfillment;
  for(const item of order.items){
    if(item.kind==='copy'){const id:string=item.copyId;void id;}
    else if(item.kind==='pack'){const id:string=item.packId;void id;}
    else {const id:string=item.jobId;void id;}
    // @ts-expect-error order references do not expose sealed card lists
    void item.copyIds;
  }
  const title:string|undefined=(await call('listings',undefined)).items[0]?.title;
  const paid:number|undefined=(await call('orders',undefined)).items[0]?.paid.amount;
  return {remaining,metadata,status,fulfillment,title,paid};
}
void listingRecords;

async function shopSettings(){
  const view=await call('commerceSettings',undefined);
  const available:boolean=view.effectiveSettings.playerShops;
  const change=await call('configureCommerce',{key:'settings',expectedRevision:view.revision,settings:{playerShops:true}});
  const maximum:number=change.settings.maxStockPerListing;
  // @ts-expect-error configuration receipts contain stored settings, not effective settings
  void change.effectiveSettings;
  const shop=await call('createShop',{key:'shop',name:'Shop'});
  const kind:'admin'|'player'=shop.kind,metadata:unknown=shop.metadata.theme;
  const disabled=await call('setShopEnabled',{key:'disable',shopId:shop.id,enabled:false});
  const enabled:boolean=disabled.enabled;
  const mine:boolean|undefined=(await call('shops',undefined)).items[0]?.mine;
  // @ts-expect-error mutation records do not carry viewer-dependent mine
  void shop.mine;
  return {available,maximum,kind,metadata,enabled,mine};
}
void shopSettings;


async function raffleResponses(){
  const entry=await call('enterRaffle',{key:'entry',listingId:'listing'});
  const entered:boolean=entry.entered,count:number=entry.entryCount;
  const status=await call('raffleStatus',{listingId:entry.listingId});
  const orderId:string|null=status.orderId,deadline:string|null=status.claimUntil;
  const state:'active'|'canceled'|'expired'=status.status;
  // @ts-expect-error public status never exposes other entrants or winner records
  void status.winners;
  const draw=await call('drawRaffle',{key:'draw',listingId:entry.listingId});
  const drawnAt:string=draw.at;
  for(const winner of draw.winners){const userId:string=winner.userId,unitId:string=winner.unitId,claim:string|null=winner.orderId;void [userId,unitId,claim];}
  // @ts-expect-error draw winners retain nullable order IDs before claim
  const claimed:string=draw.winners[0]!.orderId;
  return {entered,count,orderId,deadline,state,drawnAt,claimed};
}
void raffleResponses;


async function bindingResponses(){
  const copy=await call('inspectCard',undefined,{path:{copyId:'copy'}});
  const cardId:string=copy.cardId,name:string=copy.definition.name;
  const held=await call('bindings',undefined);
  for(const binding of held){const holder:string=binding.holderId,namespace:string=binding.namespace,providerValue:unknown=binding.data?.custom;void [holder,namespace,providerValue];}
  const receipt=await call('consumeBinding',{key:'use',copyId:copy.id,namespace:'example.binding'});
  const state:'used'=receipt.state,usedAt:string=receipt.usedAt;
  // @ts-expect-error use receipts do not disclose provider data
  void receipt.data;
  const read=await call('readNotifications',{key:'read',ids:[]});
  const ok:true=read.ok;
  // @ts-expect-error provider-owned JSON values need narrowing
  const privateValue:string=held[0]?.data?.custom;
  return {cardId,name,state,usedAt,ok,privateValue};
}
void bindingResponses;


async function accountReadResponses(){
  const directory=await call('directory',undefined,{query:{limit:1}});
  for(const user of directory.items){const name:string=user.name,visible:boolean=user.inventoryVisible;void [name,visible];
    // @ts-expect-error directory projections omit identity-provider subjects
    void user.subject;
  }
  const notifications=await call('notifications',undefined);
  for(const notice of notifications.items){const owner:string=notice.userId,read:boolean=notice.read,data:unknown=notice.data?.custom;void [owner,read,data];}
  for(const entry of await call('history',undefined)){const delta:number=entry.delta,balance:number=entry.balance,reference:string=entry.reference;void [delta,balance,reference];}
  for(const album of await call('publicAlbums',undefined)){const name:string=album.ownerName,count:number=album.cardCount;void [name,count];
    // @ts-expect-error public summaries omit card placements and private copies
    void album.placements;
  }
}
void accountReadResponses;


async function operatorReadResponses(){
  const configured=await call('configureCodePool',{key:'pool',pool:{id:'pool',providerId:'provider',name:'Pool'}});
  const enabled:boolean=configured.enabled,metadata:unknown=configured.metadata.custom;
  for(const pool of await call('codePools',undefined)){const available:number|undefined=pool.counts.available;void available;}
  for(const row of (await call('codeInventory',undefined)).items){const copy:string|null=row.copyId,batch:string|null=row.batchId,history:unknown[]=row.history;void [copy,batch,history];
    // @ts-expect-error operator inventory excludes encrypted secrets and fingerprints
    void row.secret;
  }
  for(const job of (await call('actionJobs',undefined)).items){const handler:string=job.handler,status:'pending'|'running'|'succeeded'|'dead'=job.status;void [handler,status];
    // @ts-expect-error delivery diagnostics exclude executable parameters
    void job.params;
  }
  return {enabled,metadata};
}
void operatorReadResponses;


async function tradingAvailabilityResponses(){
  const available=await call('availability',undefined);
  for(const variant of available.variants){const issued:number=variant.issued,remaining:number|null=variant.remaining;void [issued,remaining];}
  for(const product of available.products){const enabled:boolean=product.available;if(product.pity&&typeof product.pity==='object'){const after:number=product.pity.after,rarity:string=product.pity.rarityId;void [after,rarity];}void enabled;}
  const policy=await call('configureTrading',{key:'policy',expectedRevision:0,policy:{}});
  const gifts:boolean=policy.policy.allowGifts,max:number=policy.policy.maxCardsPerSide;
  const receipt=await call('setCardTransferLock',{key:'lock',copyId:'copy'});
  const version:number=receipt.version;if(receipt.lock){const reason:string=receipt.lock.reason,actor:string|null=receipt.lock.actorId;void [reason,actor];}
  // @ts-expect-error lock receipts omit private card bindings
  void receipt.bindings;
  return {gifts,max,version};
}
void tradingAvailabilityResponses;


async function policyMutationResponses(){
  const saved=await call('saveCardPolicy',{key:'save',expectedRevision:0,document:{schemaVersion:1,id:'policy',revision:1,name:'Policy'}});
  const state:'draft'=saved.state,name:string=saved.document.name;
  const preview=await call('previewCardPolicy',{expectedRevision:saved.revision,policy:'policy@1',assignments:[]});
  const active=await call('activateCardPolicy',{...preview,key:'activate'});
  for(const row of active.affected){const card:string|undefined=row.cardId;void card;}
  const retired=await call('retireCardPolicy',{key:'retire',expectedRevision:active.revision,policy:'policy@1'});const retiredState:'retired'=retired.state;
  const restored=await call('restoreCardPolicy',{key:'restore',expectedRevision:retired.revision,policy:'policy@1'});const restoredState:'superseded'=restored.state;
  const resource=await call('saveCardResource',{key:'resource',expectedRevision:restored.revision,resource:{kind:'template',document:{id:'template',revision:1,name:'Template'}}});
  const resourceName:string=resource.resource.document.name;
  const removed=await call('retireCardResource',{key:'remove-resource',expectedRevision:resource.revision,reference:'template@1',kind:'template'});const yes:true=removed.retired;
  const returned=await call('restoreCardResource',{key:'restore-resource',expectedRevision:removed.revision,reference:'template@1',kind:'template'});const no:false=returned.retired;
  // @ts-expect-error mutation receipts do not expose registry history
  void saved.history;
  return {state,name,retiredState,restoredState,resourceName,yes,no};
}
void policyMutationResponses;


async function auditImportResponses(){
  const audit=await call('audit',undefined);
  const ok:boolean=audit.ok;
  if('counts' in audit){const users:number=audit.counts.users,revision:number=audit.revision;void [users,revision];}
  for(const issue of audit.issues){const code:string=issue.code,detail:unknown=issue.detail;void [code,detail];}
  const preview=await call('previewImport',{source:{cards:[]},expectedVersion:1});
  const receipt=await call('commitImport',{key:'import',manifest:preview.manifest,digest:preview.digest,expectedVersion:preview.expectedVersion,policyRevision:preview.policyRevision});
  const version:number=receipt.version,digest:string=receipt.digest,time:string=receipt.importedAt;
  // @ts-expect-error import receipt does not repeat the authored catalog
  void receipt.manifest;
  // @ts-expect-error audit detail must be narrowed before string use
  const detail:string=audit.issues[0]?.detail;
  return {ok,version,digest,time,detail};
}
void auditImportResponses;

import {openapi} from '@digital-card/framework/contracts';
import type {Operations} from '@digital-card/framework/wire-types';
const httpDocumentVersion:'3.1.0'=openapi.openapi;
const httpDocumentTitle:string=openapi.info.title;
const httpSessionLocation:'cookie'=openapi.components.securitySchemes.hostSession.in;
const httpQuoteSchema=openapi.components.schemas.QuoteRequest;
const httpRequiredFields:string[]|undefined=httpQuoteSchema.required;
const httpQuantityType= httpQuoteSchema.properties?.quantity?.type;
const httpSchemaExtension:unknown=httpQuoteSchema.dcUniquePageIds;
for(const [path,item] of Object.entries(openapi.paths)){
  for(const operation of [item.get,item.post]){
    if(!operation)continue;
    const id:keyof Operations=operation.operationId;
    const requestSchema=operation.requestBody?.content['application/json'].schema;
    const responseSchema=operation.responses['200']?.content?.['application/json'].schema;
    const reference:string|undefined=responseSchema?.$ref;
    const requestRequired:boolean|undefined=operation.requestBody?.required;
    const origin=operation.parameters?.find(parameter=>parameter.name==='Origin');
    const parameterLocation:'path'|'query'|'header'|undefined=origin?.in;
    const securityScopes:string[]|undefined=operation.security[0]?.hostSession;
    void [path,id,requestSchema,reference,requestRequired,parameterLocation,securityScopes];
  }
}
// @ts-expect-error Schema documents describe wire data; they are not request values.
const httpQuoteRequest:Schemas['QuoteRequest']=openapi.components.schemas.QuoteRequest;
// @ts-expect-error Component names reuse the checked wire schema names.
openapi.components.schemas.UnknownContract;
// @ts-expect-error Unspecified schema keywords must be narrowed before use.
const httpExtensionBoolean:boolean=httpQuoteSchema.dcUniquePageIds;
// @ts-expect-error The exported OpenAPI version is 3.1.0.
const oldHTTPDocumentVersion:'3.0.3'=openapi.openapi;
void [httpDocumentVersion,httpDocumentTitle,httpSessionLocation,httpRequiredFields,httpQuantityType,httpSchemaExtension,httpQuoteRequest,httpExtensionBoolean,oldHTTPDocumentVersion];

import {CardFramework} from '../src/core.js';
import {validateCatalog, FrameworkError} from '../src/catalog.js';
import type {CoreUserActor, CoreCatalog, CorePreferences} from '../src/core-operations.js';
const hostCore=new CardFramework({clock:()=>new Date().toISOString(),random:maximum=>Math.floor(maximum/2),raffleRandom:maximum=>maximum-1,limits:{users:1000,copiesPerUser:100,completionBytes:1048576}});
const hostAuthority={role:'admin'};
declare const hostCatalogInput:Schemas['CatalogManifest'];
const hostCatalog:CoreCatalog=validateCatalog(hostCatalogInput);
const hostPublished=hostCore.publishCatalog(hostAuthority,hostCatalog);
const hostSitePaused:boolean=hostPublished.adminStatus.site.packPurchasesPaused;
const hostPublishedVersion:number=hostCore.catalogVersion();
const hostOperatorCatalog:CoreCatalog=hostCore.operatorCatalog(hostAuthority);
const hostUser=hostCore.registerUser(hostAuthority,{provider:'host',subject:'account',displayName:'Collector'});
const hostActor:CoreUserActor={userId:hostUser.id};
const hostKnownUser=hostCore.userByIdentity(hostAuthority,{provider:'host',subject:'account'});
const hostLookupId:string|undefined=hostKnownUser?.id;
const hostIdentity=hostCore.providerIdentity(hostAuthority,hostUser.id);
const hostProvider:string|undefined=hostIdentity?.provider;
const hostGrant=hostCore.grantCurrency(hostAuthority,{key:'grant',userId:hostUser.id,currencyId:'credits',amount:10,reason:'Opening balance'});
const hostBalance:number=hostGrant.balance;
const hostMe=hostCore.me(hostActor);
const hostRestrictions:boolean=hostMe.adminStatus.restrictions.tradingBlocked;
const hostPreferences:CorePreferences=hostCore.setPreferences(hostActor,{key:'preferences',inventoryVisibility:'private'});
const hostCapabilities:Schemas['CapabilityAvailability']=hostCore.capabilities(hostActor);
const hostWallet:Record<string,number>=hostCore.wallet(hostActor);
const hostLedger:Schemas['LedgerEntry'][]=hostCore.history(hostActor);
const hostQuote=hostCore.quote(hostActor,{productId:'sample'});
const hostPurchase=hostCore.purchase(hostActor,{...hostQuote,key:'purchase'});
const hostAsyncPurchase:Promise<Operations['purchase']['response']>=hostCore.purchaseAsync(hostActor,{...hostQuote,key:'async-purchase'},{signal:new AbortController().signal});
const hostPacks:Schemas['PackView'][]=hostCore.packs(hostActor);
const hostCopies:Schemas['InventoryCopy'][]=hostCore.inventory(hostActor);
const hostReceipt:Schemas['Receipt']=hostCore.openPack(hostActor,{key:'open',packId:hostPacks[0]!.id});
const hostCopy:Schemas['Copy']=hostCore.inspectCard(hostActor,hostCopies[0]!.id);
const hostOpened:Schemas['Copy']=hostCore.openCard(hostActor,{key:'reveal',copyId:hostCopy.id});
const hostUsed:Schemas['BindingUseReceipt']=hostCore.consumeBinding(hostActor,{key:'use',copyId:hostCopy.id,namespace:'example'});
const hostHeld:Schemas['HeldBinding'][]=hostCore.bindings(hostActor);
const hostEvents=hostCore.events(hostAuthority,{after:0,limit:20});
const hostSequence:number|undefined=hostEvents[0]?.sequence;
const hostEventData:unknown=hostEvents[0]?.data;
const hostErrorStatus:number=new FrameworkError('EXAMPLE','Example',409).status;
// @ts-expect-error The core returns identity data without the HTTP adapter's role field.
hostMe.role;
// @ts-expect-error Account-bound operations require a principal user ID.
hostCore.wallet({role:'player'});
// @ts-expect-error Identity lookup can return null.
const requiredHostUserId:string=hostCore.userByIdentity(hostAuthority,{provider:'host',subject:'missing'}).id;
// @ts-expect-error Reviewed product revision and catalog version are required for purchase.
hostCore.purchase(hostActor,{key:'purchase',productId:'sample'});
// @ts-expect-error Core inventory returns an array, not the paged HTTP union.
hostCore.inventory(hostActor).items;
// @ts-expect-error Async purchase returns a promise.
const immediateHostPurchase:Operations['purchase']['response']=hostCore.purchaseAsync(hostActor,{...hostQuote,key:'later'});
// @ts-expect-error Installation limit names are checked.
new CardFramework({limits:{unboundedRequests:100}});
// @ts-expect-error Clock callbacks return ISO date strings.
new CardFramework({clock:()=>Date.now()});
hostCore.close();
void [hostSitePaused,hostPublishedVersion,hostOperatorCatalog,hostLookupId,hostProvider,hostBalance,hostRestrictions,hostPreferences,hostCapabilities,hostWallet,hostLedger,hostPurchase,hostAsyncPurchase,hostReceipt,hostOpened,hostUsed,hostHeld,hostSequence,hostEventData,hostErrorStatus,requiredHostUserId,immediateHostPurchase];

declare const hostAdminChange:Operations['configureAdmin']['request'];
declare const hostAdminCards:Operations['administerCards']['request'];
const hostOverview:Schemas['AdminOverview']=hostCore.adminOverview(hostAuthority);
const hostAdminMutation:Schemas['AdminMutation']=hostCore.configureAdmin(hostAuthority,hostAdminChange);
const hostAdminCardMutation:Schemas['AdminMutation']=hostCore.administerCards(hostAuthority,hostAdminCards);
const hostUsersPage:Schemas['AdminUsersPage']=hostCore.adminUsers(hostAuthority,{limit:20,sort:'name'});
const hostUserDetail:Schemas['AdminUserDetail']=hostCore.adminUser(hostAuthority,{userId:hostUser.id,after:'cursor'});
const hostAdminChanges:Schemas['AdminHistoryPage']=hostCore.adminHistory(hostAuthority,{search:'Website'});
const hostPolicies:Schemas['CardPolicyRegistry']=hostCore.cardPolicies(hostAuthority);
const hostEffectivePolicy=hostCore.effectiveCardPolicy(hostAuthority,{lineId:'sample'});
const hostPolicyRevision:number=hostEffectivePolicy.revision;
declare const hostPolicySaveInput:Operations['saveCardPolicy']['request'];
declare const hostPolicyImpactInput:Operations['previewCardPolicy']['request'];
declare const hostPolicyActivateInput:Operations['activateCardPolicy']['request'];
declare const hostPolicyRetireInput:Operations['retireCardPolicy']['request'];
declare const hostPolicyRestoreInput:Operations['restoreCardPolicy']['request'];
declare const hostResourceSaveInput:Operations['saveCardResource']['request'];
declare const hostResourceRetireInput:Operations['retireCardResource']['request'];
declare const hostResourceRestoreInput:Operations['restoreCardResource']['request'];
const hostPolicySaved:Schemas['CardPolicySaveReceipt']=hostCore.saveCardPolicy(hostAuthority,hostPolicySaveInput);
const hostPolicyImpact:Schemas['CardPolicyImpact']=hostCore.previewCardPolicy(hostAuthority,hostPolicyImpactInput);
const hostPolicyActivated:Schemas['CardPolicyActivationReceipt']=hostCore.activateCardPolicy(hostAuthority,hostPolicyActivateInput);
const hostPolicyRetired:Schemas['CardPolicyRetireReceipt']=hostCore.retireCardPolicy(hostAuthority,hostPolicyRetireInput);
const hostPolicyRestored:Schemas['CardPolicyRestoreReceipt']=hostCore.restoreCardPolicy(hostAuthority,hostPolicyRestoreInput);
const hostResourceSaved:Schemas['CardResourceSaveReceipt']=hostCore.saveCardResource(hostAuthority,hostResourceSaveInput);
const hostResourceRetired:Schemas['CardResourceRetireReceipt']=hostCore.retireCardResource(hostAuthority,hostResourceRetireInput);
const hostResourceRestored:Schemas['CardResourceRestoreReceipt']=hostCore.restoreCardResource(hostAuthority,hostResourceRestoreInput);
declare const hostStatsInput:Operations['updateCopyStats']['request'];
const hostStatsVersion:number=hostCore.updateCopyStats(hostAuthority,hostStatsInput).version;
const hostPresentationRegistration=hostCore.registerCardPresentation(hostAuthority,new Uint8Array(0));
hostPresentationRegistration.then(registration=>{const digest:string=registration.digest;const issueCode:'FONT_GLYPH'|'TEXT_OVERFLOW'|'TEXT_UNMEASURED'|undefined=registration.textIssues[0]?.code;void [digest,issueCode];});
const hostTradingPolicy:Schemas['TradingPolicyRecord']=hostCore.tradingPolicy();
declare const hostTradingChange:Operations['configureTrading']['request'];
hostCore.configureTrading(hostAuthority,hostTradingChange);
hostCore.setCardTransferLock(hostAuthority,{key:'lock',copyId:hostCopy.id,locked:true});
declare const hostTradeProposal:Operations['proposeTrade']['request'];
declare const hostTradeCounter:Operations['counterTrade']['request'];
declare const hostTradeReview:Operations['reviewTransfer']['request'];
const hostTrade:Schemas['Trade']=hostCore.proposeTrade(hostActor,hostTradeProposal);
const hostCounter:Schemas['Trade']=hostCore.counterTrade(hostActor,hostTradeCounter);
const hostAccepted:Schemas['Trade']=hostCore.acceptTrade(hostActor,{key:'accept',tradeId:hostTrade.id,expectedDigest:hostTrade.digest});
const hostCanceled:Schemas['Trade']=hostCore.cancelTrade(hostActor,{key:'cancel',tradeId:hostCounter.id});
const hostTradeAsync:Promise<Schemas['Trade']>=hostCore.proposeTradeAsync(hostActor,hostTradeProposal,{signal:new AbortController().signal});
const hostCounterAsync:Promise<Schemas['Trade']>=hostCore.counterTradeAsync(hostActor,hostTradeCounter);
const hostAcceptAsync:Promise<Schemas['Trade']>=hostCore.acceptTradeAsync(hostActor,{key:'accept-later',tradeId:hostTrade.id,expectedDigest:hostTrade.digest});
const hostReviewAsync:Promise<Schemas['TradeTransferReview']>=hostCore.reviewTransferAsync(hostActor,hostTradeReview);
const hostExpiredTradeId:string|undefined=hostCore.sweepExpiredTrades(hostAuthority).completed[0];
const hostNamedTrader:string|undefined=hostCore.trades(hostActor)[0]?.fromName;
const hostCommerce:Schemas['CommerceSettingsView']=hostCore.commerceSettings();
declare const hostCommerceChange:Operations['configureCommerce']['request'];
const hostCommerceConfigured:Schemas['CommerceSettingsRecord']=hostCore.configureCommerce(hostAuthority,hostCommerceChange);
const hostShop:Schemas['ShopRecord']=hostCore.createShop(hostActor,{key:'shop',name:'Collector shop'});
hostCore.setShopEnabled(hostAuthority,{key:'shop-enabled',shopId:hostShop.id,enabled:true});
const hostShopPage:Schemas['ShopPage']=hostCore.shops(hostActor,{limit:20});
declare const hostListingInput:Operations['createListing']['request'];
declare const hostListingBuy:Operations['buyListing']['request'];
const hostListing:Schemas['ListingRecord']=hostCore.createListing(hostActor,hostListingInput);
const hostListingAsync:Promise<Schemas['ListingRecord']>=hostCore.createListingAsync(hostActor,hostListingInput);
const hostListingPage:Schemas['ListingPage']=hostCore.listings(hostActor,{shopId:hostShop.id});
const hostListingQuote:Schemas['ListingQuote']=hostCore.quoteListing(hostActor,{listingId:hostListing.id});
const hostOrder:Schemas['OrderRecord']=hostCore.buyListing(hostActor,hostListingBuy);
const hostListingQuoteAsync:Promise<Schemas['ListingQuote']>=hostCore.quoteListingAsync(hostActor,{listingId:hostListing.id});
const hostOrderAsync:Promise<Schemas['OrderRecord']>=hostCore.buyListingAsync(hostActor,hostListingBuy);
const hostOrders:Schemas['OrderPage']=hostCore.orders(hostActor);
hostCore.cancelListing(hostActor,{key:'cancel-listing',listingId:hostListing.id});
const hostListingExpirationCount:number=hostCore.expireListings(hostAuthority).count;
const hostRaffle:Schemas['RaffleStatus']=hostCore.enterRaffle(hostActor,{key:'enter',listingId:hostListing.id});
hostCore.raffleStatus(hostActor,{listingId:hostListing.id});
const hostDraw:Schemas['RaffleDraw']=hostCore.drawRaffle(hostAuthority,{key:'draw',listingId:hostListing.id});
const hostAutomaticDraws:Schemas['RaffleDraw'][]=hostCore.drawDueRaffles(hostAuthority,{limit:10});
// @ts-expect-error Backend page limits do not accept the wire client's null omission shorthand.
hostCore.adminUsers(hostAuthority,{limit:null});
// @ts-expect-error Administrative account detail requires an account ID.
hostCore.adminUser(hostAuthority,{});
// @ts-expect-error Presentation analysis is asynchronous.
const immediateHostPresentation:{digest:string}=hostCore.registerCardPresentation(hostAuthority,new Uint8Array(0));
// @ts-expect-error Trade acceptance requires the reviewed offer digest.
hostCore.acceptTrade(hostActor,{key:'accept',tradeId:hostTrade.id});
// @ts-expect-error Asynchronous reviews return promises.
const immediateHostReview:Schemas['TradeTransferReview']=hostCore.reviewTransferAsync(hostActor,hostTradeReview);
// @ts-expect-error Commerce mutations retain required request keys.
hostCore.createShop(hostActor,{name:'Collector shop'});
// @ts-expect-error Listing purchase requires the reviewed listing digest.
hostCore.buyListing(hostActor,{key:'buy',listingId:hostListing.id});
void [hostOverview,hostAdminMutation,hostAdminCardMutation,hostUsersPage,hostUserDetail,hostAdminChanges,hostPolicies,hostPolicyRevision,hostPolicySaved,hostPolicyImpact,hostPolicyActivated,hostPolicyRetired,hostPolicyRestored,hostResourceSaved,hostResourceRetired,hostResourceRestored,hostStatsVersion,hostTradingPolicy,hostAccepted,hostCanceled,hostTradeAsync,hostCounterAsync,hostAcceptAsync,hostReviewAsync,hostExpiredTradeId,hostNamedTrader,hostCommerce,hostCommerceConfigured,hostShopPage,hostListingAsync,hostListingPage,hostListingQuote,hostOrder,hostListingQuoteAsync,hostOrderAsync,hostOrders,hostListingExpirationCount,hostRaffle,hostDraw,hostAutomaticDraws,immediateHostPresentation,immediateHostReview];

const hostDirectory:Schemas['DirectoryPage']=hostCore.directory(hostActor,{search:'Collector',limit:20});
const hostPartnerInventory:Schemas['TradeInventoryPage']=hostCore.tradeInventory(hostActor,hostUser.id,{sort:'name'});
const hostInventoryPage:Schemas['InventoryPage']=hostCore.inventoryPage(hostActor,{sort:'ordinal',lineId:'sample',limit:20});
const hostPackPage=hostCore.packsPage(hostActor,{sort:'id',after:'cursor'});
const hostPackCursor:string|null=hostCore.packPage(hostActor).next;
const hostVariantSummary=hostCore.collectionSummary(hostActor,{excludeTypes:['reward'],after:'variant',limit:20});
const hostVariantCount:number|undefined=hostVariantSummary.items[0]?.count;
const hostVariantCard:Schemas['InventoryCopy']|undefined=hostVariantSummary.items[0]?.card;
const hostTotalCards:number=hostVariantSummary.totalCards;
declare const hostConversionInput:Operations['convert']['request'];
declare const hostTradeUpInput:Operations['tradeUp']['request'];
const hostConverted:Operations['convert']['response']=hostCore.convert(hostActor,hostConversionInput);
const hostTradeUpCopy:Schemas['Copy']=hostCore.tradeUp(hostActor,hostTradeUpInput);
const hostNotifications:Schemas['NotificationPage']=hostCore.notifications(hostActor,{limit:20});
const hostNotificationsRead:Schemas['NotificationReadReceipt']=hostCore.readNotifications(hostActor,{key:'notifications',ids:[]});
const hostIntent=hostCore.registerCommandIntent(hostActor,{command:'purchase',input:{productId:'draft'}},{operators:false});
const hostIntentKey:string=hostIntent.input.key;
const hostCommandHead=hostCore.commandIntent(hostActor,{id:hostIntent.id,command:'purchase'});
const hostCommandState:Schemas['CommandIntent']['state']=hostCommandHead.state;
const hostPendingCommands:{items:Schemas['CommandIntent'][]}=hostCore.commandIntents(hostActor,{command:'purchase',operators:false});
const hostExecuted:Schemas['CommandExecution']=hostCore.executeCommandIntent(hostActor,{id:hostIntent.id},{requireTradeReview:true});
const hostExecutedAsync:Promise<Schemas['CommandExecution']>=hostCore.executeCommandIntentAsync(hostActor,{id:hostIntent.id},{operators:false,signal:new AbortController().signal});
const hostAcknowledged:'acknowledged'=hostCore.acknowledgeCommandIntent(hostActor,{id:hostIntent.id}).state;
const hostAlbum:Schemas['AlbumRecord']=hostCore.saveAlbum(hostActor,{key:'album',name:'Collection'});
const hostAlbums:Schemas['AlbumRecord'][]=hostCore.albums(hostActor);
const hostPublicAlbum:Schemas['AlbumView']=hostCore.viewAlbum(null,hostAlbum.id);
hostCore.viewAlbum(undefined,hostAlbum.id);
const hostPublicAlbums:Schemas['PublicAlbumSummary'][]=hostCore.publicAlbums();
const hostSettlement={role:'admin',settlementProviderId:'payments',id:'operator'};
declare const hostPrepareExternal:Schemas['PrepareExternalPurchase'];
declare const hostCommitExternal:Schemas['CommitExternalPurchase'];
declare const hostCancelExternal:Schemas['CancelExternalPurchase'];
declare const hostCompensateExternal:Schemas['ConfirmExternalCompensation'];
declare const hostLegacyExternal:Schemas['ReconcileLegacyExternalPurchase'];
declare const hostResolveExternal:Schemas['ResolveLegacyExternalPurchase'];
const hostPreparation:Schemas['ExternalPurchaseProjection']=hostCore.prepareExternalPurchase(hostSettlement,hostPrepareExternal);
const hostExternalCommit:Schemas['ExternalPurchaseProjection']=hostCore.commitExternalPurchase(hostSettlement,hostCommitExternal);
const hostExternalCommitAsync:Promise<Schemas['ExternalPurchaseProjection']>=hostCore.commitExternalPurchaseAsync(hostSettlement,hostCommitExternal,{signal:new AbortController().signal});
const hostExternalCancel:Schemas['ExternalPurchaseProjection']=hostCore.cancelExternalPurchase(hostSettlement,hostCancelExternal);
const hostExternalCompensation:Schemas['ExternalPurchaseProjection']=hostCore.confirmExternalCompensation(hostSettlement,hostCompensateExternal);
const hostExternalStatus:Schemas['ExternalPurchaseProjection']=hostCore.externalPurchaseStatus(hostActor,{preparationId:hostPreparation.preparationId});
const hostExternalLookup:Schemas['ExternalPurchaseProjection']=hostCore.lookupExternalPurchase(hostSettlement,{providerId:'payments',transactionId:'transaction'});
const hostExternalPage:Schemas['ExternalPurchasePage']=hostCore.pendingExternalPurchases(hostSettlement,{providerId:'payments',after:null,limit:20});
const hostExternalNext:string|null=hostExternalPage.nextCursor;
const hostLegacyReconciled:Schemas['ExternalPurchaseProjection']=hostCore.reconcileLegacyExternalPurchase(hostSettlement,hostLegacyExternal);
const hostLegacyResolved:Schemas['ExternalPurchaseProjection']=hostCore.resolveLegacyExternalPurchase(hostSettlement,hostResolveExternal);
// @ts-expect-error A recovery head has no retained command input field.
hostCommandHead.input;
// @ts-expect-error Registered commands must use a supported durable command name.
hostCore.registerCommandIntent(hostActor,{command:'custom',input:{}});
// @ts-expect-error Command input keys must be strings when supplied.
hostCore.registerCommandIntent(hostActor,{command:'purchase',input:{key:123}});
// @ts-expect-error Async command execution returns a promise.
const immediateHostExecution:Schemas['CommandExecution']=hostCore.executeCommandIntentAsync(hostActor,{id:hostIntent.id});
// @ts-expect-error Settlement writes require a provider-scoped actor.
hostCore.prepareExternalPurchase(hostAuthority,hostPrepareExternal);
// @ts-expect-error Legacy resolution also requires an attributed operator ID.
hostCore.resolveLegacyExternalPurchase({settlementProviderId:'payments'},hostResolveExternal);
// @ts-expect-error Variant summary cards are optional when narrowing a projected row.
const requiredHostVariantCard:Schemas['InventoryCopy']=hostVariantSummary.items[0]!.card;
// @ts-expect-error Core pagination retains nullable next cursors.
const requiredHostPackCursor:string=hostCore.packPage(hostActor).next;
void [hostDirectory,hostPartnerInventory,hostInventoryPage,hostPackPage,hostPackCursor,hostVariantCount,hostVariantCard,hostTotalCards,hostConverted,hostTradeUpCopy,hostNotifications,hostNotificationsRead,hostIntentKey,hostCommandState,hostPendingCommands,hostExecuted,hostExecutedAsync,hostAcknowledged,hostAlbums,hostPublicAlbum,hostPublicAlbums,hostExternalCommit,hostExternalCommitAsync,hostExternalCancel,hostExternalCompensation,hostExternalStatus,hostExternalLookup,hostExternalNext,hostLegacyReconciled,hostLegacyResolved,immediateHostExecution,requiredHostVariantCard,requiredHostPackCursor];

const hostPurchasePolicyScope:'listing'=hostCore.setRemotePolicyEnabled(hostAuthority,{hook:'canPurchase',enabled:true}).scope;
const hostTransferPolicyScope:'transfer'=hostCore.setRemotePolicyEnabled(hostAuthority,{hook:'canTransfer',enabled:false}).scope;
const hostTradePolicyScope:'exchange'=hostCore.setRemotePolicyEnabled(hostAuthority,{hook:'canTrade',enabled:true}).scope;
const hostListingPolicyScope:'listing'=hostCore.setRemotePolicyEnabled(hostAuthority,{hook:'canList',enabled:true}).scope;
const hostFulfillments=hostCore.fulfillments(hostActor,{limit:20});
const hostJobs=hostCore.actionJobs(hostAuthority,{search:'pending'});
const hostActionCreatedAt:string|undefined=hostJobs.items[0]?.createdAt;
const hostRetriedAction=hostCore.retryAction(hostAuthority,{key:'retry',jobId:'job'});
const hostClaimedAction=hostCore.claimAction(hostAuthority);
if(hostClaimedAction){
  const lease:string=hostClaimedAction.leaseToken;
  const params:Record<string,unknown>=hostClaimedAction.params;
  const running:'running'=hostClaimedAction.status;
  hostCore.settleAction(hostAuthority,{jobId:hostClaimedAction.id,leaseToken:lease,succeeded:true});
  void [params,running];
}
hostCore.dispatchActions(hostAuthority,{limit:10,signal:new AbortController().signal}).then(results=>{
  for(const result of results){const id:string=result.id;if(result.status==='lease-lost'){const lost:'lease-lost'=result.status;void lost;}else{const attempts:number=result.totalAttempts;void attempts;}void id;}
});
declare const hostCodePoolInput:Operations['configureCodePool']['request'];
declare const hostCodeImportInput:Operations['importCodes']['request'];
const hostCodePool:Schemas['CodePoolRecord']=hostCore.configureCodePool(hostAuthority,hostCodePoolInput);
const hostCodeImport=hostCore.importCodes(hostAuthority,hostCodeImportInput);
const hostCodeImportPool:string=hostCodeImport.poolId;
const hostCodeImportTime:string=hostCodeImport.importedAt;
const hostCodePools:Schemas['CodePoolView'][]=hostCore.codePools(hostAuthority);
const hostCodeInventory:Schemas['CodeInventoryPage']=hostCore.codeInventory(hostAuthority,{sort:'name'});
const hostRegistrationMaterial=hostCore.codeRegistrationMaterial(hostAuthority,'code');
const hostCustodyPlaintext:string=hostRegistrationMaterial.code;
const hostCustodyHolder:string|null=hostRegistrationMaterial.holderId;
const hostCodeHistory=hostCore.codeHistory(hostActor,{limit:20});
const hostCodeHistoryName:string|undefined=hostCodeHistory.items[0]?.name;
const hostCodeRevealed=hostCore.revealCode(hostActor,{key:'reveal-code',codeId:'code'});
const hostRevealedPlaintext:string=hostCodeRevealed.code;
const hostCodeReported:Schemas['CodeSummary']=hostCore.reportCodeUsage(hostActor,{key:'report-code',codeId:'code',used:true});
const hostCodeConfirmed=hostCore.confirmCodeStatus({permissions:['codes.confirm'],codeProviderIds:['issuer']},{providerId:'issuer',eventId:'event',codeId:'code',status:'redeemed',occurredAt:new Date().toISOString()});
const hostConfirmedStatus:'redeemed'|'revoked'=hostCodeConfirmed.status;
const hostLookupMaterial=hostCore.codeLookupMaterial(hostActor,'code');
const hostLookupPlaintext:string=hostLookupMaterial.code;
const hostRotatedCount:number=hostCore.rotateCodeEncryption(hostAuthority).count;
const hostVerifiedCount:number=hostCore.verifyCodeVault(hostAuthority).count;
const hostBackfilledCount:number=hostCore.backfillProvenance(hostAuthority).count;
const hostIssuance:Schemas['CodeIssuanceStatus']=hostCore.codeIssuanceStatus(hostAuthority,{batchId:'batch'});
const hostIssuanceRecovery:Promise<Schemas['CodeIssuanceStatus']>=hostCore.recoverCodeIssuance(hostAuthority,{batchId:'batch'},{signal:new AbortController().signal});
const hostAudit:Schemas['AuditResult']=hostCore.audit(hostAuthority);
if('counts' in hostAudit){const copies:number=hostAudit.counts.copies;void copies;}
const hostWorkerActions:boolean=hostCore.workerPlan(hostAuthority).actions;
const hostCompletionCount:number=hostCore.backfillCompletionReservations(hostAuthority).count;
const hostExternalAllocationScope:'external-fulfillment'=hostCore.setRemoteExternalAllocationEnabled(hostAuthority,{enabled:true}).scope;
const hostAllocation:Schemas['AllocationStatus']=hostCore.allocationStatus(hostActor,{productId:'product'});
const hostAllocationAcknowledgement:Schemas['AllocationAcknowledgement']=hostCore.acknowledgeAllocation(hostActor,{attemptId:'attempt'});
const hostAllocationScope:'catalog-purchase'=hostCore.setRemoteAllocationEnabled(hostAuthority,{enabled:true}).scope;
const hostStockAllocationScope:'commerce-stock'=hostCore.setRemoteStockAllocationEnabled(hostAuthority,{enabled:true}).scope;
const hostStockQuote:Schemas['MintPackStockQuote']=hostCore.quoteMintPackStock(hostActor,{shopId:'shop',productId:'product',quantity:1});
const hostStockAllocation:Schemas['StockAllocationStatus']=hostCore.stockAllocationStatus(hostActor,{shopId:'shop',productId:'product'});
const hostFactory:Schemas['BindingFactoryStatus']=hostCore.bindingFactoryStatus(hostAuthority,{batchId:'batch'});
const hostFactoryRecovery:Promise<Schemas['BindingFactoryStatus']>=hostCore.recoverBindingFactories(hostAuthority,{batchId:'batch'},{signal:new AbortController().signal});
// @ts-expect-error Action history omits delivery parameters and lease secrets.
hostJobs.items[0]!.params;
// @ts-expect-error No due action returns null.
const requiredActionLease:string=hostCore.claimAction(hostAuthority).leaseToken;
// @ts-expect-error Dispatch is asynchronous.
const immediateDispatch:unknown[]=hostCore.dispatchActions(hostAuthority);
// @ts-expect-error Only registered policy hook names can be enabled.
hostCore.setRemotePolicyEnabled(hostAuthority,{hook:'canMint',enabled:true});
// @ts-expect-error Holder lookup is account-bound.
hostCore.codeLookupMaterial(hostAuthority,'code');
// @ts-expect-error Recovery is asynchronous even if a batch is already settled.
const immediateIssuance:Schemas['CodeIssuanceStatus']=hostCore.recoverCodeIssuance(hostAuthority,{batchId:'batch'});
// @ts-expect-error Manual settlement requires the active lease token.
hostCore.settleAction(hostAuthority,{jobId:'job',succeeded:true});
// @ts-expect-error Audit may return the no-catalog branch without counters.
const requiredAuditCount:number=hostCore.audit(hostAuthority).counts.copies;
void [hostPurchasePolicyScope,hostTransferPolicyScope,hostTradePolicyScope,hostListingPolicyScope,hostFulfillments,hostActionCreatedAt,hostRetriedAction,hostCodePool,hostCodeImportPool,hostCodeImportTime,hostCodePools,hostCodeInventory,hostCustodyPlaintext,hostCustodyHolder,hostCodeHistoryName,hostRevealedPlaintext,hostCodeReported,hostConfirmedStatus,hostLookupPlaintext,hostRotatedCount,hostVerifiedCount,hostBackfilledCount,hostIssuance,hostIssuanceRecovery,hostWorkerActions,hostCompletionCount,hostExternalAllocationScope,hostAllocation,hostAllocationAcknowledgement,hostAllocationScope,hostStockAllocationScope,hostStockQuote,hostStockAllocation,hostFactory,hostFactoryRecovery,requiredActionLease,immediateDispatch,immediateIssuance,requiredAuditCount];

import type {CodeVault} from '@digital-card/framework/code-vault';
import type {FrameworkOptions} from '../src/core.js';
declare const hostVault:CodeVault;
const hostIntegrationOptions:FrameworkOptions={
  bindings:{receipt:({copy,user,spec})=>{const copyId:string=copy.id;const source:unknown=copy.source;const name:string=user.displayName;const factory:string=spec.factory;void [source,factory];return {copyId,name};}},
  policies:{
    canList:({actor,shop,listing})=>{const actorId:string|undefined=actor.userId;const shopId:string=shop.id;const price:number=listing.price.amount;void [actorId,shopId,price];return true;},
    canPurchase:({user,shop,listing})=>{const userId:string=user.id;void [userId,shop,listing];return 'Account is not eligible';},
    canTransfer:(copy,fromUserId,context)=>{const channel:'sale'|'trade'=context.channel;const to:string|null=context.toUserId;void [copy,fromUserId,channel,to];return true;},
    canTrade:context=>{const copyIds:string[]=context.give.copyIds;const channel:'sale'|'trade'=context.channel;void [copyIds,channel];return true;},
  },
  codeVault:hostVault,codeLimits:{maxCodes:1000,maxRequests:10000},
  codeGenerators:{serial:({copy,pool})=>{const id:string=copy.id;const provider:string=pool.providerId;void provider;return {code:id,externalId:'reference',metadata:{issued:true}};}},
  allocationCodeIssuers:{local:{kind:'pure',providerId:'issuer',generate:entry=>({code:entry.issuanceId})},remote:{providerId:'issuer',url:'https://provider.example/issue',token:'example-token'}},
  allocationBindingFactories:{local:{kind:'pure',providerId:'factory',revision:1,userFields:['id'],produce:entry=>({owner:entry.userId})},remote:{kind:'activation',providerId:'factory',revision:1,url:'https://provider.example/bind',token:'example-token'}},
  actionHandlers:{
    immediate:job=>{const key:string=job.idempotencyKey;job.signal.throwIfAborted();void key;},
    asynchronous:async job=>{const data:unknown=job.params;const userId:string|null=job.userId;void [data,userId];return {received:true};},
  },
  actionOptions:{maxAttempts:5,leaseMs:60000,timeoutMs:10000,retryMs:1000},
  eventSubscriptions:[{id:'events',handler:'asynchronous',events:['pack.opened','*']}],
  externalPurchaseProviders:{payments:{
    validateIntent:({intent,user})=>{const transaction:string=intent.transactionId;const userId:string=user.id;void transaction;return userId===intent.userId;},
    verifyProof:({proof,intent,preparationId,operation})=>{const kind:'debit'|'no_debit'|'refund'=proof.kind;const mode:'debit'|'no_debit'|'refund'|'resolve_legacy'=operation;void [kind,mode,preparationId];return proof.fingerprint.length>0&&proof.userId===intent.userId;},
  }},
  externalPurchaseLimits:{pendingPerUser:20,pendingPerProvider:1000,records:100000},
  remotePolicies:{
    canPurchase:{scope:'listing',providerId:'purchase',url:'https://provider.example/purchase',token:'example-token'},
    canList:{scope:'listing',providerId:'listing',url:'https://provider.example/list',token:'example-token'},
    canTransfer:{scope:'transfer',providerId:'transfer',url:'https://provider.example/transfer',token:'example-token'},
    canTrade:{scope:'exchange',providerId:'trade',url:'https://provider.example/trade',token:'example-token'},
  },
  remoteAllocation:{scope:'catalog-purchase',algorithm:'weighted-deck@4',providerId:'allocation',url:'https://provider.example/allocate',token:'example-token'},
  remoteStockAllocation:{scope:'commerce-stock',algorithm:'weighted-deck@4',providerId:'stock',url:'https://provider.example/stock',token:'example-token'},
  remoteExternalAllocation:{scope:'external-fulfillment',algorithm:'weighted-deck@4',providerId:'external',url:'https://provider.example/external',token:'example-token'},
};
const hostIntegratedCore=new CardFramework(hostIntegrationOptions);
new CardFramework({remoteAllocation:null,remoteStockAllocation:null,remoteExternalAllocation:null});
// @ts-expect-error Legacy binding factories must return synchronous JSON objects.
new CardFramework({bindings:{asyncReceipt:async()=>({receipt:true})}});
// @ts-expect-error Legacy code generators must return synchronously.
new CardFramework({codeGenerators:{asyncCode:async()=>({code:'example'})}});
// @ts-expect-error Host policy callbacks are synchronous decisions.
new CardFramework({policies:{canPurchase:async()=>true}});
// @ts-expect-error External evidence attestations must be synchronous.
new CardFramework({externalPurchaseProviders:{payments:{validateIntent:async()=>true,verifyProof:()=>true}}});
// @ts-expect-error Typed remote hooks preserve their required scope.
new CardFramework({remotePolicies:{canTrade:{scope:'transfer',providerId:'trade',url:'https://provider.example/trade',token:'example-token'}}});
// @ts-expect-error External purchase limits have three supported names.
new CardFramework({externalPurchaseLimits:{pending:20}});
// @ts-expect-error Code capacity settings do not accept arbitrary option names.
new CardFramework({codeLimits:{capacity:1000}});
// @ts-expect-error Subscriptions require the target handler name.
new CardFramework({eventSubscriptions:[{id:'events',events:['pack.opened']}]});
void hostIntegratedCore;

import {MemoryStore, initialState} from '../src/store.js';
import type {StorageState, StoredPack, StoredCode, StoragePage} from '../src/storage-types.js';
const hostMemory=new MemoryStore();
const hostInitialState:StorageState=initialState();
const hostInitialCatalog:CoreCatalog|null=hostInitialState.catalog;
const hostReadRevision:number=hostMemory.read(state=>state.revision);
const hostTransactionResult:{next:number}=hostMemory.transact(state=>{state.revision+=1;state.users[hostUser.id]=hostUser;return {next:state.revision};});
const hostDetachedUser=hostMemory.read(state=>state.users[hostUser.id]);
const hostDetachedId:string|undefined=hostDetachedUser?.id;
const hostQueryResult=hostMemory.query(queries=>{
  const version:number|undefined=queries.get('catalog','version');
  const userId:string|undefined=queries.get('users',hostUser.id)?.id;
  const wallet:Record<string,number>|undefined=queries.get('balances',hostUser.id);
  const extension:unknown=queries.get('hostExtension','record');
  const revision:number=queries.value('revision');
  const catalog:CoreCatalog|null=queries.value('catalog');
  const copies=queries.records('copies',{ids:['copy']});const copyId:string|undefined=copies.copy?.id;
  const identity=queries.providerIdentity(hostUser.id);const provider:string|undefined=identity?.provider;
  const user=queries.userByIdentity('host','account');const name:string|undefined=user?.displayName;
  const counts=queries.collectionCounts(hostUser.id);const owned:number=counts.ownedCopies;
  const summary=queries.variantCounts({ownerId:hostUser.id,excludeTypes:['reward']});const exemplar:string|undefined=summary.items[0]?.copyId;
  const present:boolean|undefined=queries.ownedCardPresence(hostUser.id,['card'])[0]?.owned;
  const codes:StoredCode[]=queries.availableCodeStock('pool',20,new Date().toISOString());
  const codeOrdinal:number|undefined=queries.importedCodePrefix('pool',20,new Date().toISOString())[0]?.ordinal;
  const notifications=queries.notifications(hostUser.id);const recipient:string|undefined=notifications[0]?.userId;
  const codeHistory=queries.codeHistoryEntries(hostUser.id);const secretKeyId:string|undefined=codeHistory[0]?.code.secret.keyId;
  const packs:StoragePage<StoredPack>=queries.pagePacks({ownerId:hostUser.id,status:'unopened',sort:'ordinal'});
  const packCopyIds:string[]|undefined=packs.items[0]?.copyIds;
  const poolId:string|undefined=queries.pageCodes({poolId:'pool',states:['available']}).items[0]?.poolId;
  const purchase=queries.pageExternalPurchases({providerId:'payments',sort:'id'}).items[0];const purchaseId:string|undefined=purchase?.preparationId;
  const inventory=queries.pageCopies({ownerId:hostUser.id,state:'owned',sort:'name'});const total:number=inventory.total;
  void [version,userId,wallet,extension,revision,catalog,copyId,provider,name,owned,exemplar,present,codes,codeOrdinal,recipient,secretKeyId,packCopyIds,poolId,purchaseId,total];
  return {revision,next:packs.next};
});
const hostStorageCursor:string|null=hostQueryResult.next;
const hostMeasurement=hostMemory.measure(hostInitialState);const hostStoredBytes:number=hostMeasurement.usedBytes;
hostMemory.assertCapacity(hostInitialState);
const hostDueTrades:string[]=hostMemory.selectDueExpirations('trades',new Date().toISOString(),20);
const hostDueRaffles:string[]=hostMemory.selectDueRaffles(new Date().toISOString(),20);
const hostPrepared:boolean=hostMemory.prepareRecordTransactions({force:true}).prepared;
// @ts-expect-error Transaction callbacks must be synchronous.
hostMemory.transact(async state=>state.revision);
// @ts-expect-error Query callbacks cannot return a promise after the snapshot closes.
hostMemory.query(async queries=>queries.value('revision'));
// @ts-expect-error Read results must be detached synchronously.
hostMemory.read(async state=>state.revision);
// @ts-expect-error Known stored users retain their typed fields.
hostMemory.transact(state=>{state.users.account={id:123};});
// @ts-expect-error Query lookup preserves missing-record outcomes.
const requiredStoredUserId:string=hostMemory.query(queries=>queries.get('users','missing').id);
// @ts-expect-error Scoped query callback methods have checked parameter shapes.
hostMemory.query(queries=>queries.records('copies',{ids:[123]}));
// @ts-expect-error The due-expiration selector supports trades and listings.
hostMemory.selectDueExpirations('copies',new Date().toISOString());
hostMemory.close();
void [hostInitialCatalog,hostReadRevision,hostTransactionResult,hostDetachedId,hostStorageCursor,hostStoredBytes,hostDueTrades,hostDueRaffles,hostPrepared,requiredStoredUserId];

import type {FrameworkStorage, RecordTransactionOptions, StorageRecordTransaction} from '../src/storage-record-types.js';
const hostSharedStorage:FrameworkStorage=hostMemory;
const hostRecordOptions:RecordTransactionOptions={maxRecords:4096,maxBytes:1048576,bindingFactories:false,codeIssuance:false,allocationJournal:false,allocationPurchase:false,allocationListing:false,intent:true,preferences:false,packCompletion:false,tradeProposal:false,tradeCompletion:false,tradeAcceptance:false,tradeCounter:false,actionDelivery:false,actionRetry:false,listingCompletion:false,listingCancellation:false,listingPurchase:false,listingCreation:false,raffle:false,raffleDraw:false};
declare const hostStoredNotification:Schemas['Notification']&{userId:string};
const hostRecordResult:{id:string|undefined;count:number}=hostSharedStorage.transactRecords(records=>{
  const user=records.get('users',hostUser.id);const id:string|undefined=user?.id;
  const revision:number=records.value('revision');
  const ownerCount:number=records.ownerCounts(hostUser.id).ownedCopies;
  const count:number=records.count('users');
  const stock:StoredCode[]=records.availableCodeStock('pool',20,new Date().toISOString());
  const prefix=records.importedCodePrefix('pool',20,new Date().toISOString());const ordinal:number|undefined=prefix[0]?.ordinal;
  const presence:boolean|undefined=records.ownedCardPresence(hostUser.id,['card'])[0]?.owned;
  const variantCount:number=records.ownedVariantCount(hostUser.id,['variant']);
  if(user){const staged=records.put('users',user.id,user);const stagedId:string=staged.id;void stagedId;}
  const appended:number=records.append('notifications',hostStoredNotification);
  records.trimNotifications(hostUser.id,2000);
  records.setScalar('commandIntentCount',(records.value('commandIntentCount')??0)+1);
  records.reserveIntentCompletion('intent:example',{admission:true});
  const listing=records.get('listings','listing');const unitKind:'copy'|'pack'|'action'|undefined=listing?.units[0]?.kind;
  const refs=records.get('_copyReferences','copy');const favoriteUsers:string[]|undefined=refs?.users;
  void [revision,ownerCount,stock,ordinal,presence,variantCount,appended,unitKind,favoriteUsers];
  return {id,count};
},hostRecordOptions);
declare const hostRecordAPI:StorageRecordTransaction;
hostRecordAPI.reserveTradeCompletion('trade:example');
hostRecordAPI.reserveListingCompletion('listing:example');
hostRecordAPI.reserveActionCompletion('action:example');
hostRecordAPI.reservePackCompletion('pack:example');
const hostAdmission=hostRecordAPI.admitBindingFactoryResult({invocationId:'invocation',jobId:'job',leaseToken:'lease',state:'active',data:{ready:true}});
hostRecordAPI.admitBindingFactoryResult({invocationId:'dependent',jobId:'job',leaseToken:'lease',state:'activation_failed',dependencyOf:'invocation'});
const hostAdmittedInvocation:string=hostAdmission.invocationId;
// @ts-expect-error Record transaction callbacks must be synchronous.
hostMemory.transactRecords(async records=>records.value('revision'));
// @ts-expect-error Known object records retain required user fields.
hostRecordAPI.put('users','account',{id:123});
// @ts-expect-error Scalar fields are not object collections.
hostRecordAPI.put('revision','account',1);
// @ts-expect-error Append is for array fields.
hostRecordAPI.append('users',hostUser);
// @ts-expect-error User collections cannot be replaced by scalar writes.
hostRecordAPI.setScalar('users',{});
// @ts-expect-error Undefined cannot be staged as a record value.
hostRecordAPI.put('hostExtension','record',undefined);
// @ts-expect-error Notification retention is fixed at 2000.
hostRecordAPI.trimNotifications(hostUser.id,100);
// @ts-expect-error Active binding admission requires result data.
hostRecordAPI.admitBindingFactoryResult({invocationId:'invocation',jobId:'job',leaseToken:'lease',state:'active'});
// @ts-expect-error Failed binding admission cannot carry result data.
hostRecordAPI.admitBindingFactoryResult({invocationId:'invocation',jobId:'job',leaseToken:'lease',state:'activation_failed',data:{}});
// @ts-expect-error Admission tokens are frozen.
hostAdmission.invocationId='replacement';
// @ts-expect-error Record budgets and selected scopes use known option names.
hostMemory.transactRecords(()=>undefined,{maxRows:100});
void [hostRecordResult,hostAdmittedInvocation];

import {SQLiteStore} from '@digital-card/framework/sqlite';
import type {SQLiteMigration, SQLiteStorageDiagnostics} from '../src/sqlite.js';
import type {FrameworkStore} from '../src/core.js';
const sqliteMemory=new SQLiteStore();
const sqliteHost=new SQLiteStore('framework.sqlite',{
  readOnly:false,maxStateBytes:1024*1024,maxCompletionBytes:1024*1024,
  onMigration(migration){
    const stage:SQLiteMigration['stage']=migration.stage;
    const version:number=migration.to;
    return {stage,version};
  }
});
const sqliteRevision:number=sqliteHost.query(queries=>queries.value('revision'));
const sqliteWrite:{revision:number}=sqliteHost.transact(state=>({revision:state.revision}));
const sqliteRecordRevision:number=sqliteHost.transactRecords(records=>records.value('revision'),{intent:true});
const sqliteCapacity:number=sqliteHost.assertCapacity(initialState(),{previous:initialState()}).completionLimitBytes;
const sqliteDueActions:string[]=sqliteHost.selectDueActions('2026-01-01T00:00:00Z',20);
const sqliteDiagnostics:SQLiteStorageDiagnostics=sqliteHost.diagnostics();
const sqliteIntegrity:boolean=sqliteHost.integrity();
const sqliteBackup:Promise<{path:'backup.sqlite';revision:number}>=sqliteHost.backup('backup.sqlite');
sqliteHost.prepareRecordTransactions({force:true});
sqliteHost.close();
new CardFramework({store:sqliteMemory});
new CardFramework({store:hostMemory});
// Optional due selectors use snapshot fallbacks.
const customFrameworkStore:FrameworkStore={
  read:hostMemory.read.bind(hostMemory),transact:hostMemory.transact.bind(hostMemory),
  query:hostMemory.query.bind(hostMemory),measure:hostMemory.measure.bind(hostMemory),
  transactRecords:hostMemory.transactRecords.bind(hostMemory),
  prepareRecordTransactions:hostMemory.prepareRecordTransactions.bind(hostMemory),close:()=>{}
};
new CardFramework({store:customFrameworkStore});
// @ts-expect-error Migration callbacks cannot return promises.
new SQLiteStore('async.sqlite',{onMigration:async()=>{}});
// @ts-expect-error SQLite snapshots cannot return promises.
sqliteHost.read(async state=>state.revision);
// @ts-expect-error SQLite record callbacks cannot return promises.
sqliteHost.transactRecords(async records=>records.value('revision'));
// @ts-expect-error Encryption keys use byte buffers.
new SQLiteStore('encrypted.sqlite',{encryptionKey:'key'});
// @ts-expect-error Snapshot-only stores do not support all command/custody workflows.
new CardFramework({store:{read:hostMemory.read.bind(hostMemory),transact:hostMemory.transact.bind(hostMemory),close:()=>{}}});
void [sqliteRevision,sqliteWrite,sqliteRecordRevision,sqliteCapacity,sqliteDueActions,sqliteDiagnostics,sqliteIntegrity,sqliteBackup];
