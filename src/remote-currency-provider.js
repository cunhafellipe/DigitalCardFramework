import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {randomUUID} from 'node:crypto';
import {FrameworkError} from './catalog.js';
import {currencyProviderProtocol,validateCurrencyProviderRequest,validateCurrencyProviderResponse} from './currency-provider-contracts.js';

export {currencyProviderProtocol,currencyProviderSchema,validateCurrencyProviderRequest,validateCurrencyProviderResponse} from './currency-provider-contracts.js';
const fail = (code,message,status=502) => {throw new FrameworkError(code,message,status);};
const isObject = value => value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const validId = value => typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}(?![\s\S])/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const configFailure = () => fail('CURRENCY_PROVIDER_CONFIG','Invalid currency provider configuration',400);
const unavailable = () => fail('CURRENCY_PROVIDER_ERROR','External funds could not be verified; retry later');
const errorStatuses = {'invalid-request':400,'unauthenticated':401,'not-found':404,'rate-limited':429,'unavailable':503};
function parseResponse(raw) {
  const value=JSON.parse(raw),keys=new Set();
  // Responses are flat; decode keys to reject escaped duplicates too.
  for(const match of raw.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    if(!/^\s*:/.test(raw.slice(match.index+match[0].length)))continue;
    const key=JSON.parse(match[0]);
    if(keys.has(key))fail('INVALID_PROVIDER','Invalid currency provider response');
    keys.add(key);
  }
  return validateCurrencyProviderResponse(value);
}
function currencyMappings(value) {
  if(!isObject(value)||Object.keys(value).length<1||Object.keys(value).length>100)configFailure();
  const result=Object.create(null);
  for(const [currency,mapping] of Object.entries(value)) {
    if(!validId(currency)||!isObject(mapping)||Object.keys(mapping).some(key=>!['currencyId','numerator','denominator'].includes(key))||!validId(mapping.currencyId))configFailure();
    for(const key of ['numerator','denominator'])if(mapping[key]!==undefined&&(!Number.isSafeInteger(mapping[key])||mapping[key]<1))configFailure();
    result[currency]=Object.freeze({...mapping});
  }
  return Object.freeze(result);
}

