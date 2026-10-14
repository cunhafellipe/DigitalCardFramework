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
