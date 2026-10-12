import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {randomUUID} from 'node:crypto';
import {FrameworkError} from './catalog.js';
import {codeProviderProtocol,validateCodeProviderRequest,validateCodeProviderResponse} from './code-provider-contracts.js';

export {codeProviderProtocol,codeProviderSchema,validateCodeProviderRequest,validateCodeProviderResponse} from './code-provider-contracts.js';
const fail = (code,message,status=502) => {throw new FrameworkError(code,message,status);};
const isObject = value => value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const validId = value => typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const configFailure = () => fail('CODE_PROVIDER_CONFIG','Invalid code status provider configuration',400);
const unavailable = () => fail('CODE_PROVIDER_ERROR','Code status could not be verified; retry later');
const errorStatuses = {'invalid-request':400,'unauthenticated':401,'not-found':404,'rate-limited':429,'unavailable':503};
function parseResponse(raw) {
  const value=JSON.parse(raw),keys=new Set();
  // Replies are flat objects. Decode keys before checking to catch escaped duplicates.
  for(const match of raw.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    if(!/^\s*:/.test(raw.slice(match.index+match[0].length)))continue;
    const key=JSON.parse(match[0]);
    if(keys.has(key))fail('INVALID_PROVIDER','Invalid code status provider response');
    keys.add(key);
  }
  return validateCodeProviderResponse(value);
}

/** Operator-owned endpoint and credential. No receiver code is loaded into the host. */
export function createRemoteCodeProvider(options) {
  if(!isObject(options)||Object.keys(options).some(key=>!['providerId','url','token','allowLoopbackHttp','timeoutMs','maxRequestBytes','maxResponseBytes','maxConcurrent'].includes(key)))configFailure();
  const {providerId,url,token,allowLoopbackHttp=false,timeoutMs=10000,maxRequestBytes=8192,maxResponseBytes=8192,maxConcurrent=8}=options;
  let endpoint;
  if(typeof url!=='string'||url.length>2000)configFailure();
  try{endpoint=new URL(url);}catch{configFailure();}
  const loopback=['127.0.0.1','[::1]','localhost'].includes(endpoint.hostname);
  if(!validId(providerId)||typeof allowLoopbackHttp!=='boolean'||endpoint.username||endpoint.password||endpoint.hash||endpoint.search||!(endpoint.protocol==='https:'||(allowLoopbackHttp&&loopback&&endpoint.protocol==='http:')))configFailure();
  if(typeof token!=='string'||token.length<16||token.length>4096||!/^[\x21-\x7e]+$/.test(token))configFailure();
  for(const [value,max] of [[timeoutMs,120000],[maxRequestBytes,65536],[maxResponseBytes,65536],[maxConcurrent,64]])if(!Number.isSafeInteger(value)||value<1||value>max)configFailure();
  let enabled=true;
  const active=new Set();
  const assertActive=()=>{if(!enabled)fail('CODE_PROVIDER_DISABLED','Code status provider is disabled',503);};
  return Object.freeze({
    providerId,
    assertActive,
    disable(){enabled=false;for(const controller of active)controller.abort();},
    async lookup({providerId:requestedProvider,codeId,externalId,code,signal}) {
      assertActive();
      if(requestedProvider!==providerId)fail('INVALID_PROVIDER_REQUEST','Code status provider identity does not match',400);
      if(signal!==undefined&&!(signal instanceof AbortSignal))fail('CODE_PROVIDER_CONFIG','Cancellation requires an AbortSignal',400);
      if(signal?.aborted)fail('CODE_PROVIDER_ABORTED','Code status lookup was cancelled',503);
      if(active.size>=maxConcurrent)fail('CODE_PROVIDER_BUSY','Code status provider is busy; retry later',503);
      const requestId=randomUUID();
      const body=JSON.stringify(validateCodeProviderRequest({protocol:codeProviderProtocol,operation:'lookup',requestId,providerId,codeId,externalId:externalId??null,code}));
      if(Buffer.byteLength(body)>maxRequestBytes)fail('CODE_PROVIDER_LIMIT','Code status request exceeds configured limit',502);
      const controller=new AbortController();active.add(controller);
      let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
      const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
      try {
        const result=await new Promise((resolve,reject)=>{
          const transport=endpoint.protocol==='https:'?httpsRequest:httpRequest;
          const req=transport(endpoint,{method:'POST',signal:controller.signal,maxHeaderSize:8192,headers:{'content-type':'application/json','accept':'application/json','authorization':'Bearer '+token,'content-length':Buffer.byteLength(body),'cache-control':'no-store'}},async response=>{
            try {
              if(![200,...Object.values(errorStatuses)].includes(response.statusCode)||!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type']??''))fail('INVALID_PROVIDER','Invalid code status provider response');
              if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')fail('INVALID_PROVIDER','Invalid code status provider response');
              if(response.headers['content-length']&&(Number(response.headers['content-length'])>maxResponseBytes||!/^\d+$/.test(response.headers['content-length'])))fail('CODE_PROVIDER_LIMIT','Code status response exceeds configured limit');
              const chunks=[];let total=0;
              for await(const chunk of response){total+=chunk.length;if(total>maxResponseBytes)fail('CODE_PROVIDER_LIMIT','Code status response exceeds configured limit');chunks.push(chunk);}
              const value=parseResponse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
              if(value.providerId!==providerId||value.requestId!==requestId||value.codeId!==codeId||response.statusCode!==(value.status==='error'?errorStatuses[value.errorCode]:200))fail('INVALID_PROVIDER','Code status provider response does not match lookup');
              if(value.status==='error')unavailable();
              resolve(value);
            }catch(error){response.destroy();reject(error);}
          });
          req.on('error',reject);req.end(body);
        });
        assertActive();
        if(controller.signal.aborted)fail('CODE_PROVIDER_ABORTED','Code status lookup was cancelled',503);
        return result.status==='unknown'?{codeId,status:'unknown'}:{codeId,status:result.status,eventId:result.eventId,occurredAt:result.occurredAt};
      }catch(error){
        assertActive();
        if(timedOut)fail('PROVIDER_TIMEOUT','Code status is still unverified; retry later',504);
        if(controller.signal.aborted)fail('CODE_PROVIDER_ABORTED','Code status lookup was cancelled',503);
        if(error instanceof FrameworkError)throw error;
        unavailable();
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);active.delete(controller);controller.abort();}
    },
  });
}

/** Merge host adapters and data-only endpoint configuration without identity shadowing. */
export function createCodeProviderRegistry({codeProviders={},codeProviderEndpoints={}}={}) {
  if(!isObject(codeProviders)||!isObject(codeProviderEndpoints))configFailure();
  const providers=Object.create(null),remote=new Map();
  if(Object.keys(codeProviders).length+Object.keys(codeProviderEndpoints).length>100)configFailure();
  for(const [id,provider] of Object.entries(codeProviders)) {
    if(!validId(id)||typeof provider?.lookup!=='function'||(provider.providerId!==undefined&&provider.providerId!==id))configFailure();
    providers[id]=provider;
  }
  for(const [id,config] of Object.entries(codeProviderEndpoints)) {
    if(!validId(id)||Object.hasOwn(providers,id)||!isObject(config)||(config.providerId!==undefined&&config.providerId!==id))configFailure();
    const provider=createRemoteCodeProvider({...config,providerId:id});providers[id]=provider;remote.set(id,provider);
  }
  return Object.freeze({providers:Object.freeze(providers),disable(providerId){if(!remote.has(providerId))configFailure();remote.get(providerId).disable();},close(){for(const provider of remote.values())provider.disable();}});
}