/** Operator-owned endpoint, credential and conversion mappings; no provider code is loaded. */
export function createRemoteCurrencyProvider(options) {
  if(!isObject(options)||Object.keys(options).some(key=>!['providerId','url','token','currencies','allowLoopbackHttp','timeoutMs','maxRequestBytes','maxResponseBytes','maxConcurrent'].includes(key)))configFailure();
  const {providerId,url,token,currencies,allowLoopbackHttp=false,timeoutMs=10000,maxRequestBytes=8192,maxResponseBytes=8192,maxConcurrent=8}=options;
  let endpoint;
  if(typeof url!=='string'||url.length>2000)configFailure();
  try{endpoint=new URL(url);}catch{configFailure();}
  const loopback=['127.0.0.1','[::1]','localhost'].includes(endpoint.hostname);
  if(!validId(providerId)||typeof allowLoopbackHttp!=='boolean'||endpoint.username||endpoint.password||endpoint.hash||endpoint.search||!(endpoint.protocol==='https:'||(allowLoopbackHttp&&loopback&&endpoint.protocol==='http:')))configFailure();
  if(typeof token!=='string'||token.length<16||token.length>4096||!/^[\x21-\x7e]+$/.test(token))configFailure();
  for(const [value,max] of [[timeoutMs,120000],[maxRequestBytes,65536],[maxResponseBytes,65536],[maxConcurrent,64]])if(!Number.isSafeInteger(value)||value<1||value>max)configFailure();
  const mappings=currencyMappings(currencies);
  let enabled=true;
  const active=new Set();
  const assertActive=()=>{if(!enabled)fail('CURRENCY_PROVIDER_DISABLED','Currency provider is disabled',503);};
  async function exchange(operation,fields,signal) {
    assertActive();
    if(signal?.aborted)fail('CURRENCY_PROVIDER_ABORTED','Currency verification was cancelled',503);
    if(active.size>=maxConcurrent)fail('CURRENCY_PROVIDER_BUSY','Currency provider is busy; retry later',503);
    const requestId=randomUUID();
    const request=validateCurrencyProviderRequest({protocol:currencyProviderProtocol,operation,requestId,providerId,...fields});
    const body=JSON.stringify(request);
    if(Buffer.byteLength(body)>maxRequestBytes)fail('CURRENCY_PROVIDER_LIMIT','Currency request exceeds configured limit');
    const controller=new AbortController();active.add(controller);
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    try {
      const result=await new Promise((resolve,reject)=>{
        const transport=endpoint.protocol==='https:'?httpsRequest:httpRequest;
        const req=transport(endpoint,{method:'POST',signal:controller.signal,maxHeaderSize:8192,headers:{'content-type':'application/json','accept':'application/json','authorization':'Bearer '+token,'content-length':Buffer.byteLength(body),'cache-control':'no-store'}},async response=>{
          try {
            if(![200,...Object.values(errorStatuses)].includes(response.statusCode)||!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type']??''))fail('INVALID_PROVIDER','Invalid currency provider response');
            if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')fail('INVALID_PROVIDER','Invalid currency provider response');
            if(response.headers['content-length']&&(Number(response.headers['content-length'])>maxResponseBytes||!/^\d+$/.test(response.headers['content-length'])))fail('CURRENCY_PROVIDER_LIMIT','Currency response exceeds configured limit');
            const chunks=[];let total=0;
            for await(const chunk of response){total+=chunk.length;if(total>maxResponseBytes)fail('CURRENCY_PROVIDER_LIMIT','Currency response exceeds configured limit');chunks.push(chunk);}
            const value=parseResponse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
            if(['protocol','operation','providerId','requestId',...Object.keys(fields)].some(key=>value[key]!==request[key])||response.statusCode!==(value.status==='error'?errorStatuses[value.errorCode]:200))fail('INVALID_PROVIDER','Currency provider response does not match request');
            if(value.status==='error')unavailable();
            resolve(value);
          }catch(error){response.destroy();reject(error);}
        });
        req.on('error',reject);req.end(body);
      });
      assertActive();
      if(controller.signal.aborted)fail('CURRENCY_PROVIDER_ABORTED','Currency verification was cancelled',503);
      return result;
    }catch(error){
      assertActive();
      if(timedOut)fail('PROVIDER_TIMEOUT','External funds are still unverified; retry later',504);
      if(controller.signal.aborted)fail('CURRENCY_PROVIDER_ABORTED','Currency verification was cancelled',503);
      if(error instanceof FrameworkError)throw error;
      unavailable();
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);active.delete(controller);controller.abort();}
  }
  return Object.freeze({
    providerId,currencies:mappings,assertActive,
    disable(){enabled=false;for(const controller of active)controller.abort();},
    async resolveAccount({userId,signal}) {
      return (await exchange('resolve-account',{userId},signal)).account;
    },
    async lookup({transactionId,account,signal}) {
      const result=await exchange('lookup',{transactionId,account},signal);
      return result.status==='settled'?{transactionId,account,status:'settled',currency:result.currency,amountUnits:result.amountUnits}:{transactionId,account,status:result.status};
    },
  });
}

/** Merge direct adapters and configured endpoints without replacing an existing provider. */
export function createCurrencyProviderRegistry({currencyProviders={},currencyProviderEndpoints={}}={}) {
  if(!isObject(currencyProviders)||!isObject(currencyProviderEndpoints))configFailure();
  const providers=Object.create(null),remote=new Map();
  if(Object.keys(currencyProviders).length+Object.keys(currencyProviderEndpoints).length>100)configFailure();
  for(const [id,provider] of Object.entries(currencyProviders)) {
    if(!validId(id)||typeof provider?.resolveAccount!=='function'||typeof provider?.lookup!=='function'||(provider.providerId!==undefined&&provider.providerId!==id))configFailure();
    providers[id]=provider;
  }
  for(const [id,config] of Object.entries(currencyProviderEndpoints)) {
    if(!validId(id)||Object.hasOwn(providers,id)||!isObject(config)||(config.providerId!==undefined&&config.providerId!==id))configFailure();
    const provider=createRemoteCurrencyProvider({...config,providerId:id});providers[id]=provider;remote.set(id,provider);
  }
  return Object.freeze({providers:Object.freeze(providers),disable(providerId){if(!remote.has(providerId))configFailure();remote.get(providerId).disable();},close(){for(const provider of remote.values())provider.disable();}});
}
