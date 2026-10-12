import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCodeIssuerRegistry} from '../src/remote-code-issuer.js';
import {codeIssuanceProtocol,matchCodeIssuanceResults} from '../src/code-issuance-contracts.js';
function request(issuer){return {protocol:codeIssuanceProtocol,operation:'issue',requestId:randomUUID(),...issuer.grant(),batchId:randomUUID(),inputDigest:'a'.repeat(64),deadline:Date.now()+10000,context:{entries:[{issuanceId:randomUUID(),inputDigest:'b'.repeat(64),attemptId:randomUUID(),codeId:randomUUID(),copyId:randomUUID(),userId:randomUUID(),poolId:'pool',variantId:'variant',packIndex:0,slotId:'slot',slotOrdinal:0,attachmentId:'reward',attachmentIndex:0}]}};}
function registry(generate){return createCodeIssuerRegistry({allocationCodeIssuers:{example:{kind:'pure',providerId:'example.issuer',generate}}});}
test('pure issuer requires an explicit provider and binds grants to it',async()=>{
 assert.throws(()=>createCodeIssuerRegistry({allocationCodeIssuers:{example:{kind:'pure',generate:()=>({code:'demo'})}}}),{code:'CODE_ISSUER_CONFIG'});
 const r=registry(()=>({code:'demo'})),issuer=r.issuers.example;
 try{const q=request(issuer);q.providerId='another.issuer';await assert.rejects(issuer.evaluate(q),{code:'POLICY_STALE'});r.close();await assert.rejects(issuer.evaluate(q),{code:'POLICY_DISABLED'});}finally{r.close();}
});
test('pure issuer rejects async effects and bounded material violations',async()=>{
 for(const generate of [async()=>({code:'demo'}),()=>({code:'x'.repeat(513)}),()=>({code:'demo',metadata:{value:'x'.repeat(2048)}}),()=>({code:'demo\n'})]){const r=registry(generate);try{await assert.rejects(r.issuers.example.evaluate(request(r.issuers.example)),{code:'INVALID_CODE_ISSUANCE_RESPONSE'});}finally{r.close();}}
});
test('issuance result matching rejects changed positions, duplicates and extra secrets',async()=>{
 const r=registry(()=>({code:'demo'}));try{const q=request(r.issuers.example),response=await r.issuers.example.evaluate(q);assert.equal(matchCodeIssuanceResults(q,response).length,1);for(const mutate of [v=>v.results[0].copyId=randomUUID(),v=>v.results.push(structuredClone(v.results[0])),v=>v.results[0].secret='extra']){const bad=structuredClone(response);mutate(bad);assert.throws(()=>matchCodeIssuanceResults(q,bad),{code:'INVALID_CODE_ISSUANCE_RESPONSE'});}}finally{r.close();}
});
