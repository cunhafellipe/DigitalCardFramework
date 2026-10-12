import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {randomUUID} from 'node:crypto';
import {FrameworkError} from './catalog.js';

const fail=(code,message,status=502)=>{throw new FrameworkError(code,message,status);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}(?![\s\S])/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const configFailure=()=>fail('POLICY_CONFIG','Invalid remote policy configuration',400);
const unavailable=()=>fail('POLICY_UNAVAILABLE','Policy eligibility could not be verified; retry later',503);
const errorStatuses={'invalid-request':400,unauthenticated:401,'rate-limited':429,unavailable:503};
function parseResponse(raw,validateResponse){
  const value=JSON.parse(raw),keys=new Set();
  for(const match of raw.matchAll(/"(?:[^"\\]|\\.)*"/g)){
    if(!/^\s*:/.test(raw.slice(match.index+match[0].length)))continue;
    const key=JSON.parse(match[0]);if(keys.has(key))fail('INVALID_POLICY_RESPONSE','Invalid remote policy response');keys.add(key);
  }
  return validateResponse(value);
}

/** The owning framework controls the live grant and may revoke it during evaluation. */
export function createRemotePolicyTransport(options,{validateRequest,validateResponse,scope:expectedScope='listing',requestBytes=65536}){
  if(!plain(options)||Object.keys(options).some(key=>!['scope','providerId','url','token','allowLoopbackHttp','timeoutMs','maxRequestBytes','maxResponseBytes','maxConcurrent'].includes(key)))configFailure();
  const {scope,providerId,url,token,allowLoopbackHttp=false,timeoutMs=10000,maxRequestBytes=requestBytes,maxResponseBytes=8192,maxConcurrent=8}=options;
  if(scope!==expectedScope)fail('POLICY_UNSUPPORTED','Remote policy scope is unsupported',400);
  let endpoint;if(typeof url!=='string'||url.length>2000)configFailure();try{endpoint=new URL(url);}catch{configFailure();}
  const loopback=['127.0.0.1','[::1]','localhost'].includes(endpoint.hostname);
  if(!validId(providerId)||typeof allowLoopbackHttp!=='boolean'||endpoint.username||endpoint.password||endpoint.hash||endpoint.search||!(endpoint.protocol==='https:'||(allowLoopbackHttp&&loopback&&endpoint.protocol==='http:')))configFailure();
  if(typeof token!=='string'||token.length<16||token.length>4096||!/^[\x21-\x7e]+$/.test(token))configFailure();
  for(const [value,max]of [[timeoutMs,120000],[maxRequestBytes,requestBytes],[maxResponseBytes,65536],[maxConcurrent,64]])if(!Number.isSafeInteger(value)||value<1||value>max)configFailure();
  const grantId=randomUUID(),active=new Set();let generation=1,enabled=true,closed=false;
  const assertActive=()=>{if(!enabled||closed)fail('POLICY_DISABLED','Remote policy is disabled',503);};
  const assertGrant=(grant)=>{assertActive();if(grant.grantId!==grantId||grant.generation!==generation||grant.providerId!==providerId)fail('POLICY_STALE','Remote policy grant changed; review again',409);};
  const setEnabled=value=>{
    if(typeof value!=='boolean'||closed)configFailure();
    if(enabled!==value){generation++;enabled=value;for(const controller of active)controller.abort();}
    return {providerId,scope,enabled,generation};
  };
  return Object.freeze({
    providerId,timeoutMs,
    grant(){assertActive();return Object.freeze({providerId,grantId,generation});},assertGrant,setEnabled,
    close(){closed=true;enabled=false;generation++;for(const controller of active)controller.abort();},
    async evaluate(request,{signal}={}){
      assertGrant(request);validateRequest(request);
      if(signal!==undefined&&!(signal instanceof AbortSignal))fail('INVALID_POLICY_REQUEST','Policy cancellation requires an AbortSignal',400);
      if(signal?.aborted)fail('POLICY_ABORTED','Remote policy evaluation was cancelled',503);
      if(active.size>=maxConcurrent)fail('POLICY_BUSY','Remote policy capacity reached; retry later',503);
      const body=JSON.stringify(request);if(Buffer.byteLength(body)>maxRequestBytes)fail('POLICY_LIMIT','Remote policy request exceeds configured limit');
      const controller=new AbortController();active.add(controller);let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;controller.abort();},Math.max(1,Math.min(timeoutMs,request.deadline-Date.now())));
      const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
      try{
        const result=await new Promise((resolve,reject)=>{
          const transport=endpoint.protocol==='https:'?httpsRequest:httpRequest;
          const req=transport(endpoint,{method:'POST',signal:controller.signal,maxHeaderSize:8192,headers:{'content-type':'application/json',accept:'application/json',authorization:'Bearer '+token,'content-length':Buffer.byteLength(body),'cache-control':'no-store'}},async response=>{
            try{
              if(![200,...Object.values(errorStatuses)].includes(response.statusCode)||!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type']??'')||(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'))fail('INVALID_POLICY_RESPONSE','Invalid remote policy response');
              if(response.headers['content-length']&&(!/^\d+$/.test(response.headers['content-length'])||Number(response.headers['content-length'])>maxResponseBytes))fail('POLICY_LIMIT','Remote policy response exceeds configured limit');
              const chunks=[];let total=0;for await(const chunk of response){total+=chunk.length;if(total>maxResponseBytes)fail('POLICY_LIMIT','Remote policy response exceeds configured limit');chunks.push(chunk);}
              const value=parseResponse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),validateResponse);
              if(Object.keys(request).filter(key=>key!=='context').some(key=>value[key]!==request[key])||response.statusCode!==(value.status==='error'?errorStatuses[value.errorCode]:200))fail('INVALID_POLICY_RESPONSE','Remote policy response does not match proposal');
              if(value.status==='error')unavailable();resolve(value);
            }catch(error){response.destroy();reject(error);}
          });req.on('error',reject);req.end(body);
        });
        assertGrant(request);if(controller.signal.aborted)fail('POLICY_ABORTED','Remote policy evaluation was cancelled',503);return result;
      }catch(error){
        assertGrant(request);if(timedOut)fail('POLICY_TIMEOUT','Remote policy evaluation timed out; retry later',504);
        if(controller.signal.aborted)fail('POLICY_ABORTED','Remote policy evaluation was cancelled',503);
        if(error instanceof FrameworkError)throw error;unavailable();
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);active.delete(controller);controller.abort();}
    },
  });
}

