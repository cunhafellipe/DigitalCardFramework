import {parentPort,workerData} from 'node:worker_threads';
import {deserialize} from 'node:v8';
import {CardFramework} from './core.js';
import {SQLiteStore} from './sqlite.js';
import {createCodeVault} from './code-vault.js';
import {FrameworkError} from './catalog.js';
import {SessionStore} from './auth.js';
import {frameworkMethods,frameworkOptionNames,encodeTransport,serializeError} from './framework-worker-contract.js';

let framework,store,sessions,closing = false;
const active = new Map();
try {
  const config = deserialize(workerData);
  let extensions = {};
  if (config.moduleUrl) {
    const module = await import(config.moduleUrl);
    if (Object.hasOwn(module,'createFrameworkOptions')) {
      if (typeof module.createFrameworkOptions !== 'function') throw new FrameworkError('INVALID_INPUT','Trusted module factory must be a function');
      extensions = await module.createFrameworkOptions(config.extensionOptions);
      if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) throw new FrameworkError('INVALID_INPUT','Trusted module factory must return framework options');
      for (const name of Object.keys(extensions)) if (!frameworkOptionNames.includes(name)) throw new FrameworkError('INVALID_INPUT','Unknown trusted framework option '+name);
    } else {
      if (Object.keys(config.extensionOptions).length) throw new FrameworkError('INVALID_INPUT','Trusted module options require createFrameworkOptions');
      extensions = Object.fromEntries(frameworkOptionNames.filter(name => Object.hasOwn(module,name)).map(name => [name,module[name]]));
    }
  }
  if (config.codeVaultOptions && (extensions.codeVault !== undefined || config.frameworkOptions.codeVault !== undefined))
    throw new FrameworkError('INVALID_INPUT','Configure the code vault once');
  store = new SQLiteStore(config.filename,config.storeOptions);
  const options = {...config.frameworkOptions,...extensions,
    limits:{...config.frameworkOptions.limits,...extensions.limits},
    ...(config.codeVaultOptions ? {codeVault:createCodeVault(config.codeVaultOptions)} : {}),store};
  framework = new CardFramework(options);
  if (config.sessionOptions !== undefined) sessions = new SessionStore(config.filename,config.sessionOptions);
  // Capture the reviewed dispatch targets once; never resolve arbitrary properties from an incoming method.
  const commands = new Map(frameworkMethods.map(method => [method,CardFramework.prototype[method].bind(framework)]));
  commands.set('storeIntegrity',() => store.integrity());
  commands.set('storeDiagnostics',() => store.diagnostics());
  commands.set('prepareRecordTransactions',options => store.prepareRecordTransactions(options));
  commands.set('runtimeCapabilities',() => ({
    bindingFactories:Object.keys(options.bindings ?? {}).filter(name => typeof options.bindings[name] === 'function'),
    actionHandlers:Object.values(options.actionHandlers ?? {}).some(handler => typeof handler === 'function'),
    codeVault:!!options.codeVault,
  }));
  if (sessions) {
    commands.set('sessionCreate',(kind,data,ttl) => sessions.create(kind,data,ttl));
    commands.set('sessionGet',(secret,kind) => sessions.get(secret,kind));
    commands.set('sessionConsume',(secret,kind) => sessions.get(secret,kind,{consume:true}));
    commands.set('sessionRevoke',secret => sessions.revoke(secret));
  }
  parentPort.on('message',message => {
    if (message.type === 'cancel') { active.get(message.id)?.abort(); return; }
    if (message.type === 'close') {
      closing = true;
      if (active.size) return;
      try { try { sessions?.close(); } finally { framework.close(); } parentPort.postMessage({type:'closed'}); parentPort.close(); }
      catch { parentPort.close(); process.exitCode = 1; }
      return;
    }
    if (message.type !== 'request') return;
    void (async () => {
      let response;
      const controller = new AbortController();
      active.set(message.id,controller);
      try {
        if (closing) throw new FrameworkError('WORKER_UNAVAILABLE','Framework worker is closing',503);
        const {method,args} = deserialize(message.payload);
        if (!commands.has(method)) throw new FrameworkError('WORKER_METHOD','Unsupported framework operation');
        if (['recoverCodeIssuance','dispatchActions','purchaseAsync','commitExternalPurchaseAsync','quoteListingAsync','buyListingAsync','createListingAsync','proposeTradeAsync','counterTradeAsync','acceptTradeAsync','reviewTransferAsync','executeCommandIntentAsync'].includes(method)) {
          if (message.aborted) controller.abort();
          const index=method==='dispatchActions'?1:2;
          args[index] = {...args[index],signal:controller.signal};
        }
        response = {payload:encodeTransport(await commands.get(method)(...args))};
      } catch (error) { response = {error:serializeError(error)}; }
      finally { active.delete(message.id); }
      parentPort.postMessage({type:'result',id:message.id,...response});
    })();
  });
  parentPort.postMessage({type:'ready'});
} catch (error) {
  try { sessions?.close(); } catch {}
  try { store?.close(); } catch {}
  parentPort.postMessage({type:'startup-failed',error:serializeError(error)});
  parentPort.close();
}
