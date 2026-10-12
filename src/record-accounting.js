import {completionPool,missingCompletions,ordinaryRequestCount} from './completion.js';
import {check} from './catalog.js';

export const recordAccountingField='_recordAccounting';
export const raffleDueRecord=listing=>({id:listing.id,status:listing.status==='active'&&listing.raffle&&!listing.draw?'pending':'closed',createdAt:listing.raffle?new Date(listing.raffle.entryClosesAt).toISOString():'',state:listing.endsAt?new Date(listing.endsAt).toISOString():'9999-12-31T23:59:59.999Z'});
export function validRecordAccounting(summary,revision){
  const count=value=>Number.isSafeInteger(value)&&value>=0;
  return summary?.version===3&&summary.revision===revision&&count(summary.usedBytes)
    &&summary.counts!==null&&typeof summary.counts==='object'&&!Array.isArray(summary.counts)&&Object.values(summary.counts).every(count)
    &&['ordinaryRequests','ordinaryJobs','ordinaryEvents','missingCompletions','legacyPurchases','externalReservedBytes'].every(key=>count(summary[key]))
    &&['actions','trades','listings'].every(key=>count(summary.workers?.[key]))
    &&['obligations','requests','jobs','events','storedBytes','reservedBytes'].every(key=>count(summary.completion?.[key]));
}
export function summarizeRecords(state){
  const obligations=Object.values(state.completionObligations??{}),pending=obligations.filter(row=>row.status==='reserved');
  const pool=completionPool(state),requests=Object.values(state.requests??{}).concat(Object.values(state.operatorRequests??{}));
  return {version:3,revision:state.revision,usedBytes:0,
    counts:Object.fromEntries(Object.entries(state).filter(([name,value])=>name!==recordAccountingField&&value&&typeof value==='object').map(([name,value])=>[name,Object.keys(value).length])),
    ordinaryRequests:ordinaryRequestCount(state),ordinaryJobs:Object.values(state.actionJobs??{}).filter(row=>!row.completionId).length,
    ordinaryEvents:(state.events??[]).filter(row=>!row.completionId).length,missingCompletions:missingCompletions(state).length,
    legacyPurchases:Object.values(state.externalPurchases??{}).filter(row=>row.legacy?.purchaseKey).length,
    workers:{actions:Object.values(state.actionJobs??{}).filter(row=>['pending','running'].includes(row.status)).length,trades:Object.values(state.trades??{}).filter(row=>row.status==='pending').length,listings:Object.values(state.listings??{}).filter(row=>row.status==='active').length},
    completion:{obligations:obligations.length,requests:requests.filter(row=>row.completionId).length+pending.length,
      jobs:Object.values(state.actionJobs??{}).filter(row=>row.completionId).length+pending.reduce((n,row)=>n+row.jobs,0),
      events:(state.events??[]).filter(row=>row.completionId).length+pending.reduce((n,row)=>n+row.events,0),
      storedBytes:pool.storedBytes,reservedBytes:pool.reservedBytes},
    externalReservedBytes:Object.values(state.externalPurchases??{}).reduce((n,row)=>n+(row.completionBytes??0),0)};
}

/** Compatibility writers refresh the revision-bound summary inside their transaction. */
export function updateRecordAccounting(state,measure){
  const summary=summarizeRecords(state);
  for(let i=0;i<12;i++){
    state[recordAccountingField]=JSON.stringify(summary);
    const bytes=measure(state);
    if(bytes===summary.usedBytes)return summary;
    summary.usedBytes=bytes;
  }
  throw new Error('Record accounting did not stabilize');
}

/** Derived metadata is part of an admitted completion's actual byte cost. */
export function finalizeRecordAccounting(state,previous,measure){
  const candidates=Object.values(state.completionObligations??{}).filter(row=>row.usedBytes>(previous.completionObligations?.[row.id]?.usedBytes??0)
    ||row.status==='completed'&&previous.completionObligations?.[row.id]?.status==='reserved').map(row=>({row,base:row.usedBytes}));
  if(!candidates.length)return updateRecordAccounting(state,measure);
  const baseline=measure(state);let extra=0;
  for(let i=0;i<12;i++){
    let remaining=extra;
    for(const {row,base}of candidates){const assigned=Math.min(remaining,row.bytes-base);row.usedBytes=base+assigned;remaining-=assigned;}
    check(remaining===0,'COMPLETION_INVARIANT','Completion record accounting exceeds its reserved bytes',500);
    const summary=updateRecordAccounting(state,measure),needed=Math.max(0,summary.usedBytes-baseline);
    if(needed===extra)return summary;
    extra=needed;
  }
  check(false,'COMPLETION_INVARIANT','Completion record accounting did not stabilize',500);
}

