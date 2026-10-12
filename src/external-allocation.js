import {randomBytes,randomUUID} from 'node:crypto';
import {check} from './catalog.js';
import {contentDigest} from './importer.js';
import {planAllocation} from './allocation-planner.js';
import {externalAllocationStrategyProtocol,validateExternalAllocationStrategyRequest,externalAllocationStrategyV2Protocol,validateExternalAllocationStrategyV2Request,externalAllocationStrategyV3Protocol,validateExternalAllocationStrategyV3Request} from './external-allocation-strategy-contracts.js';

/** Payment evidence stays in settlement records; only immutable allocation inputs cross the transport. */
export class ExternalAllocationCoordinator{
  #provider;#active;#clock;
  constructor({provider,active,clock}){this.#provider=provider;this.#active=active;this.#clock=clock;}
  claim(s,row){
    check(this.#provider.supportsAlgorithm(row.snapshot.allocation.context.product.strategy.algorithm),'ALLOCATION_UNAVAILABLE','Configured allocation provider cannot evaluate this version',503);this.#provider.grant();s.allocationAttempts??={};s.allocationHeads??={};s.allocationKeys??={};
    const userId=row.terms.userId,productId=row.terms.quote.productId,headId=contentDigest({userId,productId,algorithm:'weighted-deck@1'}),head=s.allocationHeads[headId]??{userId,productId,cursor:0,seed:null,attemptId:null,lastAttemptId:null};
    check(!head.attemptId,'ALLOCATION_PENDING','Recover the existing allocation attempt before charging',409);check(Object.keys(s.allocationAttempts).length<100000,'ALLOCATION_CAPACITY','Allocation journal capacity reached',507);
    const id=randomUUID(),key='external:'+row.preparationId,keyId=contentDigest({userId,key});check(!s.allocationKeys[keyId],'ALLOCATION_ACKNOWLEDGED','External allocation identity is already retained',409);head.seed??=randomBytes(32).toString('hex');
    const attempt={id,headId,userId,productId,key,command:'commitExternalPurchase',preparationId:row.preparationId,inputDigest:row.fingerprint,snapshotDigest:row.snapshot.allocation.snapshotDigest,context:{...row.snapshot.allocation.context,preparationId:row.preparationId,entropy:{seed:head.seed,cursor:head.cursor}},...(row.snapshot.allocation.codeSnapshot?{codeSnapshot:row.snapshot.allocation.codeSnapshot}:{}),entropyCursor:head.cursor,state:'prepared',errorCode:null,createdAt:this.#clock()};
    this.#request(attempt);check(Buffer.byteLength(JSON.stringify(attempt))<=1048576,'ALLOCATION_LIMIT','External allocation journal exceeds its byte limit',502);
    delete row.snapshot.allocation.codeSnapshot;s.allocationAttempts[id]=attempt;s.allocationKeys[keyId]={userId,attemptId:id};head.attemptId=id;head.lastAttemptId=id;s.allocationHeads[headId]=head;row.allocationAttemptId=id;
  }
  #request(attempt){const version=attempt.context.product.strategy.version,lifetime=attempt.codeSnapshot?.validUntil?Date.parse(attempt.codeSnapshot.validUntil)-Date.parse(this.#clock()):Infinity;check(lifetime>0,'ALLOCATION_STALE','Imported code allocation changed',409);check(this.#provider.supportsAlgorithm(attempt.context.product.strategy.algorithm),'ALLOCATION_UNAVAILABLE','Configured allocation provider cannot evaluate this version',503);return (version===3?validateExternalAllocationStrategyV3Request:version===2?validateExternalAllocationStrategyV2Request:validateExternalAllocationStrategyRequest)({protocol:version===3?externalAllocationStrategyV3Protocol:version===2?externalAllocationStrategyV2Protocol:externalAllocationStrategyProtocol,operation:'allocatePacks',scope:'external-fulfillment',phase:'allocate',requestId:randomUUID(),attemptId:attempt.id,...this.#provider.grant(),commandId:contentDigest({userId:attempt.userId,preparationId:attempt.preparationId,entropyCursor:attempt.entropyCursor,inputDigest:attempt.inputDigest}),inputDigest:attempt.inputDigest,snapshotDigest:attempt.snapshotDigest,deadline:Date.now()+Math.min(this.#provider.timeoutMs,lifetime),context:attempt.context});}
  run(attempt,signal,evaluate){
    const old=this.#active.get(attempt.id);if(old)return old.promise;const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    const promise=Promise.resolve().then(()=>evaluate(combined)).finally(()=>this.#active.delete(attempt.id));this.#active.set(attempt.id,{controller,promise});return promise;
  }
  async evaluate(attempt,signal){const request=this.#request(attempt),response=await this.#provider.evaluate(request,{signal});return {request,response,signal};}
  assert(s,row,evaluation,snapshotDigest){
    const attempt=s.allocationAttempts[row.allocationAttemptId],head=s.allocationHeads[attempt?.headId];check(attempt?.state==='prepared'&&head?.attemptId===attempt.id,'ALLOCATION_STALE','External allocation state changed',409);
    check(snapshotDigest===attempt.snapshotDigest,'ALLOCATION_STALE','External allocation state changed',409);check(!evaluation.signal.aborted,'POLICY_ABORTED','External allocation was cancelled',503);this.#provider.assertGrant(evaluation.request);check(Date.now()<evaluation.request.deadline,'POLICY_TIMEOUT','External allocation expired',504);
    const plan=planAllocation(attempt.context);check(contentDigest(plan)===contentDigest(evaluation.response.allocations),'INVALID_ALLOCATION_RESPONSE','External allocation differs from captured distribution',502);return plan;
  }
  complete(s,row,plan,evaluation){const attempt=s.allocationAttempts[row.allocationAttemptId],head=s.allocationHeads[attempt.headId];attempt.state='completed';attempt.plan=plan;attempt.result=structuredClone(row.purchase);attempt.completedAt=this.#clock();attempt.admission={providerId:evaluation.request.providerId,grantId:evaluation.request.grantId,generation:evaluation.request.generation,requestId:evaluation.request.requestId};check(Buffer.byteLength(JSON.stringify(attempt))<=1048576,'ALLOCATION_LIMIT','External allocation result exceeds its journal byte limit',502);head.cursor++;head.seed=null;head.attemptId=null;}
  release(s,row){const attempt=s.allocationAttempts?.[row.allocationAttemptId];if(!attempt)return;check(attempt.state==='prepared'||attempt.state==='acknowledged','EXTERNAL_PURCHASE_STATE','Delivered external allocation cannot be abandoned',409);if(attempt.state==='prepared'){attempt.state='acknowledged';attempt.acknowledgedAt=this.#clock();}const head=s.allocationHeads[attempt.headId];if(head?.attemptId===attempt.id)head.attemptId=null;}
  close(){for(const active of this.#active.values())active.controller.abort();this.#provider.close();}
}
