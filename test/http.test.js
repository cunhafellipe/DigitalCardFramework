import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiHandler,createFrameworkServer} from '../src/http.js';
import {FrameworkError} from '../src/catalog.js';
import {Readable} from 'node:stream';
import {fixture} from './helpers.js';

test('HTTP identity, origin, public privacy and command recovery at the service boundary',async t=>{
  const x=fixture();
  let origin;
  const {createApiHandler}=await import('../src/http.js'),{createServer}=await import('node:http');
  let handler;
  const live=createServer((req,res)=>handler(req,res));
  await new Promise(resolve=>live.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+live.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:req=>req.headers.authorization==='test-alice'?x.alice:null,allowedOrigin:origin});
  t.after(()=>new Promise(resolve=>{live.close(resolve);live.closeAllConnections();}));
  const call=(path,{body,auth=true,requestOrigin=origin}={})=>fetch(origin+'/api'+path,{
    method:body===undefined?'GET':'POST',headers:{...(auth?{Authorization:'test-alice'}:{}),
      ...(body===undefined?{}:{Origin:requestOrigin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await call('/inventory',{auth:false})).status,401);
  assert.equal((await call('/catalog',{auth:false})).status,200);
  const quote=await (await call('/quote',{body:{productId:'unique'}})).json();
  assert.equal((await call('/purchase',{body:{...quote,key:'origin'},requestOrigin:'https://evil.example'})).status,403);
  const a=await (await call('/purchase',{body:{...quote,key:'buy'}})).json();
  const b=await (await call('/purchase',{body:{...quote,key:'buy'}})).json();assert.deepEqual(a,b);
  const opened=await (await call('/open',{body:{key:'open',packId:a.packs[0].id}})).json();
  assert.equal(opened.cards[0].bindings['demo.code'].data.code,'PRIVATE-DEMO-CODE');
  const album=await (await call('/albums',{body:{key:'album',name:'Public',visibility:'public',placements:[{copyId:opened.cards[0].id}]}})).json();
  const publicAlbum=await (await call('/albums/'+album.id,{auth:false})).json();
  assert(!JSON.stringify(publicAlbum).includes('PRIVATE-DEMO-CODE'));
  assert.equal((await call('/cards/'+opened.cards[0].id,{auth:false})).status,401);
  assert.equal(x.core.wallet(x.alice).credits,9990);
});
test('HTTP server refuses construction without host identity verification',()=>{
  const x=fixture();assert.throws(()=>createFrameworkServer({framework:x.core}),/identity resolver/);
});

test('HTTP awaits delayed reads, detail projections and command intents before responding',async()=>{
  const actor={userId:'collector',role:'player',permissions:['catalog.read']},calls=[],telemetry=[];
  const delayed=(name,value)=>(...args)=>new Promise(resolve=>setImmediate(()=>{calls.push({name,args});resolve(value);}));
  const framework={
    catalog:delayed('catalog',{version:3}),inventory:delayed('inventory',[{id:'copy'}]),
    inventoryPage:delayed('inventoryPage',{items:[{id:'copy'}],next:null}),
    me:delayed('me',{id:'collector',displayName:'Collector',role:'admin',permissions:['admin.manage']}),
    viewAlbum:delayed('viewAlbum',{id:'public album',cards:[]}),inspectCard:delayed('inspectCard',{id:'copy 1'}),
    tradeInventory:delayed('tradeInventory',{items:[],next:null}),
    registerCommandIntent:delayed('registerCommandIntent',{id:'intent'}),
    acknowledgeCommandIntent:delayed('acknowledgeCommandIntent',{id:'intent',status:'acknowledged'})
  };
  const invoke=async(path,{identity=actor,body}={})=>{
    const request=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
    Object.assign(request,{url:'/api'+path,method:body===undefined?'GET':'POST',headers:{origin:'https://cards.test','content-type':'application/json'}});
    const headers=new Map(),response={statusCode:200,setHeader:(name,value)=>headers.set(name,value),getHeader:name=>headers.get(name),end(value){this.body=value;}};
    await createApiHandler({framework,resolveIdentity:()=>identity,allowedOrigin:'https://cards.test',onRequest:event=>telemetry.push(event)})(request,response);
    assert.equal(response.statusCode,200);assert.equal(headers.get('Cache-Control'),'no-store');
    assert.equal(telemetry.at(-1).requestId,headers.get('X-Request-ID'));assert.equal(telemetry.at(-1).status,200);
    return JSON.parse(response.body);
  };
  assert.deepEqual(await invoke('/catalog',{identity:null}),{version:3});
  assert.deepEqual(await invoke('/inventory'),[{id:'copy'}]);
  assert.deepEqual(await invoke('/inventory?limit=2&after=last'),{items:[{id:'copy'}],next:null});
  assert.deepEqual(calls.at(-1).args,[actor,{limit:2,after:'last'}]);
  assert.deepEqual(await invoke('/me'),{id:'collector',displayName:'Collector',role:'player',permissions:['catalog.read']});
  assert.deepEqual(await invoke('/albums/public%20album',{identity:null}),{id:'public album',cards:[]});
  assert.deepEqual(calls.at(-1).args,[null,'public album']);
  assert.deepEqual(await invoke('/cards/copy%201'),{id:'copy 1'});
  assert.deepEqual(calls.at(-1).args,[actor,'copy 1']);
  assert.deepEqual(await invoke('/users/other%20user/inventory?limit=5'),{items:[],next:null});
  assert.deepEqual(calls.at(-1).args,[actor,'other user',{limit:5}]);
  assert.deepEqual(await invoke('/command-intents',{body:{command:'open'}}),{id:'intent'});
  assert.deepEqual(await invoke('/command-intents/acknowledge',{body:{id:'intent'}}),{id:'intent',status:'acknowledged'});
});

test('HTTP catches delayed framework errors and denies unauthorized reads before calling the framework',async()=>{
  let calls=0;const telemetry=[];
  const framework=new Proxy({}, {get:()=>async()=>{calls++;await new Promise(resolve=>setImmediate(resolve));throw new FrameworkError('ACCOUNT_DISABLED','Account is disabled',403);}});
  const invoke=async(path,actor)=>{
    const headers=new Map(),response={statusCode:200,setHeader:(name,value)=>headers.set(name,value),getHeader:name=>headers.get(name),end(value){this.body=JSON.parse(value);}};
    await createApiHandler({framework,resolveIdentity:()=>actor,onRequest:event=>telemetry.push(event)})({method:'GET',url:'/api'+path,headers:{}},response);
    assert.equal(telemetry.at(-1).status,response.statusCode);return response;
  };
  assert.equal((await invoke('/inventory',null)).statusCode,401);
  assert.equal((await invoke('/operator/catalog',{userId:'collector',role:'player'})).statusCode,403);
  assert.equal(calls,0);
  const response=await invoke('/me',{userId:'collector',role:'player'});
  assert.equal(response.statusCode,403);assert.deepEqual(response.body,{code:'ACCOUNT_DISABLED',message:'Account is disabled'});assert.equal(calls,1);
  const failure=await createApiHandler({framework:{catalog:async()=>{await new Promise(resolve=>setImmediate(resolve));throw Error('private detail');}},resolveIdentity:()=>null})({method:'GET',url:'/api/catalog',headers:{}},{statusCode:200,setHeader(){},getHeader(){},end(value){assert.deepEqual(JSON.parse(value),{code:'INTERNAL_ERROR',message:'The server could not complete this request'});assert.equal(this.statusCode,500);}});
  assert.equal(failure,true);
});
