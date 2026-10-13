import test from 'node:test';
import assert from 'node:assert/strict';
import {auditState} from '../src/audit.js';
import {MemoryStore} from '../src/store.js';
import {fixture} from './helpers.js';

const attempt='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',batch='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',invocation='cccccccc-cccc-4ccc-8ccc-cccccccccccc',jobId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',futureCopy='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',namespace='example.reward';
const opaque=()=>({version:1,keyId:'fixture',data:'SYNTHETIC-PRIVATE-CUSTODY'});
function state(phase='preselection'){
  const store=new MemoryStore(),x=fixture({store}),committed=['attached','activation_pending','active','activation_failed'].includes(phase),copy=committed?x.open('rare')[0]:null,s=store.read(value=>value);x.core.close();
  const released=['attached','active','cancelled','activation_failed'].includes(phase),withRow=!['preselection','cancelled-empty','attached-empty'].includes(phase),copyId=copy?.id??futureCopy;
  s.allocationAttempts={...(s.allocationAttempts??{}),[attempt]:{id:attempt,userId:x.alice.userId,state:committed?'completed':'prepared',factorySnapshot:{maximum:1,activationMaximum:1}}};
  s.bindingFactoryReservations={[attempt]:{attemptId:attempt,batchId:batch,count:1,bytes:4096,state:released?'released':'reserved',userCustody:opaque()}};
  s.bindingFactoryQuota={global:{reserved:released?0:1}};
  s.completionObligations={...s.completionObligations,['binding-factory:'+batch]:{id:'binding-factory:'+batch,kind:'binding-factory',entityId:batch,status:released?'completed':'reserved',bytes:4096,usedBytes:256,events:1,jobs:1,subscriptions:[]}};
  s.bindingFactoryBatches=phase==='preselection'?{}:{[batch]:{id:batch,attemptId:attempt,userId:x.alice.userId,state:phase,entries:withRow?[invocation]:[],errorCode:null}};
  s.bindingFactoryInvocations={};s.bindingFactoryCopies={};
  if(withRow){
    const dispatched=['effect_pending','ready','attached','active'].includes(phase),ready=['ready','attached','active'].includes(phase),activation=['activation_pending','active','activation_failed'].includes(phase);
    s.bindingFactoryInvocations[invocation]={invocationId:invocation,attemptId:attempt,copyId,userId:x.alice.userId,namespace,factoryName:'example.reward',factoryRevision:1,kind:activation?'activation':'provision',packIndex:0,slotId:'main',slotOrdinal:0,state:phase==='pending'||['cancel_pending','quarantined'].includes(phase)?'prepared':phase,inputDigest:dispatched?'f'.repeat(64):null,inputCustody:dispatched?opaque():null,resultCustody:ready?opaque():null,jobId:activation?jobId:null};
    s.bindingFactoryCopies[copyId]={copyId,attemptId:attempt,custody:opaque()};
    if(committed){
      s.copies[copyId].bindings[namespace]={visibility:'owner',transfer:'retain',holderId:x.alice.userId,state:phase==='activation_pending'?'activation-pending':phase==='activation_failed'?'activation-failed':'active',...(phase==='activation_pending'?{activationId:invocation}:phase==='activation_failed'?{}:{data:{value:'SYNTHETIC-PRIVATE-RESULT'}})};
      if(activation)s.actionJobs={...s.actionJobs,[jobId]:{id:jobId,handler:'framework.binding.activation',params:{batchId:batch,invocationId:invocation},userId:x.alice.userId,source:{type:'binding.activation',invocationId:invocation,copyId,namespace},status:phase==='active'?'succeeded':phase==='activation_failed'?'dead':'pending',attempts:1,completionId:'binding-factory:'+batch,completedAt:phase==='activation_pending'?null:'2026-10-12T00:00:00.000Z'}};
    }
  }
  return s;
}
function ok(s){const result=auditState(s);assert.equal(result.ok,true,JSON.stringify(result.issues));}
function fails(s,code){const before=structuredClone(s),result=auditState(s);assert(result.issues.some(issue=>issue.code===code),JSON.stringify(result.issues));assert.deepEqual(s,before);for(const sentinel of ['SYNTHETIC-PRIVATE-CUSTODY','SYNTHETIC-PRIVATE-RESULT'])assert(!JSON.stringify(result).includes(sentinel));}

test('factory audit accepts preselection, preparation, cleanup and retained pending activation',()=>{
  for(const phase of ['preselection','pending','ready','cancel_pending','quarantined','activation_pending'])ok(state(phase));
  const exhausted=state('activation_pending');exhausted.actionJobs[jobId].status='dead';exhausted.actionJobs[jobId].attempts=100;ok(exhausted);
  const deferred=state('pending');deferred.bindingFactoryInvocations[invocation].state='deferred';deferred.bindingFactoryInvocations[invocation].kind='activation';ok(deferred);
});

test('factory audit accepts terminal release, used bindings and undispatched failed dependencies',()=>{
  for(const phase of ['attached','active','cancelled','activation_failed'])ok(state(phase));
  const used=state('active');used.copies[used.bindingFactoryInvocations[invocation].copyId].bindings[namespace].state='used';ok(used);
  const failed=state('activation_failed');failed.bindingFactoryInvocations[invocation].kind='pure';ok(failed);
  for(const phase of ['attached','cancelled']){const empty=state(phase);empty.bindingFactoryBatches[batch].entries=[];empty.bindingFactoryInvocations={};empty.bindingFactoryCopies={};ok(empty);}
});

