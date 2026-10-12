import {contentDigest} from './importer.js';
import {check} from './catalog.js';
import {PolicyProposalCoordinator} from './policy-proposals.js';
import {transferPolicyProtocol,validateTransferPolicyRequest} from './transfer-policy-contracts.js';
import {tradePolicyProtocol,validateTradePolicyRequest} from './trade-policy-contracts.js';

/** One bounded decision per hook covers all cards in a framework-owned command. */
export class TransferPolicyAdmission{
  #providers;#coordinators;#batches=new WeakMap();#states=new WeakMap();
  constructor({canTransfer,canTrade}){
    this.#providers={canTransfer,canTrade};this.#coordinators={
      canTransfer:canTransfer?new PolicyProposalCoordinator(canTransfer,{protocol:transferPolicyProtocol,operation:'canTransfer',scope:'transfer',validateRequest:validateTransferPolicyRequest}):null,
      canTrade:canTrade?new PolicyProposalCoordinator(canTrade,{protocol:tradePolicyProtocol,operation:'canTrade',scope:'exchange',validateRequest:validateTradePolicyRequest}):null,
    };
  }
  configured(hook){return !!this.#providers[hook];}
  prepare({contexts,...input}){
    const batch=Object.freeze(Object.entries(contexts).filter(([hook,context])=>context&&this.#coordinators[hook]).map(([hook,context])=>{
      const copies=hook==='canTransfer'?context.legs.reduce((n,leg)=>n+leg.copyIds.length,0):context.give.copyIds.length+context.receive.copyIds.length;
      check(copies<=2000,'POLICY_LIMIT','Policy batch exceeds 2000 cards',502);
      return Object.freeze({hook,proposal:this.#coordinators[hook].prepare({...input,context})});
    }));this.#batches.set(batch,{allowed:false,admitted:false});return batch;
  }
  async evaluate(batch,{signal}={}){
    check(this.#batches.has(batch),'POLICY_PROPOSAL','Policy batch is not owned by this framework',409);
    await Promise.all(batch.map(({hook,proposal})=>this.#coordinators[hook].evaluate(proposal,{signal})));this.#batches.get(batch).allowed=true;return batch;
  }
  admit(state,batch,snapshotDigest,{signal}={}){
    const row=this.#batches.get(batch);check(row?.allowed&&!row.admitted,'POLICY_PROPOSAL','Policy batch is invalid or already admitted',409);
    const admissions=batch.map(({hook,proposal})=>({operation:hook,...this.#coordinators[hook].admit(proposal,snapshotDigest,{signal})}));
    row.admitted=true;this.#states.set(state,batch);return admissions;
  }
  assertTransfer(state,copyId,fromUserId,toUserId,channel){
    if(!this.#providers.canTransfer)return;
    const entry=this.#states.get(state)?.find(row=>row.hook==='canTransfer');
    check(entry?.proposal.context.channel===channel&&entry.proposal.context.legs.some(leg=>leg.fromUserId===fromUserId&&leg.toUserId===toUserId&&leg.copyIds.includes(copyId)),'POLICY_ASYNC_REQUIRED','Remote transfer policy evaluation is required',503);
    this.#providers.canTransfer.assertGrant(entry.proposal);
  }
  assertTrade(state,context){
    if(!this.#providers.canTrade)return;
    const entry=this.#states.get(state)?.find(row=>row.hook==='canTrade'),expected=entry?.proposal.context;
    check(expected&&['channel','fromUserId','toUserId'].every(key=>expected[key]===context[key])&&contentDigest(expected.give)===contentDigest(context.give)&&contentDigest(expected.receive)===contentDigest(context.receive),'POLICY_ASYNC_REQUIRED','Remote trade policy evaluation is required',503);
    this.#providers.canTrade.assertGrant(entry.proposal);
  }
  clear(state){this.#states.delete(state);}
  review(batch,inputDigest,snapshotDigest,copyIds){
    return {status:'allowed',inputDigest,snapshotDigest,expiresAt:new Date(Math.min(Date.now()+15000,...batch.map(row=>row.proposal.deadline))).toISOString(),copyIds:[...new Set(copyIds)]};
  }
}
