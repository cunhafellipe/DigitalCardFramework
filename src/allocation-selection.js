import {randomUUID} from 'node:crypto';
import {check} from './catalog.js';
import {contentDigest} from './importer.js';

/** Only identities and allocation positions are retained here; factory inputs use encrypted custody. */
export function pinAllocationSelection(tx,attempt,plan,at){
 const previous=tx.get('allocationSelections',attempt.id);
 if(previous){check(contentDigest(previous.plan)===contentDigest(plan),'ALLOCATION_STALE','Pinned allocation differs',409);return previous;}
 const reservation=tx.get('codeIssuanceReservations',attempt.id),issued=reservation&&tx.get('codeIssuanceBatches',reservation.batchId);
 const selection=issued?.selection??{purchaseId:randomUUID(),packs:Array.from({length:attempt.context.quantity},()=>randomUUID()),copies:plan.flatMap(draw=>draw.variantIds.map((variantId,ordinal)=>({packIndex:draw.packIndex,slotId:draw.slotId,ordinal,variantId,copyId:randomUUID()}))),plan:structuredClone(plan)};
 if(attempt.factorySnapshot){selection.createdAt??=at;selection.listingId??=randomUUID();tx.put('allocationSelections',attempt.id,selection);}
 return selection;
}