test('factory audit detects reservation, attempt, quota and terminal accounting corruption',()=>{
  for(const corrupt of [s=>s.bindingFactoryReservations[attempt].count=-1,s=>delete s.bindingFactoryReservations[attempt].userCustody,s=>s.bindingFactoryReservations[attempt].attemptId='other']){const s=state();corrupt(s);fails(s,'BINDING_FACTORY_RESERVATION_INVALID');}
  const missing=state();delete missing.allocationAttempts[attempt];fails(missing,'BINDING_FACTORY_ATTEMPT_INVALID');
  const count=state();count.allocationAttempts[attempt].factorySnapshot.maximum=2;fails(count,'BINDING_FACTORY_ATTEMPT_INVALID');
  const quota=state();quota.bindingFactoryQuota.global.reserved=0;fails(quota,'BINDING_FACTORY_QUOTA_INVALID');
  for(const corrupt of [s=>s.completionObligations['binding-factory:'+batch].status='completed',s=>s.completionObligations['binding-factory:'+batch].usedBytes=4097,s=>s.completionObligations['binding-factory:'+batch].bytes=4095]){const s=state();corrupt(s);fails(s,'BINDING_FACTORY_OBLIGATION_INVALID');}
  const early=state('activation_pending');early.bindingFactoryReservations[attempt].state='released';fails(early,'BINDING_FACTORY_RELEASE_INVALID');
  const terminal=state('active');terminal.bindingFactoryReservations[attempt].state='reserved';fails(terminal,'BINDING_FACTORY_RELEASE_INVALID');
});

test('factory audit detects batch membership, identity, custody and terminal-state corruption',()=>{
  const duplicate=state('pending');duplicate.bindingFactoryBatches[batch].entries.push(invocation);fails(duplicate,'BINDING_FACTORY_BATCH_INVALID');
  const missing=state('pending');delete missing.bindingFactoryInvocations[invocation];fails(missing,'BINDING_FACTORY_BATCH_ENTRY_INVALID');
  const identity=state('pending');identity.bindingFactoryInvocations[invocation].attemptId='other';fails(identity,'BINDING_FACTORY_INVOCATION_INVALID');
  const custody=state('ready');delete custody.bindingFactoryInvocations[invocation].resultCustody;fails(custody,'BINDING_FACTORY_CUSTODY_MISSING');
  const input=state('ready');delete input.bindingFactoryInvocations[invocation].inputCustody;fails(input,'BINDING_FACTORY_CUSTODY_MISSING');
  const terminal=state('attached');terminal.bindingFactoryInvocations[invocation].state='effect_pending';fails(terminal,'BINDING_FACTORY_BATCH_STATE_INVALID');
});

test('factory audit validates pending copy and authenticated delivery relationships',()=>{
  for(const corrupt of [s=>delete s.copies[s.bindingFactoryInvocations[invocation].copyId].bindings[namespace],s=>s.copies[s.bindingFactoryInvocations[invocation].copyId].bindings[namespace].activationId='other',s=>s.copies[s.bindingFactoryInvocations[invocation].copyId].bindings[namespace].data={value:'SYNTHETIC-PRIVATE-RESULT'}]){const s=state('activation_pending');corrupt(s);fails(s,'BINDING_FACTORY_COPY_INVALID');}
  for(const corrupt of [s=>s.actionJobs[jobId].params.batchId='other',s=>s.actionJobs[jobId].source.copyId='other',s=>s.actionJobs[jobId].completionId='other',s=>s.actionJobs[jobId].status='succeeded']){const s=state('activation_pending');corrupt(s);fails(s,'BINDING_FACTORY_ACTION_INVALID');}
  const failed=state('activation_failed');failed.actionJobs[jobId].completedAt=null;fails(failed,'BINDING_FACTORY_ACTION_INVALID');
  const active=state('active');active.actionJobs[jobId].status='dead';fails(active,'BINDING_FACTORY_ACTION_INVALID');
});

test('factory audit detects orphan drafts, pending bindings, actions and cleanup obligations',()=>{
  const draft=state('pending');draft.bindingFactoryCopies[futureCopy].attemptId='missing';fails(draft,'BINDING_FACTORY_DRAFT_ORPHAN');
  const copy=state('activation_pending');delete copy.bindingFactoryInvocations[invocation];fails(copy,'BINDING_FACTORY_PENDING_ORPHAN');fails(copy,'BINDING_FACTORY_ACTION_ORPHAN');
  const obligation=state();obligation.completionObligations['binding-factory:orphan']={kind:'binding-factory',entityId:'orphan'};fails(obligation,'BINDING_FACTORY_OBLIGATION_ORPHAN');
  const row=state('pending');row.bindingFactoryBatches[batch].entries=[];fails(row,'BINDING_FACTORY_INVOCATION_INVALID');
});

test('factory audit reports malformed optional sections without reading opaque custody',()=>{
  for(const name of ['bindingFactoryReservations','bindingFactoryBatches','bindingFactoryInvocations','bindingFactoryCopies','bindingFactoryQuota']){const s=state();s[name]=[];fails(s,'BINDING_FACTORY_SECTION_INVALID');}
  const s=state('ready');s.bindingFactoryInvocations[invocation].resultCustody={get plaintext(){throw Error('Custody must remain opaque');}};assert.doesNotThrow(()=>auditState(s));
});
