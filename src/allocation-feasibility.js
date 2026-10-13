import {check} from './catalog.js';

// Work limits return an unknown result; they never turn an unproved suffix into a refusal.
export const allocationSolverLimits=Object.freeze({draws:2000,generalDraws:64,states:20000,transitions:200000,memoBytes:16*1024*1024,edgeVisits:50000000});
const fail=()=>check(false,'ALLOCATION_SOLVER_LIMIT','Allocation feasibility requires a smaller reviewed batch',503);

class Flow{
 constructor(nodes,stats,limit){this.edges=Array.from({length:nodes},()=>[]);this.stats=stats;this.limit=limit;}
 visit(){if(++this.stats.edgeVisits>this.limit)fail();}
 add(from,to,capacity){const forward={from,to,capacity,reverse:this.edges[to].length},reverse={from:to,to:from,capacity:0,reverse:this.edges[from].length};this.edges[from].push(forward);this.edges[to].push(reverse);return forward;}
 reverse(edge){return this.edges[edge.to][edge.reverse];}
 augment(edge){edge.capacity--;this.reverse(edge).capacity++;}
 max(source,sink){let total=0;
  for(;;){const level=Array(this.edges.length).fill(-1),queue=[source];level[source]=0;for(let n=0;n<queue.length;n++)for(const edge of this.edges[queue[n]]){this.visit();if(edge.capacity>0&&level[edge.to]<0){level[edge.to]=level[edge.from]+1;queue.push(edge.to);}}if(level[sink]<0)return total;
   const next=Array(this.edges.length).fill(0),send=(node,available)=>{if(node===sink)return available;for(;next[node]<this.edges[node].length;next[node]++){const edge=this.edges[node][next[node]];this.visit();if(edge.capacity<=0||level[edge.to]!==level[node]+1)continue;const sent=send(edge.to,Math.min(available,edge.capacity));if(sent){edge.capacity-=sent;this.reverse(edge).capacity+=sent;return sent;}}return 0;};
   for(let sent;(sent=send(source,2000))>0;)total+=sent;
  }
 }
 toward(target){const path=Array(this.edges.length).fill(null),seen=new Set([target]),queue=[target];for(let n=0;n<queue.length;n++)for(const outward of this.edges[queue[n]]){this.visit();const incoming=this.reverse(outward);if(incoming.capacity>0&&!seen.has(incoming.from)){seen.add(incoming.from);path[incoming.from]=incoming;queue.push(incoming.from);}}return {seen,path};}
}

function isFast(context){return context.product.duplicatePolicy.scope==='none'&&!(context.mode==='personalized'&&context.product.pity)&&context.variants.every(value=>!(value.codeDemand??[]).some(row=>row.count>0));}
const deterministic=context=>context.product.slots.every(slot=>slot.probability.numerator===0||slot.pool.length<=1);

/** Static worst-case admission covers every optional presence layout before entropy is inspected. */
export function validateAllocationSolverAdmission(context){
 const draws=context.quantity*context.product.slots.reduce((n,slot)=>n+(slot.probability.numerator===0?0:slot.count),0);
 check(draws<=allocationSolverLimits.draws,'ALLOCATION_LIMIT','Allocation batch exceeds 2000 cards',502);
 const slots=context.product.slots.length,variants=context.variants.length,entries=context.product.slots.reduce((n,slot)=>n+slot.pool.length,0),edges=entries+slots+variants;
 if(isFast(context)){const visits=4*edges*(draws+Math.min(slots,variants)+2)+draws*(slots+variants+2);check(visits<=allocationSolverLimits.edgeVisits,'ALLOCATION_SOLVER_LIMIT','Allocation matching graph exceeds the bounded solver scope',502);return {kind:'flow',draws,edgeVisitBound:visits};}
 const cells=variants+context.codePools.length+entries,keyBytes=256+cells*32+variants*24;
 if(deterministic(context)){check((draws+1)*keyBytes<=allocationSolverLimits.memoBytes,'ALLOCATION_SOLVER_LIMIT','Deterministic allocation state exceeds the exact solver scope',502);return {kind:'deterministic',draws};}
 check(draws<=allocationSolverLimits.generalDraws,'ALLOCATION_SOLVER_LIMIT','Interacting allocation batches exceed the exact solver scope',502);
 let frontier=1,nodes=1;
 for(let pack=0;pack<context.quantity;pack++)for(const slot of context.product.slots){if(slot.probability.numerator===0)continue;const branches=Math.max(1,slot.pool.filter(value=>value.weight>0).length);for(let n=0;n<slot.count;n++){frontier*=branches;nodes+=frontier;if(!Number.isSafeInteger(nodes)||nodes* Math.max(1,draws)>allocationSolverLimits.transitions)check(false,'ALLOCATION_SOLVER_LIMIT','Interacting allocation choices exceed the exact solver scope',502);}}
 check(nodes<=allocationSolverLimits.states&&nodes*keyBytes<=allocationSolverLimits.memoBytes,'ALLOCATION_SOLVER_LIMIT','Interacting allocation state exceeds the exact solver scope',502);
 return {kind:'search',draws,nodes};
}