/** Rebuild encrypted escrow and copy-reference projections for compatibility writers. */
export function updateTradeEscrow(state){
 const rows=Object.create(null);for(const owner of Object.keys(state._tradeEscrow??{}))rows[owner]=Object.create(null);
 for(const trade of Object.values(state.trades??{}))if(trade.status==='pending')for(const money of trade.give.currencies){
  check(Number.isSafeInteger(money.amount)&&money.amount>0,'INVALID_STATE','Invalid refundable escrow',500);
  const row=rows[trade.fromUserId]??=Object.create(null),sum=BigInt(row[money.currencyId]??0)+BigInt(money.amount);check(sum<=BigInt(Number.MAX_SAFE_INTEGER),'INVALID_STATE','Refundable escrow exceeds integer range',500);row[money.currencyId]=Number(sum);
 }
 state._tradeEscrow=rows;
 const references=Object.create(null);for(const id of Object.keys(state.copies??{}))references[id]={users:[],albums:[]};
 for(const user of Object.values(state.users??{}))for(const id of user.preferences?.favoriteCopyIds??[])if(references[id])references[id].users.push(user.id);
 for(const album of Object.values(state.albums??{}))for(const placement of album.placements??[])if(references[placement.copyId])references[placement.copyId].albums.push(album.id);
 state._copyReferences=references;
 const purchases=Object.create(null);for(const order of Object.values(state.orders??{})){const key=JSON.stringify([order.listingId,order.buyerId]),sum=(purchases[key]??0)+order.quantity;check(Number.isSafeInteger(sum)&&sum>=0,'INVALID_STATE','Invalid listing purchase quantity',500);purchases[key]=sum;}
 state._listingPurchases=purchases;state._listingPurchasesReady=true;state._listingPurchasesRevision=state.revision;
 const shops=Object.create(null);for(const listing of Object.values(state.listings??{}))if(listing.status==='active')shops[listing.shopId]=(shops[listing.shopId]??0)+1;
 state._shopListingCounts=shops;
 state._raffleDue=Object.fromEntries(Object.values(state.listings??{}).map(listing=>[listing.id,raffleDueRecord(listing)]));state._raffleDueRevision=state.revision;
 const identities=Object.create(null);for(const code of Object.values(state.codes??{})){identities[JSON.stringify(['fingerprint',code.fingerprint])]=code.id;if(code.externalId)identities[JSON.stringify(['external',code.providerId,code.externalId])]=code.id;}
 state._codeIdentities=identities;state._codeStock=Object.fromEntries(Object.values(state.codes??{}).map(row=>[row.id,{id:row.id,variantId:row.id,poolId:row.poolId,status:row.status,createdAt:row.expiresAt?new Date(row.expiresAt).toISOString():''}]));state._listingCreationReady=true;state._listingCreationRevision=state.revision;
}

/** Maintain encrypted creation projections alongside record changes. */
export function updateListingCreationRecords(tx,plan){
 if(tx.value('_raffleDueRevision')===tx.value('revision'))for(const row of plan.changes)if(row.collection==='listings')tx.put('_raffleDue',row.key,raffleDueRecord(row.value));
 if(tx.value('_listingCreationReady')!==true||tx.value('_listingCreationRevision')!==tx.value('revision'))return;
 for(const row of plan.changes){
  if(row.collection==='listings'){
   const deltas=new Map();for(const [value,sign]of [[row.old?.value,-1],[row.value,1]])if(value?.status==='active')deltas.set(value.shopId,(deltas.get(value.shopId)??0)+sign);
   for(const [shopId,delta]of deltas)if(delta){const count=(tx.get('_shopListingCounts',shopId)??0)+delta;check(Number.isSafeInteger(count)&&count>=0,'INVALID_STATE','Invalid active listing count',500);tx.put('_shopListingCounts',shopId,count);}
  }
  if(row.collection==='codes'&&!row.old){tx.put('_codeIdentities',JSON.stringify(['fingerprint',row.value.fingerprint]),row.key);if(row.value.externalId)tx.put('_codeIdentities',JSON.stringify(['external',row.value.providerId,row.value.externalId]),row.key);}
  if(row.collection==='codes')tx.put('_codeStock',row.key,{id:row.key,variantId:row.key,poolId:row.value.poolId,status:row.value.status,createdAt:row.value.expiresAt?new Date(row.value.expiresAt).toISOString():''});
 }
}

export const recordPreparationMarker='prepare-accounting-v3';
/** Existing completions may drop stale caches without allocating a migration. */
export function refreshTradeAccounting(state){
 let version;try{version=JSON.parse(state[recordAccountingField]).version;}catch{}
 if(version!==3&&state[recordAccountingField]!==recordPreparationMarker){delete state[recordAccountingField];delete state._tradeEscrow;delete state._copyReferences;return false;}
 updateTradeEscrow(state);return true;
}
