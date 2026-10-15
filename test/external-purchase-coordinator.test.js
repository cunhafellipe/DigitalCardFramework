import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SQLiteStore} from '../src/sqlite.js';
import {fixture} from './helpers.js';

const providerId='coordinator.wallet';
async function coordinator(config){
  const child=fork(new URL('./fixtures/external-purchase-coordinator.mjs',import.meta.url),[],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
  let sequence=0,stderr='';const waiting=new Map();child.stderr.on('data',bytes=>stderr=(stderr+bytes).slice(-4096));
  child.on('message',({id,result,error})=>{const request=waiting.get(id);if(!request)return;waiting.delete(id);clearTimeout(request.timer);if(error)request.reject(Object.assign(Error(error.message),{code:error.code}));else request.resolve(result);});
  child.on('exit',()=>{for(const request of waiting.values()){clearTimeout(request.timer);request.reject(Object.assign(Error('Coordinator exited before reply'+(stderr?': '+stderr:'')),{code:'COORDINATOR_REPLY_LOST'}));}waiting.clear();});
  const call=(command,input,options={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{waiting.delete(id);reject(Error('Coordinator request timed out'));child.kill();},10000);waiting.set(id,{resolve,reject,timer});child.send({id,command,input,...options});});
  await call('init',config);
  return {pid:child.pid,call,async close(){if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');await call('close');await ended;}},async stop(){if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}}};
}
function walletJournal(filename){
  const db=new DatabaseSync(filename);db.exec('CREATE TABLE IF NOT EXISTS wallet(balance INTEGER, debits INTEGER, refunds INTEGER, finalized INTEGER); CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, intent TEXT, prepared TEXT, debit TEXT, refund TEXT);');
  if(!db.prepare('SELECT 1 FROM wallet').get())db.prepare('INSERT INTO wallet VALUES(100,0,0,0)').run();
  const order=()=>db.prepare('SELECT * FROM orders').get();
  return {
    close:()=>db.close(),snapshot:()=>({...db.prepare('SELECT * FROM wallet').get()}),order,
    prepare(intent,prepared){db.prepare('INSERT INTO orders VALUES(?,?,?,NULL,NULL)').run(intent.transactionId,JSON.stringify(intent),JSON.stringify(prepared));},
    debit(){const row=order();if(row.debit)return JSON.parse(row.debit);const intent=JSON.parse(row.intent),prepared=JSON.parse(row.prepared),proof={kind:'debit',reference:'debit:'+row.id,providerId,transactionId:row.id,userId:intent.userId,externalCurrency:intent.externalCurrency,externalUnits:intent.externalUnits,fingerprint:prepared.fingerprint};db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE wallet SET balance=balance-?,debits=debits+1').run(Number(intent.externalUnits));db.prepare('UPDATE orders SET debit=? WHERE id=?').run(JSON.stringify(proof),row.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return proof;},
    refund(required){const row=order();if(row.refund)return JSON.parse(row.refund);const debit=JSON.parse(row.debit);assert.equal(required.state,'refund_required');assert.equal(required.debitReference,debit.reference);assert.equal(required.terms.userId,debit.userId);assert.equal(required.terms.externalCurrency,debit.externalCurrency);assert.equal(required.terms.externalUnits,debit.externalUnits);const proof={...debit,kind:'refund',reference:'refund:'+row.id,compensationId:required.compensationId,debitReference:debit.reference};db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE wallet SET balance=balance+?,refunds=refunds+1').run(Number(debit.externalUnits));db.prepare('UPDATE orders SET refund=? WHERE id=?').run(JSON.stringify(proof),row.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return proof;},
    finalize(){assert.equal(order().refund,null);db.prepare('UPDATE wallet SET finalized=1 WHERE finalized=0').run();},
  };
}
for(const branch of ['fulfilled','compensated'])test('independent payment coordinator recovers '+branch+' after terminal reply loss',{timeout:30000},async t=>{
  const root=mkdtempSync(join(tmpdir(),'external-coordinator-')),filename=join(root,'framework.sqlite'),paymentFile=join(root,'wallet.sqlite'),encryptionKey=randomBytes(32),store=new SQLiteStore(filename,{encryptionKey}),x=fixture({store});
  const intent={key:'original-order',providerId,transactionId:'original-order',userId:x.alice.userId,externalCurrency:'points',externalUnits:'10',quote:x.core.quote(x.alice,{productId:branch==='fulfilled'?'common':'unique',quantity:1})},walletBefore=x.core.wallet(x.alice);x.core.close();
  const config={filename,encryptionKey:encryptionKey.toString('hex'),providerId,alice:x.alice,bob:x.bob};let journal=walletJournal(paymentFile),worker;
  t.after(async()=>{await worker?.stop();journal.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe coordinator cleanup target');rmSync(root,{recursive:true,force:true});});
  worker=await coordinator(config);assert.notEqual(worker.pid,process.pid);
  const prepared=await worker.call('prepare',intent);assert.equal(prepared.state,'prepared');journal.prepare(intent,prepared);assert.deepEqual((await worker.call('snapshot')).wallet,walletBefore);
  assert.equal((await worker.call('pending',{providerId})).items.length,1);
  await assert.rejects(worker.call('status',{preparationId:prepared.preparationId},{actor:x.bob}),{code:'NOT_FOUND'});
  await assert.rejects(worker.call('status',{preparationId:prepared.preparationId},{actor:{permissions:['currency.settle'],settlementProviderId:'other.wallet'}}));
  const debit=journal.debit(),commit={preparationId:prepared.preparationId,fingerprint:prepared.fingerprint,debitReceipt:debit},proofOptions={verifiedEvidence:[debit]};
  await assert.rejects(worker.call('commit',{...commit,debitReceipt:{...debit,externalCurrency:'other'}},proofOptions),{code:'SETTLEMENT_CONFLICT'});
  let terminal;
  if(branch==='fulfilled'){
    await assert.rejects(worker.call('commit',commit,{...proofOptions,loseReply:true}),{code:'COORDINATOR_REPLY_LOST'});
  }else{
    await worker.call('drainStock');const required=await worker.call('commit',commit,proofOptions);assert.equal(required.state,'refund_required');assert.equal(required.failureCode,'POOL_EXHAUSTED');assert.equal((await worker.call('snapshot')).alicePacks.length,0);
    const refund=journal.refund(required),compensate={preparationId:prepared.preparationId,fingerprint:prepared.fingerprint,refundReceipt:refund};
    await assert.rejects(worker.call('compensate',{...compensate,refundReceipt:{...refund,externalUnits:'11'}},{verifiedEvidence:[refund]}),{code:'SETTLEMENT_CONFLICT'});
    await assert.rejects(worker.call('compensate',compensate,{verifiedEvidence:[refund],loseReply:true}),{code:'COORDINATOR_REPLY_LOST'});
  }
  journal.close();journal=walletJournal(paymentFile);const saved=journal.order();assert.deepEqual(JSON.parse(saved.intent),intent);assert.deepEqual(JSON.parse(saved.prepared),prepared);assert.deepEqual(journal.debit(),debit);assert.equal(journal.snapshot().debits,1);
  worker=await coordinator(config);terminal=await worker.call('lookup',{providerId,transactionId:intent.transactionId});assert.equal(terminal.state,branch);
  assert.deepEqual(await worker.call('status',{preparationId:prepared.preparationId}),terminal);assert.equal((await worker.call('pending',{providerId})).items.length,0);
  assert.equal((await worker.call('prepare',intent)).preparationId,prepared.preparationId);assert.deepEqual(await worker.call('commit',commit,proofOptions),terminal);
  if(branch==='fulfilled'){assert.equal(terminal.purchase.packs.length,1);journal.finalize();journal.finalize();assert.deepEqual(journal.snapshot(),{balance:90,debits:1,refunds:0,finalized:1});}
  else{const refund=JSON.parse(saved.refund);assert.deepEqual(journal.refund({...terminal,state:'refund_required'}),refund);assert.deepEqual(await worker.call('compensate',{preparationId:prepared.preparationId,fingerprint:prepared.fingerprint,refundReceipt:refund},{verifiedEvidence:[refund]}),terminal);assert.deepEqual(journal.snapshot(),{balance:100,debits:1,refunds:1,finalized:0});}
  const snapshot=await worker.call('snapshot');assert.deepEqual(snapshot.wallet,walletBefore);assert.equal(snapshot.alicePacks.length,branch==='fulfilled'?1:0);assert.equal(snapshot.aliceInventory.length,0);assert.equal(snapshot.allocatedCopyIds.length,branch==='fulfilled'?1:0);if(branch==='fulfilled')assert.equal(snapshot.alicePacks[0].id,terminal.purchase.packs[0].id);assert.equal(snapshot.audit.ok,true);assert.equal(snapshot.integrity,true);await worker.close();
});
