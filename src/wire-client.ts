import {WireContractError,operationContract,validateWireParameters,validateWireRequest,validateWireResponse} from './wire-contracts.js';
import type {Operations, Schemas} from './wire-types.js';
export class WireApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(error: Schemas['Error'],status: number){super(error.message);this.name='WireApiError';this.code=error.code;this.status=status;}
}
export interface WireTransportOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  principal: ()=>string|null;
}
export type WireCallOptions<K extends keyof Operations> = {signal?: AbortSignal}
  & ({} extends Operations[K]['path'] ? {path?: Operations[K]['path']} : {path: Operations[K]['path']})
  & ({} extends Operations[K]['query'] ? {query?: Operations[K]['query']} : {query: Operations[K]['query']});
export type WireCallArguments<K extends keyof Operations> = {} extends WireCallOptions<K>
  ? [options?: WireCallOptions<K>] : [options: WireCallOptions<K>];
export function createWireTransport({baseUrl='/api',fetch:request=globalThis.fetch,principal}:WireTransportOptions){
  return async function call<K extends keyof Operations>(id:K,input:Operations[K]['request'],...args:WireCallArguments<K>):Promise<Operations[K]['response']>{
    const options=args[0];
    const {path,method}=operationContract(id);
    validateWireRequest(id,input);
    const parameters=validateWireParameters(id,options);
    const bindings:Record<string,unknown>=parameters.path;
    const resolved=path.replace(/\{([^}]+)\}/g,(_match:string,key:string)=>{
      const value=bindings[key];if(typeof value!=='string'||!value)throw new Error('Missing route parameter: '+key);
      return encodeURIComponent(value);
    });
    const query=new URLSearchParams();
    for(const [key,value]of Object.entries(parameters.query))if(value!==undefined&&value!==null)query.set(key,String(value));
    const headers:Record<string,string>={};
    if(input!==undefined){headers['Content-Type']='application/json';const actor=principal();if(actor)headers['X-DC-Principal']=actor;}
    const response=await request(baseUrl+resolved+(query.size?'?'+query.toString():''),{method,credentials:'same-origin',headers,body:input===undefined?undefined:JSON.stringify(input),signal:options?.signal});
    let value:unknown;
    try{value=await response.json();}catch(error){if(error instanceof SyntaxError||error instanceof DOMException&&error.name==='SyntaxError')throw new WireContractError(id,'response',[]);throw error;}
    validateWireResponse(id,response.status,value);
    if(!response.ok)throw new WireApiError(value as Schemas['Error'],response.status);
    return value as Operations[K]['response'];
  };
}