/** Pure exact oracle. Presence is already frozen; this module never draws entropy or performs effects. */
export function createAllocationFeasibilitySolver(context,presence,{limits=allocationSolverLimits}={}){
 const {product,quantity,variants}=context,byId=new Map(variants.map((variant,index)=>[variant.id,index])),cards=[...new Set(variants.map(variant=>variant.cardId))],cardIndex=new Map(cards.map((id,index)=>[id,index])),poolIndex=new Map(context.codePools.map((pool,index)=>[pool.id,index])),personal=context.mode==='personalized',inventory=personal&&product.duplicatePolicy.scope==='inventory';
 check(Array.isArray(presence)&&presence.length===quantity*product.slots.length&&presence.every((value,index)=>{const probability=product.slots[index%product.slots.length].probability;return typeof value==='boolean'&&(probability.numerator!==0||!value)&&(probability.numerator!==probability.denominator||value);}),'INVALID_ALLOCATION_REQUEST','A frozen allocation presence layout is required',502);
 const offsets=[],entries=[],draws=[];for(const slot of product.slots){offsets.push(entries.length);for(const row of slot.pool)entries.push(row);}
 for(let packIndex=0;packIndex<quantity;packIndex++)for(const [slotIndex,slot]of product.slots.entries())if(presence[packIndex*product.slots.length+slotIndex])for(let ordinal=0;ordinal<slot.count;ordinal++)draws.push({packIndex,slotIndex,ordinal});
 const firstCard=product.slots.findIndex(slot=>slot.role==='card'),fast=isFast(context),single=deterministic(context),graphs=new WeakMap(),memo=new Map(),steps=new WeakMap(),results=new WeakMap(),stats={states:0,transitions:0,memoBytes:0,edgeVisits:0};
 const normalize=state=>{const nextPack=draws[state.index]?.packIndex??quantity;while(state.packIndex<nextPack){if(personal&&product.pity){state.pityCount=state.qualified?0:state.pityCount+1;if(!Number.isSafeInteger(state.pityCount))return null;}state.packIndex++;state.qualified=false;state.excluded=new Set(inventory?state.owned:[]);state.due=!!(personal&&product.pity&&state.pityCount>=product.pity.after-1);}return state;};
 const initial=normalize({index:0,packIndex:0,tickets:entries.map(value=>value.weight),remaining:variants.map(value=>value.remaining),codes:context.codePools.map(value=>value.available),owned:new Set(context.ownedCards.filter(value=>value.owned).map(value=>cardIndex.get(value.cardId)).filter(value=>value!==undefined)),excluded:new Set(inventory?context.ownedCards.filter(value=>value.owned).map(value=>cardIndex.get(value.cardId)).filter(value=>value!==undefined):[]),pityCount:context.pityCount,qualified:false,due:!!(personal&&product.pity&&context.pityCount>=product.pity.after-1)});
 const choices=state=>{if(!state||state.index===draws.length)return [];const position=draws[state.index],slot=product.slots[position.slotIndex],base=[];
  for(const [index,row]of slot.pool.entries()){const id=byId.get(row.variantId),variant=variants[id],weight=state.tickets[offsets[position.slotIndex]+index];if(weight<=0||state.remaining[id]===0||(variant.codeDemand??[]).some(value=>state.codes[poolIndex.get(value.poolId)]<value.count)||state.due&&position.slotIndex===firstCard&&position.ordinal===0&&variant.rarityRank<product.pity.minimumRank)continue;base.push({index,weight});}
  if(slot.role==='insert'||product.duplicatePolicy.scope==='none')return base;
  const filtered=base.filter(value=>!state.excluded.has(cardIndex.get(variants[byId.get(slot.pool[value.index].variantId)].cardId)));
  return filtered.length||product.duplicatePolicy.fallback!=='allow'?filtered:base;
 };
 const graph=state=>{if(graphs.has(state))return graphs.get(state);const slotBase=1,variantBase=slotBase+product.slots.length,sink=variantBase+variants.length,flow=new Flow(sink+1,stats,limits.edgeVisits),demands=product.slots.map(()=>0),slotEdges=[],ticketEdges=[],supplyEdges=[];for(let index=state.index;index<draws.length;index++)demands[draws[index].slotIndex]++;
  for(const [slotIndex,slot]of product.slots.entries()){slotEdges.push(flow.add(0,slotBase+slotIndex,demands[slotIndex]));ticketEdges.push(slot.pool.map((row,index)=>flow.add(slotBase+slotIndex,variantBase+byId.get(row.variantId),state.tickets[offsets[slotIndex]+index])));}
  for(const [index,value]of state.remaining.entries())supplyEdges.push(flow.add(variantBase+index,sink,value??draws.length-state.index));
  const witness={flow,demands,slotEdges,ticketEdges,supplyEdges,slotBase,variantBase,complete:flow.max(0,sink)===draws.length-state.index};graphs.set(state,witness);return witness;
 };
 const advance=(state,index)=>{if(single&&steps.has(state))return steps.get(state);if(++stats.transitions>limits.transitions)fail();const position=draws[state.index],slot=product.slots[position.slotIndex],id=byId.get(slot.pool[index].variantId),variant=variants[id],next={...state,index:state.index+1,tickets:[...state.tickets],remaining:[...state.remaining],codes:[...state.codes],owned:new Set(state.owned),excluded:new Set(state.excluded)};next.tickets[offsets[position.slotIndex]+index]--;if(next.remaining[id]!==null)next.remaining[id]--;for(const demand of variant.codeDemand??[])next.codes[poolIndex.get(demand.poolId)]-=demand.count;next.owned.add(cardIndex.get(variant.cardId));if(slot.role!=='insert'){next.excluded.add(cardIndex.get(variant.cardId));if(personal&&product.pity&&variant.rarityRank>=product.pity.minimumRank)next.qualified=true;}
  const normalized=normalize(next);if(fast&&normalized&&graphs.get(state)?.complete){const witness=graphs.get(state);graphs.delete(state);const edge=witness.ticketEdges[position.slotIndex][index];if(witness.flow.reverse(edge).capacity===0){const toward=witness.flow.toward(witness.slotBase+position.slotIndex);if(!toward.seen.has(witness.variantBase+id))return normalized;witness.flow.augment(edge);for(let node=witness.variantBase+id;node!==witness.slotBase+position.slotIndex;){const path=toward.path[node];witness.flow.augment(path);node=path.to;}}
   witness.flow.reverse(edge).capacity--;witness.flow.reverse(witness.slotEdges[position.slotIndex]).capacity--;witness.flow.reverse(witness.supplyEdges[id]).capacity--;witness.demands[position.slotIndex]--;graphs.set(normalized,witness);
  }if(single)steps.set(state,normalized);return normalized;
 };
 const key=state=>[state.index,state.pityCount,Number(state.qualified),state.tickets.join(','),state.remaining.join(','),state.codes.join(','),[...state.owned].sort((a,b)=>a-b).join(','),[...state.excluded].sort((a,b)=>a-b).join(',')].join('|');
 const feasible=state=>{if(!state)return false;if(state.index===draws.length)return true;if(fast)return graph(state).complete;
  if(single){let current=state;const visited=[];while(current&&current.index<draws.length&&!results.has(current)){if(++stats.states>limits.states)fail();stats.memoBytes+=Buffer.byteLength(key(current))+16;if(stats.memoBytes>limits.memoBytes)fail();visited.push(current);const candidate=choices(current)[0];if(!candidate){current=null;break;}current=advance(current,candidate.index);}const result=!!current&&(current.index===draws.length||results.get(current));for(const row of visited)results.set(row,result);return result;}
  const token=key(state);if(memo.has(token))return memo.get(token);if(++stats.states>limits.states)fail();let result=false;for(const candidate of choices(state))if(feasible(advance(state,candidate.index))){result=true;break;}stats.memoBytes+=Buffer.byteLength(token)+16;if(stats.memoBytes>limits.memoBytes)fail();memo.set(token,result);return result;};
 const safeChoices=state=>{const local=choices(state);if(!local.length)return [];if(!fast)return local.filter(candidate=>feasible(advance(state,candidate.index)));const witness=graph(state);if(!witness.complete)return [];const position=draws[state.index],slot=product.slots[position.slotIndex],toward=witness.flow.toward(witness.slotBase+position.slotIndex);return local.filter(candidate=>witness.flow.reverse(witness.ticketEdges[position.slotIndex][candidate.index]).capacity>0||toward.seen.has(witness.variantBase+byId.get(slot.pool[candidate.index].variantId)));};
 return {initial,draws,fast,stats,choices,advance,feasible,safeChoices};
}
