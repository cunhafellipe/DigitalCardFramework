import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordTransaction,validateRecordPlan} from '../src/record-transaction.js';

const id='11111111-1111-4111-8111-111111111111',copyId='22222222-2222-4222-8222-222222222222',batchId='33333333-3333-4333-8333-333333333333',jobId='44444444-4444-4444-8444-444444444444',leaseToken='55555555-5555-4555-8555-555555555555';
const namespace='example.reward',data={reward:'synthetic'},custody={keyId:'fixture',iv:'synthetic',ciphertext:'synthetic',tag:'synthetic'};
const change=(collection,key,before,value,ordinal)=>({collection,key,old:before===undefined?undefined:{value:structuredClone(before)},value:structuredClone(value),...(ordinal===undefined?{}:{ordinal})});
function admission(value){const tx=createRecordTransaction({});try{tx.api.admitBindingFactoryResult(value);return tx.finish().bindingFactoryAdmissions[0];}finally{tx.close();}}
function fixture({failed=false}={}){
 const invocation={invocationId:id,copyId,userId:'collector',namespace,state:'activation_pending',inputDigest:'a'.repeat(64),inputCustody:custody,resultCustody:null,jobId},binding={state:'activation-pending',activationId:id,holderId:'collector',visibility:'owner',transfer:'retain'},copy={id:copyId,ownerId:'collector',version:1,bindings:{[namespace]:binding,'example.static':{state:'active',holderId:'collector',visibility:'owner',transfer:'follow',data:{static:true}}}},job={id:jobId,handler:'framework.binding.activation',params:{batchId,invocationId:id},source:{type:'binding.activation',invocationId:id,copyId,namespace},userId:'collector',completionId:'binding-factory:'+batchId,createdAt:'2026-10-12T00:00:00Z',status:'running',leaseToken,leaseUntil:'2026-10-12T00:01:00Z'};
 const state=failed?'activation_failed':'active',nextBinding={holderId:'collector',visibility:'owner',transfer:'retain',state:failed?'activation-failed':'active',...(failed?{}:{data})};
 const changes=[change('bindingFactoryInvocations',id,invocation,{...invocation,state,...(failed?{}:{resultCustody:custody})}),change('copies',copyId,copy,{...copy,version:2,bindings:{...copy.bindings,[namespace]:nextBinding}}),change('actionJobs',jobId,job,{...job,status:failed?'dead':'succeeded',leaseToken:null,leaseUntil:null}),change('events','0',undefined,{id:'event',sequence:1,type:failed?'binding.activation-failed':'binding.activated',at:'2026-10-12T00:00:30Z',data:{copyId,namespace}},0)];
 return {scalars:[],changes,loaded:[],bindingFactoryAdmissions:[admission({invocationId:id,jobId,leaseToken,state,...(failed?{}:{data})})]};
}
const validate=plan=>validateRecordPlan(plan,{bindingFactories:true});
test('typed activation admits exact result and terminal refusal while preserving native binding authority',()=>{
 assert.doesNotThrow(()=>validate(fixture()));assert.doesNotThrow(()=>validate(fixture({failed:true})));
 for(const [key,value]of Object.entries({holderId:'outsider',visibility:'public',transfer:'follow',state:'used',activationId:id,data:{reward:'substituted'}})){
  const plan=fixture();plan.changes.find(row=>row.collection==='copies').value.bindings[namespace][key]=value;assert.throws(()=>validate(plan),{code:'INVALID_STATE'},key);
 }
 const failed=fixture({failed:true});failed.changes.find(row=>row.collection==='copies').value.bindings[namespace].data={};assert.throws(()=>validate(failed),{code:'INVALID_STATE'});
});
test('activation cannot add namespaces, change unrelated bindings or replace pinned custody',()=>{
 for(const mutation of [plan=>plan.changes[1].value.bindings.extra={},plan=>plan.changes[1].value.bindings['example.static'].holderId='outsider',plan=>plan.changes[1].value.ownerId='outsider',plan=>plan.changes[0].value.inputCustody={...custody,ciphertext:'changed'},plan=>plan.changes[0].value.inputDigest='b'.repeat(64)]){const plan=fixture();mutation(plan);assert.throws(()=>validate(plan),{code:'INVALID_STATE'});}
 const plan=fixture();plan.changes[0].old.value.resultCustody=custody;plan.changes[0].value.resultCustody={...custody,ciphertext:'changed'};assert.throws(()=>validate(plan),{code:'INVALID_STATE'});
});
test('activation requires authenticated admission and exact originating leased job, copy and event',()=>{
 for(const mutation of [plan=>delete plan.bindingFactoryAdmissions,plan=>plan.bindingFactoryAdmissions=[{invocationId:id}],plan=>plan.changes=plan.changes.filter(row=>row.collection!=='copies'),plan=>plan.changes=plan.changes.filter(row=>row.collection!=='actionJobs'),plan=>plan.changes=plan.changes.filter(row=>row.collection!=='events'),plan=>plan.changes[2].old.value.leaseUntil='2026-10-12T00:00:29Z',plan=>plan.changes[2].old.value.leaseToken='different',plan=>plan.changes[2].value.status='pending',plan=>plan.changes[3].value.data.namespace='other.reward']){const plan=fixture();mutation(plan);assert.throws(()=>validate(plan),{code:'INVALID_STATE'});}
});
test('generic action, code and preference scopes cannot write binding factory lifecycle records',()=>{
 for(const options of [{actionDelivery:true},{actionRetry:true,actionDelivery:true},{codeIssuance:true},{preferences:true},{}])assert.throws(()=>validateRecordPlan({scalars:[],changes:[fixture().changes[0]],loaded:[]},options),{code:'RECORD_TRANSACTION_UNSUPPORTED'});
 assert.doesNotThrow(()=>validateRecordPlan({scalars:[],changes:[],loaded:[]},{}));
 assert.doesNotThrow(()=>validateRecordPlan({scalars:[],changes:[change('bindingFactoryQuota','global',undefined,{reserved:1})],loaded:[]},{bindingFactories:true}));
 const job={id:jobId,handler:'example.action',params:{},source:{type:'pack.opened'},deliveryCompletionId:'action:'+jobId,status:'pending'},reservation={id:'action:'+jobId,kind:'action',entityId:jobId,status:'completed',events:0,jobs:0,subscriptions:[],bytes:1000,usedBytes:10};
 assert.doesNotThrow(()=>validateRecordPlan({scalars:[],changes:[change('actionJobs',jobId,job,{...job,status:'running'}),change('completionObligations',reservation.id,reservation,{...reservation,usedBytes:20})],loaded:[],completion:{id:reservation.id,admission:false}},{actionDelivery:true}));
});
test('unsent dependent refusal requires pinned chain and original authenticated refusal',()=>{
 const plan=fixture({failed:true}),dependentId='66666666-6666-4666-8666-666666666666',dependentJobId='77777777-7777-4777-8777-777777777777',dependentNamespace='example.dependent',origin=plan.changes[0].old.value,job=plan.changes[2].old.value,dependent={...origin,invocationId:dependentId,namespace:dependentNamespace,dependsOn:id,inputDigest:null,inputCustody:null,jobId:dependentJobId};
 const copy=plan.changes[1];copy.old.value.bindings[dependentNamespace]={state:'activation-pending',activationId:dependentId,holderId:'collector',visibility:'owner',transfer:'follow'};copy.value.bindings[dependentNamespace]={state:'activation-failed',holderId:'collector',visibility:'owner',transfer:'follow'};
 plan.changes.push(change('bindingFactoryInvocations',dependentId,dependent,{...dependent,state:'activation_failed'}),change('actionJobs',dependentJobId,{...job,id:dependentJobId,status:'pending',leaseToken:null,leaseUntil:null,params:{batchId,invocationId:dependentId},source:{...job.source,invocationId:dependentId,namespace:dependentNamespace}},{...job,id:dependentJobId,status:'dead',leaseToken:null,leaseUntil:null,params:{batchId,invocationId:dependentId},source:{...job.source,invocationId:dependentId,namespace:dependentNamespace}}),change('events','1',undefined,{id:'dependent-event',sequence:2,type:'binding.activation-failed',at:'2026-10-12T00:00:30Z',data:{copyId,namespace:dependentNamespace}},1));
 plan.bindingFactoryAdmissions.push(admission({invocationId:dependentId,jobId,leaseToken,state:'activation_failed',dependencyOf:id}));assert.doesNotThrow(()=>validate(plan));
 plan.changes.find(row=>row.key===dependentId).old.value.inputCustody=custody;assert.throws(()=>validate(plan),{code:'INVALID_STATE'});
});
