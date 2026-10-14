import {randomUUID} from 'node:crypto';
import {FrameworkError} from './catalog.js';
import {PERMISSIONS} from './access.js';
import {createRemotePolicyTransport} from './remote-policy-transport.js';
import {accessProviderProtocol,validateAccessProviderRequest,validateAccessProviderResponse} from './access-provider-contracts.js';

export {accessProviderProtocol,accessProviderSchema,validateAccessProviderRequest,validateAccessProviderResponse} from './access-provider-contracts.js';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const configFailure=()=>{throw new FrameworkError('ACCESS_PROVIDER_CONFIG','Invalid remote access provider configuration',400);};

/** Resolve authenticated sessions without forwarding ambient credentials or granting unapproved authority. */
export function createRemoteAccessProvider(options){
  if(!plain(options))configFailure();
  const {allowRoles,allowPermissions,...transportOptions}=options;
  if(!Array.isArray(allowRoles)||allowRoles.length<1||allowRoles.length>2||new Set(allowRoles).size!==allowRoles.length||allowRoles.some(role=>!['player','admin'].includes(role)))configFailure();
  if(!Array.isArray(allowPermissions)||allowPermissions.length>PERMISSIONS.length||new Set(allowPermissions).size!==allowPermissions.length||allowPermissions.some(permission=>!PERMISSIONS.includes(permission)))configFailure();
  if(allowRoles.includes('admin')&&PERMISSIONS.some(permission=>!allowPermissions.includes(permission)))configFailure();
  const roles=Object.freeze([...allowRoles]),permissions=Object.freeze([...allowPermissions]);
  if(Object.hasOwn(transportOptions,'scope'))configFailure();
  const transport=createRemotePolicyTransport({...transportOptions,scope:'access'},{scope:'access',validateRequest:validateAccessProviderRequest,validateResponse:validateAccessProviderResponse,requestBytes:65536,responseBytes:65536});
  return Object.freeze({
    providerId:transport.providerId,allowRoles:roles,allowPermissions:permissions,
    setEnabled:transport.setEnabled,close:transport.close,
    async resolveAccess(identity,{signal}={}){
      try{
        if(!plain(identity))return null;
        const request=Object.freeze({protocol:accessProviderProtocol,operation:'resolveAccess',scope:'access',requestId:randomUUID(),...transport.grant(),deadline:Date.now()+transport.timeoutMs,issuer:identity.issuer,subject:identity.subject,userId:identity.userId});
        const result=await transport.evaluate(request,{signal});
        if(Date.now()>=request.deadline||result.status!=='allowed'||!roles.includes(result.role)||result.permissions.some(permission=>!permissions.includes(permission)))return null;
        return Object.freeze({role:result.role,permissions:Object.freeze([...result.permissions])});
      }catch{return null;}
    },
  });
}

/** Select one host access source; absent configuration retains the built-in session policy. */
export function createHostAccessResolver({remoteAccess,resolveAccess}={}){
  if(resolveAccess!==undefined&&typeof resolveAccess!=='function'||remoteAccess!==undefined&&resolveAccess!==undefined)configFailure();
  const provider=remoteAccess===undefined?null:createRemoteAccessProvider(remoteAccess);
  return Object.freeze({resolveAccess:provider?.resolveAccess??resolveAccess,close(){provider?.close();},setEnabled(value){if(!provider)configFailure();return provider.setEnabled(value);}});
}
