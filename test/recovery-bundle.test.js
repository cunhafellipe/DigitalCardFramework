import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir,mkdir,symlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {SQLiteStore} from '../src/sqlite.js';
import {CardFramework} from '../src/core.js';
import {SessionStore} from '../src/auth.js';
import {createPresentationStore} from '../src/presentation/service.js';
import {importPackage} from '../src/presentation/package.js';
import {buildReport} from '../src/presentation/compiler.js';
import {build,fixture as artFixture} from './presentation-fixtures.mjs';
import {codesFixture,vault} from './codes-fixtures.mjs';
import {admin} from './helpers.js';
import {backupRecoveryBundle,restoreRecoveryBundle} from '../tools/recovery-bundle.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function tree(root) {
  const result = {};
  async function walk(relative='') {
    for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})) {
      const name = relative ? relative+'/'+entry.name : entry.name;
      if(entry.isDirectory()) await walk(name); else result[name] = sha(await readFile(path.join(root,name)));
    }
  }
  await walk(); return result;
}
const validate = async file => {const pkg = await importPackage(new Uint8Array(await readFile(file))); return {digest:pkg.digest,capabilities:pkg.manifest.capabilities,report:buildReport(pkg)};};
const presentationStore = root => createPresentationStore({root,authorize:()=>true,validate});
async function ready(store,bytes,key) {
  const actor = {id:'operator'}, job = await store.import(actor,bytes,{idempotencyKey:key});
  for(let attempt=0;attempt<100;attempt++) {const current = await store.get(actor,job.id); if(current.state === 'ready') return current; if(current.state === 'rejected') throw Error(current.error); await delay(10);}
  throw Error('Import did not become ready');
}
async function seed() {
  const dir = await mkdtemp(path.join(tmpdir(),'card-recovery-')),database = path.join(dir,'source.sqlite'),presentationRoot = path.join(dir,'art'),key = randomBytes(32);
  const pkg = await build(artFixture()), nextFixture = artFixture(); nextFixture.manifest.revision = 2;
  const next = await build(nextFixture), reference = {contract:'digital-card@0.1',digest:pkg.digest,baseURL:'/presentations/'+pkg.digest+'/files/'};
  const x = codesFixture({store:new SQLiteStore(database,{encryptionKey:key}),change(c) {c.cards.find(c=>c.id === 'dawn').presentation = reference; c.cards.find(c=>c.id === 'aurora').presentation = {contract:'digital-card@0.1',digest:'sha256:'+'b'.repeat(64),baseURL:'https://assets.example.test/card/'};}});
  const input = {...x.core.quote(x.alice,{productId:'bundle',quantity:1}),key:'retained-purchase'},purchase = x.core.purchase(x.alice,input);
  const opened = x.core.openPack(x.alice,{packId:purchase.packs[0].id,key:'retained-open'}),reward = opened.cards.find(c=>c.cardId === 'reward');
  const codeResult = x.core.revealCode(x.alice,{codeId:reward.codes[0].id,key:'retained-reveal'});
  x.buy('unique',x.alice,1,'retained-serial');
  const revised = x.core.operatorCatalog(admin); revised.version++;
  delete revised.cards.find(card=>card.id === 'dawn').presentation;
  x.core.publishCatalog(admin,revised);
  const state = x.store.read(s=>s); x.core.close();
  const sessions = new SessionStore(database,{encryptionKey:key}),token = sessions.create('session',{userId:x.alice.userId,issuer:'https://identity.example.test',subject:'collector'},600000),flow = sessions.create('flow',{verifier:'retained-verifier',nonce:'retained-nonce'},600000); sessions.close();
  const art = await presentationStore(presentationRoot),published = await ready(art,pkg.archive,'published-import'); await art.publish({id:'operator'},published.id);
  await art.availability({id:'operator'},pkg.digest,{state:'quarantined',reason:'Held for review'});
  const pending = await ready(art,next.archive,'ready-import'); await art.close();
  return {dir,database,presentationRoot,key,pkg,next,reference,state,alice:x.alice,input,purchase,opened,codeResult,reward,token,flow,published,pending};
}
const backupOptions = (x,destination) => ({database:x.database,presentationRoot:x.presentationRoot,destination,encryptionKey:x.key,codeVault:vault()});
const restoreOptions = (x,bundle,destination) => ({bundle,destination,encryptionKey:x.key,codeVault:vault()});
const clean = x => rm(x.dir,{recursive:true,force:true});

