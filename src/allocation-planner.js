import {createHmac} from 'node:crypto';
import {check} from './catalog.js';
import {createAllocationFeasibilitySolver,validateAllocationSolverAdmission} from './allocation-feasibility.js';

export const allocationAlgorithm='weighted-deck@1';
export const allocationAlgorithmV2='weighted-deck@2';
export const allocationAlgorithmV3='weighted-deck@3';
export const allocationAlgorithmV4='weighted-deck@4';
export function validateAllocationSelector(value){
  check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===3&&((value.algorithm===allocationAlgorithm&&value.version===1)||(value.algorithm===allocationAlgorithmV2&&value.version===2)||(value.algorithm===allocationAlgorithmV3&&value.version===3)||(value.algorithm===allocationAlgorithmV4&&value.version===4))&&value.deckScope==='purchase-slot','INVALID_CATALOG','Invalid allocation strategy selector');return value;
}
function draw(seed,label,maximum){
  const range=1n<<64n,bound=BigInt(maximum),limit=range-range%bound;
  for(let counter=0;counter<128;counter++){const value=createHmac('sha256',Buffer.from(seed,'hex')).update(label+'/'+counter).digest().readBigUInt64BE();if(value<limit)return Number(value%bound);}
  check(false,'ALLOCATION_ENTROPY','Allocation entropy could not be resolved',500);
}
/** Symbolic tickets preserve the reviewed batch distribution without expanding a deck. */
export function planAllocation(context){
  validateAllocationSelector(context.product.strategy);
  if(context.product.strategy.version>=2)return allocationOutcome(context).allocations;
  const {product,quantity,variants,entropy}=context,remaining=new Map(variants.map(v=>[v.id,v.remaining])),tickets=product.slots.map(slot=>slot.pool.map(entry=>entry.weight)),allocations=[];
  for(let packIndex=0;packIndex<quantity;packIndex++)for(const [slotIndex,slot]of product.slots.entries()){
    const label=[allocationAlgorithm,entropy.cursor,product.id,slot.id,packIndex].join('/'),probability=slot.probability;
    const present=draw(entropy.seed,label+'/presence',probability.denominator)<probability.numerator,variantIds=[];
    if(present)for(let ordinal=0;ordinal<slot.count;ordinal++){
      const weights=slot.pool.map((entry,index)=>remaining.get(entry.variantId)===0?0:tickets[slotIndex][index]),total=weights.reduce((n,w)=>n+w,0);
      check(total>0,'ALLOCATION_UNAVAILABLE','Allocation cannot satisfy reviewed terms',409);
      let roll=draw(entropy.seed,label+'/choice/'+ordinal,total),selected=-1;for(const [index,weight]of weights.entries()){roll-=weight;if(roll<0){selected=index;break;}}
      const variantId=slot.pool[selected].variantId;tickets[slotIndex][selected]--;if(remaining.get(variantId)!==null)remaining.set(variantId,remaining.get(variantId)-1);variantIds.push(variantId);
    }
    allocations.push({packIndex,slotId:slot.id,variantIds});
  }
  return allocations;
}

