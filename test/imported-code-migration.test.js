import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SQLiteStore} from '../src/sqlite.js';
import {CardFramework} from '../src/core.js';
import {createStateCodec} from '../src/encryption.js';
import {initializeCodeImportOrder} from '../src/record-accounting.js';
import {sqliteImportedCodeRows} from '../src/indexed-storage.js';
import {codesFixture,vault} from './codes-fixtures.mjs';
import {admin,code} from './helpers.js';

const at='2026-09-30T12:00:00.000Z';
function disk(t){const base=resolve(tmpdir()),directory=mkdtempSync(join(base,'imported-code-migration-'));t.after(()=>{assert(resolve(directory).startsWith(base+sep));rmSync(directory,{recursive:true,force:true});});return {path:join(directory,'state.sqlite'),key:randomBytes(32)};}
function createFixture(path,key){
  const store=new SQLiteStore(path,{encryptionKey:key}),x=codesFixture({store,stock:0,clock:()=>at});
  const imported=x.core.importCodes(admin,{key:'migration-import',poolId:'rewards',codes:[{code:'SYNTHETIC-MIGRATION-A',externalId:'migration-a'},{code:'SYNTHETIC-MIGRATION-B',externalId:'migration-b',expiresAt:'2026-10-05T00:00:00.000Z'},{code:'SYNTHETIC-MIGRATION-C',externalId:'migration-c',expiresAt:'2026-10-03T00:00:00.000Z'}]});
  store.prepareRecordTransactions();const state=store.read(value=>value);x.core.close();return {state,ids:imported.ids};
}
function inspect(path){const db=new DatabaseSync(path,{readOnly:true});try{return {version:db.prepare('PRAGMA user_version').get().user_version,meta:db.prepare('SELECT schema_version,codec_check FROM framework_meta').all(),fields:db.prepare('SELECT name,kind,payload FROM framework_fields ORDER BY name').all(),entities:db.prepare('SELECT collection,entity_key,ordinal,payload FROM framework_entities ORDER BY collection,entity_key').all(),indexes:db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'framework_code_%' ORDER BY name").all()};}finally{db.close();}}
function downgrade(path,key){const db=new DatabaseSync(path);try{db.exec('DROP INDEX framework_code_prefix_expiry; DROP INDEX framework_code_order_unique; PRAGMA user_version=7');db.prepare('UPDATE framework_meta SET schema_version=7,codec_check=? WHERE id=1').run(createStateCodec(key).encode({format:'digital-card.indexed-state',version:7,recordKeys:'blind-v1'}));}finally{db.close();}}

test('schema7 imported-code migration is read-only compatible, atomic and payload-preserving',t=>{
  const {path,key}=disk(t),{state,ids}=createFixture(path,key);downgrade(path,key);const original=inspect(path);
  const readonly=new SQLiteStore(path,{encryptionKey:key,readOnly:true});try{assert.deepEqual(readonly.read(value=>value),state);assert.throws(()=>readonly.query(query=>query.importedCodePrefix('rewards',3,at)),code('RECORD_MIGRATION_REQUIRED'));}finally{readonly.close();}assert.deepEqual(inspect(path),original);
  for(const stage of ['before-schema','after-records','before-commit']){
    assert.throws(()=>new SQLiteStore(path,{encryptionKey:key,onMigration:event=>{assert.equal(event.from,7);assert.equal(event.to,8);if(event.stage===stage)throw Error('Interrupted imported-code migration');}}),/Interrupted imported-code migration/);
    assert.deepEqual(inspect(path),original);
  }
  const stages=[],store=new SQLiteStore(path,{encryptionKey:key,onMigration:event=>stages.push(event.stage)});
  try{assert.deepEqual(stages,['before-schema','after-records','before-commit']);assert.deepEqual(store.read(value=>value),state);assert.deepEqual(store.query(query=>query.importedCodePrefix('rewards',3,at)).map(entry=>entry.row.id),[ids[2],ids[1],ids[0]]);}finally{store.close();}
  const migrated=inspect(path);assert.equal(migrated.version,8);assert.deepEqual(migrated.fields,original.fields);assert.deepEqual(migrated.entities,original.entities);assert(migrated.indexes.some(index=>index.name==='framework_code_prefix_expiry'));assert(migrated.indexes.some(index=>index.name==='framework_code_order_unique'));
  const reopened=new SQLiteStore(path,{encryptionKey:key,onMigration:()=>assert.fail('Migration must not repeat')});try{assert.deepEqual(reopened.read(value=>value),state);assert.deepEqual(reopened.read(value=>Object.values(value.codes).map(row=>row.history)),Object.values(state.codes).map(row=>row.history));}finally{reopened.close();}
});
test('prepared import ordering survives migration and encrypted restart without reusing removed ordinals',t=>{
  const {path,key}=disk(t),{state,ids}=createFixture(path,key),retained=structuredClone(state._codeImportOrder),clone=structuredClone(state);initializeCodeImportOrder(clone);assert.deepEqual(clone,state);initializeCodeImportOrder(clone);assert.deepEqual(clone,state);
  downgrade(path,key);let store=new SQLiteStore(path,{encryptionKey:key});store.transact(value=>{delete value.codes[ids[1]];});store.close();
  store=new SQLiteStore(path,{encryptionKey:key});const core=new CardFramework({store,clock:()=>at,codeVault:vault()});try{
    assert.deepEqual(store.read(value=>value._codeImportOrder),retained);const imported=core.importCodes(admin,{key:'after-restart',poolId:'rewards',codes:[{code:'SYNTHETIC-MIGRATION-D',externalId:'migration-d',expiresAt:'2026-10-03T00:00:00.000Z'}]});
    const order=store.read(value=>value._codeImportOrder);for(const id of ids)assert.equal(order[id],retained[id]);assert.equal(order[imported.ids[0]],3);assert.equal(order['@cursor'],4);
    store.prepareRecordTransactions();assert.deepEqual(store.read(value=>value._codeImportOrder),order);assert.deepEqual(store.query(query=>query.importedCodePrefix('rewards',3,at)).map(entry=>entry.ordinal),[2,3,0]);
  }finally{core.close();}
  const reopened=new SQLiteStore(path,{encryptionKey:key});try{assert.equal(reopened.read(value=>value._codeImportOrder['@cursor']),4);assert.deepEqual(reopened.query(query=>query.importedCodePrefix('rewards',3,at)).map(entry=>entry.ordinal),[2,3,0]);}finally{reopened.close();}
});
test('finite and nonexpiring imported-code prefixes use covering index seeks without temporary sorting',t=>{
  const {path,key}=disk(t);createFixture(path,key);const db=new DatabaseSync(path,{readOnly:true});try{
    const plans=[],traced={prepare(sql){const statement=db.prepare(sql);return {get:(...args)=>statement.get(...args),all(...args){plans.push(db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args));return statement.all(...args);}};}};
    assert.equal(sqliteImportedCodeRows(traced,'rewards',3,at).length,3);assert.equal(plans.length,2);
    for(const plan of plans){assert(plan.some(row=>/SEARCH.*COVERING INDEX framework_code_prefix_expiry/.test(row.detail)),JSON.stringify(plan));assert(!plan.some(row=>/SCAN framework_entities|USE TEMP B-TREE/.test(row.detail)),JSON.stringify(plan));}
  }finally{db.close();}
});
