import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {CardFramework} from '../../src/index.js';
import {SQLiteStore} from '../../src/sqlite.js';
import {createApiHandler} from '../../src/http.js';
import {fixture} from '../helpers.js';
import {createPresentationStore} from '../../src/presentation/service.js';
import {createPresentationHandler} from '../../src/presentation/node-http.js';
import {authorizePresentation} from '../../src/access.js';

export async function startService(config,observe=()=>{}){
  const store=new SQLiteStore(config.filename,{encryptionKey:Buffer.from(config.encryptionKey,'hex')}),delivered=[];
  const options={store,random:()=>0,bindings:{'demo.code':()=>({code:'PRIVATE-DEMO-CODE'})},eventSubscriptions:[{id:'opened',handler:'fixture.event',events:['card.opened']}],actionHandlers:{'fixture.reward':async job=>{delivered.push(job.idempotencyKey);},'fixture.event':async job=>{delivered.push(job.idempotencyKey);}}};
  let core,alice=config.alice,bob=config.bob;
  if(config.initialize){const x=fixture({...options,change(catalog){catalog.variants.find(variant=>variant.id==='dawn.standard').onOpen=[{id:'reward',handler:'fixture.reward',params:{label:'Opened reward'}}];}});core=x.core;alice=x.alice;bob=x.bob;}
  else core=new CardFramework(options);
  const presentations=config.presentationRoot?await createPresentationStore({root:config.presentationRoot,authorize:authorizePresentation,validatePublication:(actor,{archive})=>core.registerCardPresentation(actor,archive)}):null;
  let api,presentationHTTP;
  const server=createServer(async(request,response)=>{
    if((request.url==='/api/open'||/^\/presentations\/imports\/[^/]+\/publish$/.test(request.url))&&request.headers['x-fixture-truncate']==='1'){
      const end=response.end.bind(response);response.end=function(body,...args){
        if(response.statusCode===200){observe(JSON.parse(body));response.flushHeaders();response.write(body.slice(0,Math.max(1,Math.floor(body.length/2))));setTimeout(()=>response.destroy(),20);return response;}
        return end(body,...args);
      };
    }
    if(!await api(request,response)&&!await presentationHTTP?.(request,response)){response.writeHead(404);response.end();}
  });
  await new Promise(resolve=>server.listen(config.port??0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const identities=new Map([['fixture-alice',alice],['fixture-bob',bob],['fixture-operator',{userId:alice.userId,role:'admin'}]]);
  const resolveIdentity=request=>identities.get(request.headers.authorization)??null;
  if(presentations)presentationHTTP=createPresentationHandler({store:presentations,resolveIdentity,allowedOrigin:origin});
  api=createApiHandler({framework:core,resolveIdentity,allowedOrigin:origin,exposeOperators:true,requirePrincipal:true});
  return {info:{origin,alice,bob,pid:process.pid},async dispatch(){await core.dispatchActions({role:'admin'},{limit:10});return [...delivered];},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await presentations?.close();core.close();}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let service;
  process.on('message',async({id,command,config})=>{
    try{
      if(command==='start'){service=await startService(config,value=>process.send({type:'lostReply',value}));process.send({id,result:service.info});}
      else if(command==='dispatch')process.send({id,result:await service.dispatch()});
      else if(command==='close'){await service.close();service=null;process.send({id,result:true},()=>process.exit(0));}
      else throw Error('Unknown service fixture command');
    }catch(error){process.send({id,error:{code:error.code,message:error.message}});}
  });
  process.on('disconnect',async()=>{await service?.close();process.exit(0);});
}
