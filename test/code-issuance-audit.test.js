import test from 'node:test';
import assert from 'node:assert/strict';
import {auditState} from '../src/audit.js';
import {MemoryStore} from '../src/index.js';
import {fixture} from './helpers.js';
function state(){const store=new MemoryStore();fixture({store});const s=store.read(s=>s);s.codeIssuanceReservations={attempt:{attemptId:'attempt',batchId:'batch',count:2,bytes:4096,state:'reserved'}};s.codeIssuanceQuota={global:{reserved:2}};s.completionObligations={...s.completionObligations,'code-issuance:batch':{kind:'code-issuance',entityId:'batch',status:'reserved'}};return s;}
function fails(s,code){assert(auditState(s).issues.some(i=>i.code===code));}
test('issuance audit allows preselection reservations and retains cleanup capacity',()=>{
 const s=state();assert.equal(auditState(s).ok,true);
 for(const status of ['pending','issued','cancel_pending','quarantined']){s.codeIssuanceBatches={batch:{id:'batch',attemptId:'attempt',state:status}};assert.equal(auditState(s).ok,true);}
 s.codeIssuanceQuota.global.reserved=0;fails(s,'CODE_ISSUANCE_QUOTA_INVALID');
});
test('issuance audit requires terminal release and matching obligations',()=>{
 for(const status of ['attached','cancelled']){const s=state();s.codeIssuanceBatches={batch:{id:'batch',attemptId:'attempt',state:status}};fails(s,'CODE_ISSUANCE_RELEASE_INVALID');s.codeIssuanceReservations.attempt.state='released';s.codeIssuanceQuota.global.reserved=0;s.completionObligations['code-issuance:batch'].status='completed';assert.equal(auditState(s).ok,true);delete s.completionObligations['code-issuance:batch'];fails(s,'CODE_ISSUANCE_OBLIGATION_INVALID');}
});
test('issuance audit detects corrupt reservation links without mutating state',()=>{
 const s=state();s.codeIssuanceBatches={batch:{id:'batch',attemptId:'missing',state:'pending'}};const before=structuredClone(s);fails(s,'CODE_ISSUANCE_BATCH_RESERVATION_INVALID');assert.deepEqual(s,before);s.codeIssuanceReservations.attempt.count=-1;fails(s,'CODE_ISSUANCE_RESERVATION_INVALID');
});

test('issuance audit detects orphan cleanup obligations',()=>{
 const s=state();s.completionObligations['code-issuance:orphan']={kind:'code-issuance',entityId:'orphan',status:'reserved'};fails(s,'CODE_ISSUANCE_OBLIGATION_ORPHAN');
});
