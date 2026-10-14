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