/** Eligibility is evaluated before each symbolic ticket draw. Outcomes never update caller-owned state. */
export function allocationOutcome(context){
  validateAllocationSelector(context.product.strategy);
  if(context.product.strategy.version===4)return allocationOutcomeV4(context);
  if(context.product.strategy.algorithm===allocationAlgorithm)return {allocations:planAllocation(context),pityCount:null};
  check(context.product.strategy.version>=2,'ALLOCATION_UNSUPPORTED','Unsupported allocation algorithm',409);
  const {product,quantity,variants,entropy,mode}=context,personalized=mode==='personalized',byId=new Map(variants.map(v=>[v.id,v])),remaining=new Map(variants.map(v=>[v.id,v.remaining])),tickets=product.slots.map(s=>s.pool.map(e=>e.weight)),owned=new Set(context.ownedCards.filter(c=>c.owned).map(c=>c.cardId)),allocations=[];
  const codeRemaining=new Map((context.codePools??[]).map(p=>[p.id,p.available]));let pityCount=context.pityCount;const firstCard=product.slots.findIndex(s=>s.role==='card');
  for(let packIndex=0;packIndex<quantity;packIndex++){
    const excluded=new Set(personalized&&product.duplicatePolicy.scope==='inventory'?owned:[]),due=personalized&&product.pity&&pityCount>=product.pity.after-1;let qualified=false;
    for(const [slotIndex,slot]of product.slots.entries()){
      const label=[product.strategy.algorithm,entropy.cursor,product.id,slot.id,packIndex].join('/'),variantIds=[];
      if(draw(entropy.seed,label+'/presence',slot.probability.denominator)<slot.probability.numerator)for(let ordinal=0;ordinal<slot.count;ordinal++){
        const base=slot.pool.map((e,index)=>remaining.get(e.variantId)===0||(byId.get(e.variantId).codeDemand??[]).some(d=>(codeRemaining.get(d.poolId)??0)<d.count)||due&&slotIndex===firstCard&&ordinal===0&&byId.get(e.variantId).rarityRank<product.pity.minimumRank?0:tickets[slotIndex][index]);
        let weights=base.map((weight,index)=>slot.role!=='insert'&&product.duplicatePolicy.scope!=='none'&&excluded.has(byId.get(slot.pool[index].variantId).cardId)?0:weight);
        if(!weights.some(w=>w>0)&&product.duplicatePolicy.fallback==='allow')weights=base;
        const total=weights.reduce((n,w)=>n+w,0);check(total>0,'ALLOCATION_UNAVAILABLE','Allocation cannot satisfy reviewed terms',409);
        let roll=draw(entropy.seed,label+'/choice/'+ordinal,total),selected=-1;for(const [index,weight]of weights.entries()){roll-=weight;if(roll<0){selected=index;break;}}
        const variantId=slot.pool[selected].variantId,variant=byId.get(variantId);tickets[slotIndex][selected]--;if(remaining.get(variantId)!==null)remaining.set(variantId,remaining.get(variantId)-1);variantIds.push(variantId);owned.add(variant.cardId);for(const demand of variant.codeDemand??[])codeRemaining.set(demand.poolId,codeRemaining.get(demand.poolId)-demand.count);
        if(slot.role!=='insert'){excluded.add(variant.cardId);if(personalized&&product.pity&&variant.rarityRank>=product.pity.minimumRank)qualified=true;}
      }
      allocations.push({packIndex,slotId:slot.id,variantIds});
    }
    if(personalized&&product.pity){pityCount=qualified?0:pityCount+1;check(Number.isSafeInteger(pityCount),'ALLOCATION_UNAVAILABLE','Allocation cannot satisfy reviewed terms',409);}
  }
  return {allocations,pityCount};
}

/** Draw among current tickets whose consumption preserves an exact legal suffix. */
function allocationOutcomeV4(context){
  validateAllocationSolverAdmission(context);
  const {product,quantity,entropy}=context,presence=[],allocations=[];
  for(let packIndex=0;packIndex<quantity;packIndex++)for(const slot of product.slots){const label=[allocationAlgorithmV4,entropy.cursor,product.id,slot.id,packIndex].join('/');presence.push(draw(entropy.seed,label+'/presence',slot.probability.denominator)<slot.probability.numerator);allocations.push({packIndex,slotId:slot.id,variantIds:[]});}
  const solver=createAllocationFeasibilitySolver(context,presence);let state=solver.initial;
  check(solver.feasible(state),'ALLOCATION_INFEASIBLE','Reviewed allocation layout has no legal completion',409);
  for(const position of solver.draws){const slot=product.slots[position.slotIndex],weights=solver.safeChoices(state),total=weights.reduce((n,row)=>n+row.weight,0);check(total>0,'ALLOCATION_INFEASIBLE','Reviewed allocation layout has no legal completion',409);
    const label=[allocationAlgorithmV4,entropy.cursor,product.id,slot.id,position.packIndex].join('/');let roll=draw(entropy.seed,label+'/choice/'+position.ordinal,total),selected;
    for(const candidate of weights){roll-=candidate.weight;if(roll<0){selected=candidate.index;break;}}
    allocations[position.packIndex*product.slots.length+position.slotIndex].variantIds.push(slot.pool[selected].variantId);state=solver.advance(state,selected);
  }
  return {allocations,pityCount:state.pityCount};
}

/** Bound the complete shared resource snapshot before a command is admitted. */
export function allocationCodeDemand(product,variants,quantity){
  const byId=new Map(variants.map(v=>[v.id,v])),demand=new Map();for(const v of variants)for(const d of v.codeDemand??[])demand.set(d.poolId,0);
  for(const slot of product.slots){if(slot.probability?.numerator===0)continue;for(const poolId of demand.keys()){const maximum=Math.max(0,...slot.pool.map(e=>(byId.get(e.variantId)?.codeDemand??[]).find(d=>d.poolId===poolId)?.count??0));demand.set(poolId,demand.get(poolId)+maximum*slot.count*quantity);}}
  check(demand.size<=64&&[...demand.values()].reduce((n,count)=>n+count,0)<=1000,'ALLOCATION_LIMIT','Imported code allocation exceeds its bounded resource scope',502);return demand;
}
