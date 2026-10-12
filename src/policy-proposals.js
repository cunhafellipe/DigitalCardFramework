import {randomUUID} from 'node:crypto';
import {check,FrameworkError} from './catalog.js';
import {contentDigest} from './importer.js';
import {purchasePolicyProtocol,validatePurchasePolicyRequest} from './purchase-policy-contracts.js';

const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};

/** Proposals stay inside the framework; a remote response carries advisory data only. */
export class PolicyProposalCoordinator{
  #provider;#proposals=new WeakMap();
  constructor(provider){this.#provider=provider;}
  prepare({phase,userId,key,input,snapshotDigest,context}){
    const grant=this.#provider.grant(),inputDigest=contentDigest(input);
    const proposal=freeze(validatePurchasePolicyRequest({protocol:purchasePolicyProtocol,operation:'canPurchase',scope:'listing',phase,requestId:randomUUID(),...grant,commandId:contentDigest({userId,operation:'canPurchase',phase,key:key??null,inputDigest}),inputDigest,snapshotDigest,deadline:Date.now()+this.#provider.timeoutMs,context:structuredClone(context)}));
    this.#proposals.set(proposal,{allowed:false,admitted:false});return proposal;
  }
  async evaluate(proposal,{signal}={}){
    check(this.#proposals.has(proposal),'POLICY_PROPOSAL','Purchase policy proposal is not owned by this framework',409);
    const response=await this.#provider.evaluate(proposal,{signal});
    if(response.status==='denied')throw new FrameworkError('POLICY_DENIED','Purchase policy rejected this account',403);
    this.#proposals.get(proposal).allowed=true;return proposal;
  }
  admit(proposal,snapshotDigest,{signal}={}){
    const row=this.#proposals.get(proposal);
    check(row?.allowed&&!row.admitted,'POLICY_PROPOSAL','Purchase policy proposal is invalid or already admitted',409);
    check(!signal?.aborted,'POLICY_ABORTED','Purchase policy evaluation was cancelled',503);
    this.#provider.assertGrant(proposal);
    check(Date.now()<proposal.deadline,'POLICY_TIMEOUT','Purchase policy proposal expired; retry later',504);
    check(proposal.snapshotDigest===snapshotDigest,'POLICY_STALE','Purchase state changed during policy evaluation; review again',409);
    row.admitted=true;
    return {providerId:proposal.providerId,grantId:proposal.grantId,generation:proposal.generation,commandId:proposal.commandId,inputDigest:proposal.inputDigest,snapshotDigest:proposal.snapshotDigest,requestId:proposal.requestId};
  }
}
