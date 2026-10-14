import {readFile} from 'node:fs/promises';
import {keyFromHex} from '../src/encryption.js';
import {createCodeVault} from '../src/code-vault.js';
import {backupRecoveryBundle,restoreRecoveryBundle} from './recovery-bundle.js';

const [command,...args] = process.argv.slice(2);
if((command === 'backup' && (args.length !== 4 || args[3] !== '--stopped')) || (command === 'restore' && (args.length !== 3 || args[2] !== '--stopped')) || !['backup','restore'].includes(command)) throw new Error('Usage: node tools/recovery.js backup database.sqlite presentation-root new-bundle --stopped | restore bundle new-installation --stopped');
const secret = async name => process.env[name+'_FILE'] ? (await readFile(process.env[name+'_FILE'],'utf8')).trim() : process.env[name];
const encryptionKey = keyFromHex(await secret('STATE_ENCRYPTION_KEY'));
const codeKeys = await secret('CODE_VAULT_KEYS');
let parsedKeys;
if(codeKeys) {try {parsedKeys = JSON.parse(codeKeys);} catch {throw new Error('CODE_VAULT_KEYS must be a JSON key map');}}
const codeVault = codeKeys ? createCodeVault({activeKeyId:process.env.CODE_ACTIVE_KEY_ID,keys:Object.fromEntries(Object.entries(parsedKeys).map(([id,key])=>[id,keyFromHex(key)])),indexKey:keyFromHex(await secret('CODE_INDEX_KEY'))}) : undefined;
const controller = new AbortController();
const interrupt = () => controller.abort(new Error('Recovery interrupted; destination was not published'));
process.once('SIGINT',interrupt); process.once('SIGTERM',interrupt);
try {
  const options = {encryptionKey,codeVault,signal:controller.signal};
  const result = command === 'backup'
    ? await backupRecoveryBundle({...options,database:args[0],presentationRoot:args[1],destination:args[2],siteOrigin:process.env.SITE_ORIGIN??null})
    : await restoreRecoveryBundle({...options,bundle:args[0],destination:args[1]});
  console.log(JSON.stringify(result));
} finally {process.removeListener('SIGINT',interrupt); process.removeListener('SIGTERM',interrupt);}
