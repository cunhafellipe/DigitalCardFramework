import {mkdir, mkdtemp, readdir, lstat, realpath, readFile, writeFile, copyFile, rename, rm, open, chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync, backup} from 'node:sqlite';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {SQLiteStore} from '../src/sqlite.js';
import {CardFramework} from '../src/core.js';
import {auditState} from '../src/audit.js';
import {createStateCodec} from '../src/encryption.js';
import {importPackage} from '../src/presentation/package.js';
import {validatePresentationReference} from '../src/presentation/integration.js';
import {stoppedDatabaseCopy, temporaryDatabase} from './database-copy.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => {throw new Error(message);};
const parse = bytes => {try {return JSON.parse(bytes);} catch {fail('Invalid JSON in recovery input');}};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digestName = /^[a-f0-9]{64}$/;
const absent = async file => {try {await lstat(file); return false;} catch(error) {if(error.code === 'ENOENT') return true; throw error;}};
const checkSignal = signal => signal?.throwIfAborted();
function safeRelative(name) {
  if(typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || name.split('/').some(p => !p || p === '.' || p === '..' || /[\x00-\x1f]/.test(p))) fail('Unsafe recovery member path');
  return name;
}
async function directory(file) {
  const info = await lstat(file);
  if(!info.isDirectory() || info.isSymbolicLink()) fail('Recovery paths must be ordinary directories');
}
async function inventory(root, signal) {
  await directory(root);
  const out = [];
  async function walk(relative) {
    for(const name of (await readdir(path.join(root,relative))).sort()) {
      checkSignal(signal);
      const member = safeRelative(relative ? relative+'/'+name : name), info = await lstat(path.join(root,member));
      if(info.isSymbolicLink()) fail('Recovery refuses symbolic links');
      if(info.isDirectory()) await walk(member);
      else if(info.isFile()) {const bytes = await readFile(path.join(root,member)); out.push({path:member,bytes:bytes.length,sha256:hash(bytes)});}
      else fail('Recovery refuses special files');
    }
  }
  await walk('');
  return out;
}
async function copyMembers(source, target, members, signal) {
  for(const member of members) {
    checkSignal(signal);
    const dest = path.join(target,safeRelative(member.path));
    await mkdir(path.dirname(dest),{recursive:true,mode:0o700});
    await copyFile(path.join(source,member.path),dest);
    await chmod(dest,0o600);
  }
}
async function newStage(destination, sources, signal) {
  checkSignal(signal);
  destination = path.resolve(destination);
  if(!await absent(destination)) fail('Recovery destination must be a new path');
  const parent = await realpath(path.dirname(destination)), actualDestination = path.join(parent,path.basename(destination));
  for(const source of sources) {
    const relative = path.relative(await realpath(source),actualDestination);
    if(relative === '' || (!relative.startsWith('..'+path.sep) && relative !== '..' && !path.isAbsolute(relative))) fail('Recovery destination must be outside the source');
  }
  await directory(path.dirname(destination));
  const stage = await mkdtemp(path.join(path.dirname(destination),'.'+path.basename(destination)+'.recovery-'));
  await chmod(stage,0o700);
  return {destination,stage};
}
async function expose(stage,destination,signal) {
  checkSignal(signal);
  if(!await absent(destination)) fail('Recovery destination must be a new path');
  await rename(stage,destination);
}
function references(state, available, origin) {
  const found = new Map();
  function walk(value) {
    if(!value || typeof value !== 'object') return;
    if(value.contract === 'digital-card@0.1' && Object.hasOwn(value,'digest') && Object.hasOwn(value,'baseURL')) {
      validatePresentationReference(value);
      const local = available.has(value.digest), url = new URL(value.baseURL,'https://recovery.invalid/');
      const routed = url.pathname === '/presentations/'+value.digest+'/files/' && (url.origin === 'https://recovery.invalid' || url.origin === origin);
      if(routed && !local) fail('Referenced local presentation is missing');
      const reference = {...value,storage:local ? 'included' : 'external'};
      found.set(JSON.stringify(reference),reference);
    }
    for(const child of Object.values(value)) walk(child);
  }
  walk(state);
  return [...found.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
async function validateDatabase(filename, {encryptionKey,codeVault}, signal) {
  if(!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) fail('STATE_ENCRYPTION_KEY is required for recovery');
  checkSignal(signal);
  const temporary = temporaryDatabase();
  try {
    await copyFile(filename,temporary.path);
    const store = new SQLiteStore(temporary.path,{encryptionKey});
    let core, state, audit, codes;
    try {
      core = new CardFramework({store,codeVault});
      state = store.read(s=>s); audit = auditState(state);
      if(!store.integrity() || !audit.ok) fail('Recovery database verification failed');
      codes = core.verifyCodeVault({role:'admin'}).count;
    } finally {if(core) core.close(); else store.close();}
    // Inspect every payload, including expired flows; no session allocation or cleanup.
    const db = new DatabaseSync(temporary.path,{readOnly:true}), codec = createStateCodec(encryptionKey);
    let sessions = 0;
    try {
      if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_sessions'").get()) {
        for(const row of db.prepare('SELECT digest,kind,expires,payload FROM auth_sessions').all()) {
          if(!digestName.test(row.digest) || !['session','flow'].includes(row.kind) || !Number.isSafeInteger(row.expires)) fail('Recovery session verification failed');
          codec.decode(row.payload); sessions++;
        }
      }
    } finally {db.close();}
    return {state,audit:{...audit.counts,revision:state.revision,sessions,codes}};
  } finally {temporary.close();}
}
async function validatePresentations(root, {sourceRoot,signal} = {}) {
  await directory(root);
  const names = (await readdir(root)).filter(name=>name !== 'writer.lock').sort();
  if(!isDeepStrictEqual(names,['content','jobs','quarantine'])) fail('Presentation root must contain only content, jobs and quarantine directories after shutdown');
  for(const name of names) await directory(path.join(root,name));
  const available = new Set();
  for(const name of (await readdir(path.join(root,'content'))).sort()) {
    checkSignal(signal);
    if(!digestName.test(name)) fail('Incomplete or unknown presentation publication; finish shutdown before recovery');
    const folder = path.join(root,'content',name), members = await inventory(folder,signal);
    const pkg = await importPackage(new Uint8Array(await readFile(path.join(folder,'download.dcard'))));
    if(pkg.digest !== 'sha256:'+name) fail('Published presentation digest differs');
    const expected = new Set(['download.dcard','build-report.json',...pkg.files.keys()]);
    for(const member of members) {
      if(!expected.has(member.path) && member.path !== 'availability.json') fail('Unknown published presentation member');
      if(pkg.files.has(member.path) && !Buffer.from(pkg.files.get(member.path)).equals(await readFile(path.join(folder,member.path)))) fail('Published presentation member differs from its archive');
      expected.delete(member.path);
    }
    if(expected.size) fail('Published presentation member is missing');
    const report = parse(await readFile(path.join(folder,'build-report.json'),'utf8'));
    if(report.digest !== pkg.digest) fail('Published build report differs');
    if(!await absent(path.join(folder,'availability.json'))) {
      const policy = parse(await readFile(path.join(folder,'availability.json'),'utf8'));
      if(!['available','quarantined'].includes(policy.state) || typeof policy.reason !== 'string' || !Number.isSafeInteger(policy.at)) fail('Invalid presentation availability policy');
    }
    available.add(pkg.digest);
  }
  const uploads = new Map();
  for(const name of await readdir(path.join(root,'quarantine'))) {
    if(!name.endsWith('.dcard') || !uuid.test(name.slice(0,-6))) fail('Unknown quarantine member');
    const file = path.join(root,'quarantine',name), info = await lstat(file);
    if(!info.isFile() || info.isSymbolicLink()) fail('Invalid quarantine member');
    uploads.set(name,hash(await readFile(file)));
  }
  const jobs = [], keys = new Set();
  for(const name of (await readdir(path.join(root,'jobs'))).sort()) {
    checkSignal(signal);
    const file = path.join(root,'jobs',name), info = await lstat(file);
    if(!info.isFile() || info.isSymbolicLink() || !name.endsWith('.json') || !uuid.test(name.slice(0,-5))) fail('Unknown import job member');
    const job = parse(await readFile(file,'utf8'));
    if(job.id !== name.slice(0,-5) || typeof job.actor !== 'string' || typeof job.key !== 'string' || !digestName.test(job.uploadHash)) fail('Invalid import job');
    const key = JSON.stringify([job.actor,job.key]);
    if(keys.has(key)) fail('Duplicate import job key'); keys.add(key);
    if(['received','validating','compiling'].includes(job.state)) fail('Import work is still in flight; drain and stop the presentation service');
    if(!['ready','published','rejected','cancelled'].includes(job.state)) fail('Invalid import job state');
    if(uploads.get(job.id+'.dcard') !== job.uploadHash) fail('Import upload is missing or differs');
    if(typeof job.uploadPath !== 'string' || (sourceRoot && path.resolve(job.uploadPath) !== path.join(path.resolve(sourceRoot),'quarantine',job.id+'.dcard'))) fail('Import upload path differs from its owned quarantine path');
    if(['ready','published'].includes(job.state)) {
      const pkg = await importPackage(new Uint8Array(await readFile(path.join(root,'quarantine',job.id+'.dcard'))));
      if(job.digest !== pkg.digest || (job.state === 'published' && !available.has(job.digest))) fail('Import publication reference is missing or differs');
    }
    jobs.push(job);
  }
  return {available,jobs};
}
async function preparePresentationRoot(root) {
  await mkdir(root,{mode:0o700});
  for(const name of ['content','jobs','quarantine']) await mkdir(path.join(root,name),{mode:0o700});
}
const excluded = ['encryption-keys','host-configuration','remote-assets','external-provider-state'];

/** Offline recovery requires all framework writers stopped and presentation imports drained. */
export async function backupRecoveryBundle({database,presentationRoot,destination,encryptionKey,codeVault,siteOrigin=null,signal}) {
  database = path.resolve(database); presentationRoot = path.resolve(presentationRoot);
  const databaseInfo = await lstat(database);
  if(!databaseInfo.isFile() || databaseInfo.isSymbolicLink()) fail('Recovery database must be an ordinary file');
  await directory(presentationRoot);
  if(siteOrigin !== null && new URL(siteOrigin).origin !== siteOrigin) fail('SITE_ORIGIN must be an exact origin');
  const {stage,destination:target} = await newStage(destination,[database,presentationRoot],signal);
  let lock, original;
  try {
    try {lock = await open(path.join(presentationRoot,'writer.lock'),'wx',0o600);} catch(error) {if(error.code === 'EEXIST') fail('Presentation writer lock exists; drain and stop the service first'); throw error;}
    original = stoppedDatabaseCopy(database);
    const before = await inventory(presentationRoot,signal), members = before.filter(member=>member.path !== 'writer.lock');
    const art = await validatePresentations(presentationRoot,{sourceRoot:presentationRoot,signal});
    const db = new DatabaseSync(original.path);
    try {await backup(db,path.join(stage,'state.sqlite'));} finally {db.close();}
    await chmod(path.join(stage,'state.sqlite'),0o600);
    const verified = await validateDatabase(path.join(stage,'state.sqlite'),{encryptionKey,codeVault},signal);
    await preparePresentationRoot(path.join(stage,'presentations'));
    await copyMembers(presentationRoot,path.join(stage,'presentations'),members,signal);
    await validatePresentations(path.join(stage,'presentations'),{signal});
    const manifest = {format:'digital-card.recovery',version:1,mode:'stopped',siteOrigin,excluded,audit:verified.audit,presentations:[...art.available].sort(),references:references(verified.state,art.available,siteOrigin),files:await inventory(stage,signal)};
    await writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    original.verify();
    if(!isDeepStrictEqual(before,await inventory(presentationRoot,signal))) fail('Presentation source changed; stop all writers and retry');
    await expose(stage,target,signal);
    return {ok:true,...verified.audit,presentations:art.available.size,jobs:art.jobs.length,externalReferences:manifest.references.filter(ref=>ref.storage === 'external').length};
  } finally {
    original?.close();
    if(lock) {await lock.close(); await rm(path.join(presentationRoot,'writer.lock'));}
    await rm(stage,{recursive:true,force:true});
  }
}

export async function restoreRecoveryBundle({bundle,destination,encryptionKey,codeVault,signal}) {
  bundle = path.resolve(bundle);
  await directory(bundle);
  const {stage,destination:target} = await newStage(destination,[bundle],signal);
  try {
    const before = await inventory(bundle,signal), manifest = parse(await readFile(path.join(bundle,'manifest.json'),'utf8'));
    if(manifest.format !== 'digital-card.recovery' || manifest.version !== 1 || manifest.mode !== 'stopped' || !isDeepStrictEqual(manifest.excluded,excluded) || !Array.isArray(manifest.files)) fail('Unsupported recovery manifest');
    const actual = before.filter(member=>member.path !== 'manifest.json');
    if(!isDeepStrictEqual(actual,manifest.files)) fail('Recovery bundle member is missing, changed or unexpected');
    if(actual.some(member=>member.path !== 'state.sqlite' && !member.path.startsWith('presentations/'))) fail('Unexpected recovery bundle member');
    const verified = await validateDatabase(path.join(bundle,'state.sqlite'),{encryptionKey,codeVault},signal);
    const art = await validatePresentations(path.join(bundle,'presentations'),{signal});
    if(!isDeepStrictEqual(manifest.audit,verified.audit) || !isDeepStrictEqual(manifest.presentations,[...art.available].sort()) || !isDeepStrictEqual(manifest.references,references(verified.state,art.available,manifest.siteOrigin))) fail('Recovery manifest does not match its database and presentations');
    await preparePresentationRoot(path.join(stage,'presentations'));
    await copyMembers(bundle,stage,actual,signal);
    for(const job of art.jobs) {
      job.uploadPath = path.join(target,'presentations','quarantine',job.id+'.dcard');
      await writeFile(path.join(stage,'presentations','jobs',job.id+'.json'),JSON.stringify(job)+'\n',{mode:0o600});
    }
    // Validate rewritten paths against the final installation before making it visible.
    await validatePresentations(path.join(stage,'presentations'),{sourceRoot:path.join(target,'presentations'),signal});
    if(!isDeepStrictEqual(before,await inventory(bundle,signal))) fail('Recovery bundle changed during restore');
    await expose(stage,target,signal);
    return {ok:true,...verified.audit,presentations:art.available.size,jobs:art.jobs.length};
  } finally {await rm(stage,{recursive:true,force:true});}
}
