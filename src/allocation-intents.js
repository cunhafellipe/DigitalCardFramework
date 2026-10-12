import {randomBytes,randomUUID} from 'node:crypto';
import {check} from './catalog.js';
import {contentDigest} from './importer.js';
import {allocationStrategyProtocol,validateAllocationStrategyRequest,validateAllocationStrategyV2Request,validateAllocationStrategyV3Request} from './allocation-strategy-contracts.js';
import {planAllocation} from './allocation-planner.js';
import {validRecordAccounting,recordAccountingField} from './record-accounting.js';

/** Private durable preparation records never expose entropy or uncommitted outcomes. */
export class AllocationIntentService{
  #store;#provider;#prepare;#commit;#clock;#reference;#abandon;#active;#command;#protocol;#scope;#validate;#before;#transaction;#beforePlan;#validateV2;#validateV3;
  constructor({store,provider,prepare,commit,clock,reference,abandon,active=new Map(),command='purchase',protocol=allocationStrategyProtocol,scope='catalog-purchase',validate=validateAllocationStrategyRequest,validateV2=validateAllocationStrategyV2Request,validateV3=validateAllocationStrategyV3Request,beforeEvaluate,beforePlan,transaction={allocationPurchase:true}}){this.#store=store;this.#provider=provider;this.#prepare=prepare;this.#commit=commit;this.#clock=clock;this.#reference=reference;this.#abandon=abandon;this.#active=active;this.#command=command;this.#protocol=protocol;this.#scope=scope;this.#validate=validate;this.#validateV2=validateV2;this.#validateV3=validateV3;this.#before=beforeEvaluate;this.#beforePlan=beforePlan;this.#transaction=transaction;}
  #user(tx,actor){check(actor?.disabled!==true&&typeof actor?.userId==='string'&&tx.get('users',actor.userId),'UNAUTHENTICATED','A verified account is required',401);}
  #records(fn,options={allocationJournal:true}){const run=()=>this.#store.transactRecords(tx=>{let accounting;try{accounting=JSON.parse(tx.value(recordAccountingField));}catch{}check(validRecordAccounting(accounting,tx.value('revision')),'RECORD_MIGRATION_REQUIRED','Prepare revision-bound allocation accounting',503);return fn(tx);},options);try{return run();}catch(error){if(error.code!=='RECORD_MIGRATION_REQUIRED')throw error;this.#store.prepareRecordTransactions();return run();}}
  #head(userId,productId){return contentDigest({userId,productId,algorithm:'weighted-deck@1'});}
  status(actor,{productId}){return this.#store.query(tx=>{this.#user(tx,actor);check(typeof productId==='string'&&productId.length<=100,'INVALID_INPUT','Product ID required');const head=tx.get('allocationHeads',this.#head(actor.userId,productId)),row=head?.lastAttemptId?tx.get('allocationAttempts',head.lastAttemptId):null;return {productId,attemptId:row?.id??null,state:row?.state??'idle',errorCode:row?.errorCode??null};});}
  acknowledge(actor,{attemptId}){return this.#records(tx=>{this.#user(tx,actor);const row=tx.get('allocationAttempts',attemptId);check(row?.userId===actor.userId,'NOT_FOUND','Allocation attempt not found',404);check(!this.#active.has(attemptId),'ALLOCATION_BUSY','Allocation evaluation is still active',409);if(row.state==='acknowledged')return {attemptId,state:'acknowledged'};check(['prepared','stale'].includes(row.state),'ALLOCATION_COMPLETED','Completed allocation cannot be abandoned',409);this.#abandon?.(tx,actor,row);row.state='acknowledged';row.acknowledgedAt=this.#clock();tx.put('allocationAttempts',row.id,row);const head=tx.get('allocationHeads',row.headId);if(head.attemptId===row.id){head.attemptId=null;tx.put('allocationHeads',row.headId,head);}return {attemptId,state:'acknowledged'};});}
  async purchase(actor,key,input,{signal}={}){
    check(signal===undefined||signal instanceof AbortSignal,'INVALID_ALLOCATION_REQUEST','Allocation cancellation requires an AbortSignal');check(!signal?.aborted,'POLICY_ABORTED','Allocation evaluation was cancelled',503);
    const principal=structuredClone(actor),clean=structuredClone(input),inputDigest=contentDigest(clean),receiptHash=contentDigest({type:this.#command==='purchase'?'packs.purchased':'listing.created',input:clean}),productId=this.#command==='purchase'?clean.productId:clean.items.productId;
    const claimed=this.#records(tx=>{
      this.#user(tx,principal);const previous=tx.get('requests',principal.userId+':'+key);if(previous){check(previous.hash===receiptHash,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409);return {result:previous.result};}
      const keyId=contentDigest({userId:principal.userId,key}),fence=tx.get('allocationKeys',keyId);if(fence){const prior=tx.get('allocationAttempts',fence.attemptId);check(prior?.inputDigest===inputDigest&&(prior.command??'purchase')===this.#command,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409);check(prior.state!=='acknowledged','ALLOCATION_ACKNOWLEDGED','Allocation attempt was abandoned; review a new purchase',409);}
      const headId=this.#head(principal.userId,productId),head=tx.get('allocationHeads',headId)??{userId:principal.userId,productId,cursor:0,seed:null,attemptId:null,lastAttemptId:null};
      if(head.attemptId){const row=tx.get('allocationAttempts',head.attemptId);check(row.key===key&&row.inputDigest===inputDigest&&(row.command??'purchase')===this.#command,'ALLOCATION_PENDING','Recover or acknowledge the existing allocation attempt',409);check(row.state==='prepared','ALLOCATION_STALE','Allocation state changed; acknowledge and review again',409);return {row};}
      const prepared=this.#prepare(tx,principal,clean);check(this.#provider.supportsAlgorithm(prepared.context.product.strategy.algorithm),'ALLOCATION_UNAVAILABLE','Configured allocation provider cannot evaluate this version',503);
      check(tx.count('allocationAttempts')<100000,'ALLOCATION_CAPACITY','Allocation journal capacity reached',507);
      const grant=this.#provider.grant();head.seed??=randomBytes(32).toString('hex');const id=randomUUID(),context={...prepared.context,entropy:{seed:head.seed,cursor:head.cursor}};
      const row={id,headId,userId:principal.userId,productId,key,input:clean,inputDigest,...(this.#command==='purchase'?{}:{command:this.#command,preparation:prepared.preparation}),intentReference:this.#reference?.(tx,principal,key,inputDigest)??null,receiptHash,snapshotDigest:prepared.snapshotDigest,context,...(prepared.codeSnapshot?{codeSnapshot:prepared.codeSnapshot}:{}),entropyCursor:head.cursor,state:'prepared',errorCode:null,createdAt:this.#clock()};
      this.#request(row,grant);check(Buffer.byteLength(JSON.stringify(row))<=1048576,'ALLOCATION_LIMIT','Allocation preparation exceeds the journal byte limit',502);
      tx.put('allocationAttempts',id,row);tx.put('allocationKeys',keyId,{userId:principal.userId,attemptId:id});head.attemptId=id;head.lastAttemptId=id;tx.put('allocationHeads',headId,head);return {row};
    });
    if(Object.hasOwn(claimed,'result'))return claimed.result;
    const {row}=claimed;if(this.#active.has(row.id))return this.#active.get(row.id).promise;
    const controller=new AbortController(),combined=signal===undefined?controller.signal:AbortSignal.any([signal,controller.signal]);
    const promise=this.#evaluate(principal,row,combined).finally(()=>this.#active.delete(row.id));this.#active.set(row.id,{controller,promise});return promise;
  }
  #request(row,grant){const version=row.context.product.strategy.version;const lifetime=row.codeSnapshot?.validUntil?Date.parse(row.codeSnapshot.validUntil)-Date.parse(this.#clock()):Infinity;check(lifetime>0,'ALLOCATION_STALE','Imported code allocation changed',409);check(this.#provider.supportsAlgorithm(row.context.product.strategy.algorithm),'ALLOCATION_UNAVAILABLE','Configured allocation provider cannot evaluate this version',503);return (version===3?this.#validateV3:version===2?this.#validateV2:this.#validate)({protocol:this.#protocol.replace(/@1$/, '@'+version),operation:'allocatePacks',scope:this.#scope,phase:'allocate',requestId:randomUUID(),attemptId:row.id,...grant,commandId:contentDigest({userId:row.userId,productId:row.productId,entropyCursor:row.entropyCursor,inputDigest:row.inputDigest}),inputDigest:row.inputDigest,snapshotDigest:row.snapshotDigest,deadline:Date.now()+Math.min(this.#provider.timeoutMs,lifetime),context:row.context});}
  async #evaluate(actor,row,signal){
    try{
      let auxiliary=await this.#before?.(actor,row,signal);const request=this.#request(row,this.#provider.grant()),response=await this.#provider.evaluate(request,{signal});
      return this.#records(tx=>{
        this.#user(tx,actor);const previous=tx.get('requests',actor.userId+':'+row.key);if(previous){check(previous.hash===row.receiptHash,'IDEMPOTENCY_CONFLICT','Request key was used for another command',409);return previous.result;}
        const current=tx.get('allocationAttempts',row.id),head=tx.get('allocationHeads',row.headId);check(current?.state==='prepared'&&head?.attemptId===row.id,'ALLOCATION_STALE','Allocation state changed; review again',409);
        // Every scoped revision is checked before any selected outcome is inspected.
        const prepared=this.#prepare(tx,actor,row.input,row);check(prepared.snapshotDigest===row.snapshotDigest,'ALLOCATION_STALE','Allocation state changed; review again',409);
        check(!signal.aborted,'POLICY_ABORTED','Allocation evaluation was cancelled',503);this.#provider.assertGrant(request);check(Date.now()<request.deadline,'POLICY_TIMEOUT','Allocation proposal expired',504);
        if(this.#beforePlan)auxiliary=this.#beforePlan(row,auxiliary,signal);
        const expected=planAllocation(row.context);check(contentDigest(response.allocations)===contentDigest(expected),'INVALID_ALLOCATION_RESPONSE','Allocation plan does not match reviewed distribution',502);
        const codeAssignments=[],result=this.#commit(tx,actor,row,expected,{auxiliary,signal,codeAssignments});if(row.codeSnapshot)current.codeAssignments=codeAssignments;current.state='completed';current.plan=expected;current.result=structuredClone(result);current.completedAt=this.#clock();current.admission={providerId:request.providerId,grantId:request.grantId,generation:request.generation,requestId:request.requestId,commandId:request.commandId};check(Buffer.byteLength(JSON.stringify(current))<=1048576,'ALLOCATION_LIMIT','Allocation result exceeds its journal byte limit',502);tx.put('allocationAttempts',row.id,current);
        head.cursor++;head.seed=null;head.attemptId=null;tx.put('allocationHeads',row.headId,head);return result;
      },this.#transaction);
    }catch(error){if(error.code==='ALLOCATION_STALE')this.#records(tx=>{const current=tx.get('allocationAttempts',row.id);if(current?.state==='prepared'){current.state='stale';current.errorCode='ALLOCATION_STALE';tx.put('allocationAttempts',row.id,current);}return null;});throw error;}
  }
  close(){for(const {controller}of this.#active.values())controller.abort();this.#provider?.close();}
}
