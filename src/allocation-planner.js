import {createHmac} from 'node:crypto';
import {check} from './catalog.js';

export const allocationAlgorithm='weighted-deck@1';
export function validateAllocationSelector(value){
  check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===3&&value.algorithm===allocationAlgorithm&&value.version===1&&value.deckScope==='purchase-slot','INVALID_CATALOG','Invalid allocation strategy selector');return value;
}
function draw(seed,label,maximum){
  const range=1n<<64n,bound=BigInt(maximum),limit=range-range%bound;
  for(let counter=0;counter<128;counter++){const value=createHmac('sha256',Buffer.from(seed,'hex')).update(label+'/'+counter).digest().readBigUInt64BE();if(value<limit)return Number(value%bound);}
  check(false,'ALLOCATION_ENTROPY','Allocation entropy could not be resolved',500);
}
/** Symbolic tickets preserve the reviewed batch distribution without expanding a deck. */
export function planAllocation(context){
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
