import {Worker} from 'node:worker_threads';
import {deserialize} from 'node:v8';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {FrameworkError} from './catalog.js';
import {frameworkMethods,storeMethods,sessionMethods,frameworkOptionNames,encodeTransport,unavailable} from './framework-worker-contract.js';

const allowed = new Set([...frameworkMethods,...storeMethods,...sessionMethods]);
const cancellationOptions = new Map([['recoverCodeIssuance',2],['dispatchActions',1],['purchaseAsync',2],['commitExternalPurchaseAsync',2],['quoteListingAsync',2],['buyListingAsync',2],['createListingAsync',2],['proposeTradeAsync',2],['counterTradeAsync',2],['acceptTradeAsync',2],['reviewTransferAsync',2],['executeCommandIntentAsync',2]]);
const positive = (value,name) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new FrameworkError('INVALID_INPUT',name+' must be a positive integer');
  return value;
};

/** One worker owns one store. No command is replayed after an uncertain response or worker failure. */
export class FrameworkWorkerService {
  #worker; #state = 'starting'; #pending = new Map(); #bytes = 0; #sequence = 0;
  #maxCount; #maxBytes; #readyResolve; #readyReject; #startupTimer;
  #closePromise; #closeResolve; #closeReject; #closeTimer; #closeSent = false; #closeTimeout;
  constructor({filename = ':memory:',storeOptions = {},frameworkOptions = {},extensionModule,
    extensionOptions = {},codeVaultOptions,sessionOptions,maxPendingRequests = 128,maxPendingBytes = 8 * 1024 * 1024,
    startupTimeoutMs = 30000,closeTimeoutMs = 10000} = {}) {
    this.#maxCount = positive(maxPendingRequests,'maxPendingRequests');
    this.#maxBytes = positive(maxPendingBytes,'maxPendingBytes');
    this.#closeTimeout = positive(closeTimeoutMs,'closeTimeoutMs');
    positive(startupTimeoutMs,'startupTimeoutMs');
    for (const name of Object.keys(frameworkOptions)) if (!frameworkOptionNames.includes(name))
      throw new FrameworkError('INVALID_INPUT','Unknown framework option '+name);
    for (const name of Object.keys(storeOptions)) if (!['encryptionKey','maxStateBytes','maxCompletionBytes','readOnly'].includes(name))
      throw new FrameworkError('INVALID_INPUT','Unsupported worker store option '+name);
    if (sessionOptions !== undefined) {
      encodeTransport(sessionOptions);
      if (!sessionOptions || typeof sessionOptions !== 'object' || Array.isArray(sessionOptions)) throw new FrameworkError('INVALID_INPUT','Session options must be an object');
      if (storeOptions.readOnly) throw new FrameworkError('INVALID_INPUT','Worker sessions require a writable store');
      for (const name of Object.keys(sessionOptions)) if (!['encryptionKey','maxSessions'].includes(name))
        throw new FrameworkError('INVALID_INPUT','Unsupported worker session option '+name);
      if (sessionOptions.maxSessions !== undefined && (!Number.isSafeInteger(sessionOptions.maxSessions) || sessionOptions.maxSessions < 1 || sessionOptions.maxSessions > 1000000))
        throw new FrameworkError('INVALID_INPUT','Session capacity must be a positive bounded integer');
    }
    if (typeof filename !== 'string' || !filename.length) throw new FrameworkError('INVALID_INPUT','A database filename is required');
    if (extensionModule !== undefined && typeof extensionModule !== 'string') throw new FrameworkError('INVALID_INPUT','Trusted module path must be a string');
    const moduleUrl = extensionModule === undefined ? undefined : extensionModule.startsWith('file:') ? new URL(extensionModule).href : pathToFileURL(resolve(extensionModule)).href;
    if (moduleUrl !== undefined && new URL(moduleUrl).protocol !== 'file:') throw new FrameworkError('INVALID_INPUT','Trusted modules must be local files');
    const config = encodeTransport({filename,storeOptions,frameworkOptions,moduleUrl,extensionOptions,codeVaultOptions,sessionOptions});
    if (sessionOptions !== undefined) Object.defineProperty(this,'sessions',{value:Object.freeze({
      create:(kind,data,ttl) => this.invoke('sessionCreate',kind,data,ttl),
      get:(secret,kind,{consume = false} = {}) => this.invoke(consume ? 'sessionConsume' : 'sessionGet',secret,kind),
      revoke:secret => this.invoke('sessionRevoke',secret),
    })});
    this.ready = new Promise((resolveReady,rejectReady) => { this.#readyResolve = resolveReady; this.#readyReject = rejectReady; });
    // Readiness can fail before the host starts awaiting it.
    this.ready.catch(() => {});
    this.#worker = new Worker(new URL('./framework-worker.js',import.meta.url),{workerData:config});
    this.#startupTimer = setTimeout(() => this.#fail(),startupTimeoutMs);
    this.#worker.on('message',message => this.#message(message));
    this.#worker.on('error',() => this.#fail());
    this.#worker.on('exit',() => {
      if (this.#state !== 'closed') this.#fail();
      else { clearTimeout(this.#closeTimer); this.#closeResolve?.(); }
    });
  }
  status() {
    return {state:this.#state,ready:this.#state === 'ready',pendingRequests:this.#pending.size,pendingBytes:this.#bytes,
      maxPendingRequests:this.#maxCount,maxPendingBytes:this.#maxBytes,
      saturated:this.#pending.size >= this.#maxCount || this.#bytes >= this.#maxBytes};
  }
  invoke(method,...args) {
    try { return this.#admit(method,args); } catch (error) { return Promise.reject(error); }
  }
  #admit(method,args) {
    if (!allowed.has(method)) throw new FrameworkError('WORKER_METHOD','Unsupported framework operation',400);
    if (this.#state !== 'ready') throw this.#state === 'starting'
      ? new FrameworkError('WORKER_NOT_READY','Framework worker is starting',503) : unavailable();
    if (this.#pending.size >= this.#maxCount) throw new FrameworkError('WORKER_OVERLOADED','Framework worker admission limit reached',503);
    let signal;
    const optionsIndex=cancellationOptions.get(method);
    if (optionsIndex!==undefined && args[optionsIndex] && Object.hasOwn(args[optionsIndex],'signal')) {
      const options = args[optionsIndex], descriptor = Object.getOwnPropertyDescriptor(options,'signal');
      if (!Object.hasOwn(descriptor,'value') || descriptor.value !== undefined && !(descriptor.value instanceof AbortSignal))
        throw new FrameworkError('WORKER_TRANSPORT','Cancellation requires an AbortSignal');
      signal = descriptor.value;
      const clean = Object.create(Object.getPrototypeOf(options));
      Object.defineProperties(clean,Object.fromEntries(Reflect.ownKeys(options).filter(key => key !== 'signal').map(key => [key,Object.getOwnPropertyDescriptor(options,key)])));
      args = args.map((value,index)=>index===optionsIndex?clean:value);
    }
    const payload = encodeTransport({method,args},this.#maxBytes - this.#bytes);
    if (payload.byteLength > this.#maxBytes - this.#bytes) throw new FrameworkError('WORKER_OVERLOADED','Framework worker input byte limit reached',503);
    const id = ++this.#sequence;
    return new Promise((resolveRequest,rejectRequest) => {
      const cancel = () => { try { this.#worker.postMessage({type:'cancel',id}); } catch { this.#fail(); } };
      const cleanup = () => signal?.removeEventListener('abort',cancel);
      this.#pending.set(id,{resolve:resolveRequest,reject:rejectRequest,bytes:payload.byteLength,cleanup});
      this.#bytes += payload.byteLength;
      try {
        this.#worker.postMessage({type:'request',id,payload,aborted:signal?.aborted === true});
        signal?.addEventListener('abort',cancel,{once:true});
        if (signal?.aborted) cancel();
      } catch { this.#fail(); }
    });
  }
  #message(message) {
    if (message.type === 'ready') {
      if (!['starting','closing'].includes(this.#state)) return;
      clearTimeout(this.#startupTimer);
      if (this.#state === 'starting') this.#state = 'ready';
      this.#readyResolve(this);
      this.#drain();
    } else if (message.type === 'startup-failed') {
      this.#fail(message.error && new FrameworkError(message.error.code,message.error.message,message.error.status));
    } else if (message.type === 'result') {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id); this.#bytes -= pending.bytes; pending.cleanup();
      if (message.error) pending.reject(new FrameworkError(message.error.code,message.error.message,message.error.status));
      else { try { pending.resolve(deserialize(message.payload)); } catch { pending.reject(unavailable()); this.#fail(); } }
      this.#drain();
    } else if (message.type === 'closed' && this.#state === 'closing') {
      this.#state = 'closed';
      // Trusted modules may retain provider handles after their work drains.
      void this.#worker.terminate();
    }
  }
  #fail(error = unavailable()) {
    if (['failed','closed'].includes(this.#state)) return;
    this.#state = 'failed'; clearTimeout(this.#startupTimer); clearTimeout(this.#closeTimer);
    this.#readyReject(error);
    for (const pending of this.#pending.values()) { pending.cleanup(); pending.reject(unavailable()); }
    this.#pending.clear(); this.#bytes = 0;
    this.#closeReject?.(unavailable());
    void this.#worker.terminate();
  }
  #drain() {
    if (this.#state === 'closing' && !this.#pending.size && !this.#closeSent) {
      this.#closeSent = true;
      try { this.#worker.postMessage({type:'close'}); } catch { this.#fail(); }
    }
  }
  close() {
    if (this.#closePromise) return this.#closePromise;
    if (this.#state === 'closed') return Promise.resolve();
    if (this.#state === 'failed') return Promise.reject(unavailable());
    const starting = this.#state === 'starting';
    this.#state = 'closing';
    this.#closePromise = new Promise((resolveClose,rejectClose) => { this.#closeResolve = resolveClose; this.#closeReject = rejectClose; });
    this.#closePromise.catch(() => {});
    this.#closeTimer = setTimeout(() => this.#fail(),this.#closeTimeout);
    if (!starting) this.#drain();
    return this.#closePromise;
  }
  /** Forced shutdown leaves the outcome of outstanding mutations uncertain. */
  async terminate() { this.#fail(); await this.#worker.terminate(); }
}
for (const method of allowed) Object.defineProperty(FrameworkWorkerService.prototype,method,{
  value:function (...args) { return this.invoke(method,...args); },writable:false,configurable:false,
});