test('CLI recovery restores encrypted state, sessions, pinned art, moderation and import replay together',async()=>{
  const x = await seed(), bundle = path.join(x.dir,'bundle'), restored = path.join(x.dir,'restored');
  const env = {...process.env,STATE_ENCRYPTION_KEY:x.key.toString('hex'),CODE_ACTIVE_KEY_ID:'one',CODE_VAULT_KEYS:JSON.stringify({one:Buffer.alloc(32,7).toString('hex')}),CODE_INDEX_KEY:Buffer.alloc(32,9).toString('hex')};
  for(const name of ['STATE_ENCRYPTION_KEY_FILE','CODE_VAULT_KEYS_FILE','CODE_INDEX_KEY_FILE']) delete env[name];
  const run = args => JSON.parse(execFileSync(process.execPath,[path.resolve('tools/recovery.js'),...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  try {
    const before = await tree(x.dir), result = run(['backup',x.database,x.presentationRoot,bundle,'--stopped']);
    assert.equal(result.sessions,2); assert.equal(result.jobs,2); assert.equal(result.externalReferences,1);
    for(const [name,value] of Object.entries(before)) assert.equal((await tree(x.dir))[name],value);
    const bundleBefore = await tree(bundle),manifest = JSON.parse(await readFile(path.join(bundle,'manifest.json'),'utf8'));
    assert(manifest.references.some(ref=>ref.digest === x.pkg.digest && ref.storage === 'included'));
    assert(manifest.references.some(ref=>ref.storage === 'external'));
    assert(!JSON.stringify(manifest).includes(x.key.toString('hex')));
    for(const secret of ['SECRET-REWARD-0','retained-verifier','retained-nonce']) assert(!(await readFile(path.join(bundle,'state.sqlite'))).includes(Buffer.from(secret)));
    run(['restore',bundle,restored,'--stopped']); assert.deepEqual(await tree(bundle),bundleBefore);
    const store = new SQLiteStore(path.join(restored,'state.sqlite'),{encryptionKey:x.key}), core = new CardFramework({store,codeVault:vault()});
    assert.deepEqual(store.read(s=>s),x.state);
    assert.deepEqual(core.purchase(x.alice,x.input),x.purchase);
    assert.deepEqual(core.openPack(x.alice,{packId:x.purchase.packs[0].id,key:'retained-open'}),x.opened);
    assert.deepEqual(core.revealCode(x.alice,{codeId:x.reward.codes[0].id,key:'retained-reveal'}),x.codeResult);
    assert.deepEqual(core.inventory(x.alice).find(c=>c.cardId === 'dawn').definition.presentation,x.reference);
    assert.deepEqual(store.read(s=>s),x.state); core.close();
    const sessions = new SessionStore(path.join(restored,'state.sqlite'),{encryptionKey:x.key});
    assert.equal(sessions.get(x.token,'session').userId,x.alice.userId); assert.deepEqual(sessions.get(x.flow,'flow'),{verifier:'retained-verifier',nonce:'retained-nonce'}); sessions.close();
    const art = await presentationStore(path.join(restored,'presentations'));
    try {
      await assert.rejects(art.descriptor(x.pkg.digest),error=>error.code === 'QUARANTINED');
      assert.deepEqual(await art.publish({id:'operator'},x.published.id),await art.get({id:'operator'},x.published.id));
      const replay = await art.import({id:'operator'},x.next.archive,{idempotencyKey:'ready-import'}); assert.equal(replay.id,x.pending.id); assert.equal(replay.state,'ready');
      assert.equal((await art.publish({id:'operator'},replay.id)).state,'published');
      assert.equal((await art.descriptor(x.next.digest)).revision,2);
      await art.availability({id:'operator'},x.pkg.digest,{state:'available'});
      assert.deepEqual(Buffer.from((await art.file(x.pkg.digest,'assets/art.png')).bytes),Buffer.from(x.pkg.files.get('assets/art.png')));
      const job = await art.get({id:'operator'},x.pending.id); assert.equal(job.uploadPath,undefined);
    } finally {await art.close();}
    const job = JSON.parse(await readFile(path.join(restored,'presentations','jobs',x.pending.id+'.json'),'utf8'));
    assert.equal(job.uploadPath,path.join(restored,'presentations','quarantine',x.pending.id+'.dcard'));
    assert.deepEqual(await tree(bundle),bundleBefore);
  } finally {await clean(x);}
});

test('recovery refuses missing and wrong state/code/index keys without exposing a destination',async()=>{
  const x = await seed(),bundle = path.join(x.dir,'bundle');
  try {
    await backupRecoveryBundle(backupOptions(x,bundle)); const source = await tree(bundle);
    const invalid = [
      {encryptionKey:undefined}, {encryptionKey:randomBytes(32)}, {codeVault:undefined},
      {codeVault:vault({keys:{one:Buffer.alloc(32,6)}})},
      {codeVault:vault({activeKeyId:'two',keys:{two:Buffer.alloc(32,8)}})},
      {codeVault:vault({indexKey:Buffer.alloc(32,8)})},
    ];
    for(let i=0;i<invalid.length;i++) {
      const destination = path.join(x.dir,'invalid-'+i);
      await assert.rejects(restoreRecoveryBundle({...restoreOptions(x,bundle,destination),...invalid[i]}));
      assert.equal(existsSync(destination),false); assert.deepEqual(await tree(bundle),source);
    }
    const destination = path.join(x.dir,'restored'); await restoreRecoveryBundle(restoreOptions(x,bundle,destination));
    const before = await tree(destination); await assert.rejects(restoreRecoveryBundle(restoreOptions(x,bundle,destination)),/new path/); assert.deepEqual(await tree(destination),before);
  } finally {await clean(x);}
});

test('recovery rejects missing/tampered art and retained references, live locks and in-flight import work',async()=>{
  const x = await seed(),bundle = path.join(x.dir,'bundle');
  try {
    const before = await tree(x.dir);
    await writeFile(path.join(x.presentationRoot,'writer.lock'),'');
    await assert.rejects(backupRecoveryBundle(backupOptions(x,bundle)),/writer lock/); assert(!existsSync(bundle));
    await rm(path.join(x.presentationRoot,'writer.lock')); assert.deepEqual(await tree(x.dir),before);
    const jobFile = path.join(x.presentationRoot,'jobs',x.pending.id+'.json'), originalJob = await readFile(jobFile),job = JSON.parse(originalJob);
    await writeFile(jobFile,JSON.stringify({...job,state:'compiling'}));
    await assert.rejects(backupRecoveryBundle(backupOptions(x,bundle)),/in flight/); assert(!existsSync(bundle)); assert(!existsSync(path.join(x.presentationRoot,'writer.lock')));
    await writeFile(jobFile,originalJob);
    const asset = path.join(x.presentationRoot,'content',x.pkg.digest.slice(7),'assets/art.png'),originalAsset = await readFile(asset);
    await rm(asset); await assert.rejects(backupRecoveryBundle(backupOptions(x,bundle)),/missing/); assert(!existsSync(bundle));
    await writeFile(asset,Buffer.from('changed')); await assert.rejects(backupRecoveryBundle(backupOptions(x,bundle)),/differs/); await writeFile(asset,originalAsset);
    const database = new SQLiteStore(x.database,{encryptionKey:x.key});
    const catalog = database.read(s=>s.catalog);
    database.transact(s=>{s.catalog.cards.find(c=>c.id === 'solstice').presentation = {contract:'digital-card@0.1',digest:'sha256:'+'c'.repeat(64),baseURL:'/presentations/sha256:'+'c'.repeat(64)+'/files/'};}); database.close();
    await assert.rejects(backupRecoveryBundle(backupOptions(x,bundle)),/Referenced local presentation is missing/);
    const reset = new SQLiteStore(x.database,{encryptionKey:x.key}); reset.transact(s=>{s.catalog = catalog;}); reset.close();
    await backupRecoveryBundle(backupOptions(x,bundle));
    const member = path.join(bundle,'presentations/content',x.pkg.digest.slice(7),'assets/art.png'),bytes = await readFile(member);
    await writeFile(member,'tampered');
    await assert.rejects(restoreRecoveryBundle(restoreOptions(x,bundle,path.join(x.dir,'tampered'))),/member is missing, changed/);
    const manifestFile = path.join(bundle,'manifest.json'),manifest = JSON.parse(await readFile(manifestFile));
    const entry = manifest.files.find(entry=>entry.path.endsWith('/assets/art.png')); entry.bytes = 8; entry.sha256 = sha(Buffer.from('tampered'));
    await writeFile(manifestFile,JSON.stringify(manifest));
    await assert.rejects(restoreRecoveryBundle(restoreOptions(x,bundle,path.join(x.dir,'rehashed'))),/differs from its archive/);
    await writeFile(member,bytes);
  } finally {await clean(x);}
});

test('interrupted recovery cleans staging, preserves source and never advertises partial installations',async()=>{
  const x = await seed(),bundle = path.join(x.dir,'bundle');
  try {
    await backupRecoveryBundle(backupOptions(x,bundle)); const before = await tree(bundle),destination = path.join(x.dir,'interrupted'),controller = new AbortController();
    const restoring = restoreRecoveryBundle({...restoreOptions(x,bundle,destination),signal:controller.signal});
    const rejected = assert.rejects(restoring,/Interrupted rehearsal/);
    for(let attempt=0;attempt<100;attempt++) {
      if((await readdir(x.dir)).some(name=>name.startsWith('.interrupted.recovery-'))) {controller.abort(new Error('Interrupted rehearsal')); break;}
      await delay(1);
    }
    assert(controller.signal.aborted); await rejected;
    assert(!existsSync(destination)); assert(!(await readdir(x.dir)).some(name=>name.startsWith('.interrupted.recovery-'))); assert.deepEqual(await tree(bundle),before);
    const abandoned = path.join(x.dir,'.abandoned.recovery-stage'); await mkdir(abandoned); await writeFile(path.join(abandoned,'state.sqlite'),'partial');
    await assert.rejects(restoreRecoveryBundle(restoreOptions(x,abandoned,path.join(x.dir,'partial')))); assert(!existsSync(path.join(x.dir,'partial')));
    await restoreRecoveryBundle(restoreOptions(x,bundle,destination)); assert(existsSync(path.join(destination,'state.sqlite')));
  } finally {await clean(x);}
});

test('recovery refuses nested destinations through directory aliases without changing source',async()=>{
  const x = await seed(),bundle = path.join(x.dir,'bundle');
  try {
    const before = await tree(x.presentationRoot),database = await readFile(x.database);
    await assert.rejects(backupRecoveryBundle(backupOptions(x,path.join(x.presentationRoot,'nested'))),/outside the source/);
    const alias = path.join(x.dir,'art-alias');
    await symlink(x.presentationRoot,alias,process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(backupRecoveryBundle(backupOptions(x,path.join(alias,'nested'))),/outside the source/);
    assert.deepEqual(await tree(x.presentationRoot),before); assert.deepEqual(await readFile(x.database),database);
    await backupRecoveryBundle(backupOptions(x,bundle)); const bundleBefore = await tree(bundle),bundleAlias = path.join(x.dir,'bundle-alias');
    await symlink(bundle,bundleAlias,process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(restoreRecoveryBundle(restoreOptions(x,bundle,path.join(bundleAlias,'nested'))),/outside the source/);
    assert.deepEqual(await tree(bundle),bundleBefore);
    await assert.rejects(backupRecoveryBundle({...backupOptions(x,path.join(x.dir,'aliased-source')),presentationRoot:alias}),/ordinary directories/);
  } finally {await clean(x);}
});
