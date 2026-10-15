import {isDeepStrictEqual} from 'node:util';
import {CardFramework} from '../../src/index.js';
import {SQLiteStore} from '../../src/sqlite.js';

let core,store,config,evidence=[];
process.on('message',message=>{
  const {id,command,input,actor,verifiedEvidence=[],loseReply=false}=message;
  try{
    evidence=structuredClone(verifiedEvidence);
    let result;
    if(command==='init'){
      config=input;store=new SQLiteStore(config.filename,{encryptionKey:Buffer.from(config.encryptionKey,'hex')});
      core=new CardFramework({store,random:()=>0,bindings:{'demo.code':()=>({code:'PRIVATE-DEMO-CODE'})},externalPurchaseProviders:{[config.providerId]:{
        validateIntent:({intent,user})=>user.id===config.alice.userId&&intent.externalCurrency==='points'&&intent.externalUnits===String(intent.quote.price.amount),
        verifyProof:({proof})=>evidence.some(record=>isDeepStrictEqual(record,proof)),
      }}});result={pid:process.pid};
    }else{
      const provider=actor??{permissions:['currency.settle'],settlementProviderId:config.providerId};
      switch(command){
        case 'prepare':result=core.prepareExternalPurchase(provider,input);break;
        case 'commit':result=core.commitExternalPurchase(provider,input);break;
        case 'compensate':result=core.confirmExternalCompensation(provider,input);break;
        case 'status':result=core.externalPurchaseStatus(provider,input);break;
        case 'lookup':result=core.lookupExternalPurchase(provider,input);break;
        case 'pending':result=core.pendingExternalPurchases(provider,input);break;
        case 'drainStock':result=core.purchase(config.bob,{...core.quote(config.bob,{productId:'unique',quantity:1}),key:'consume-final-stock'});break;
        case 'snapshot':result={alicePacks:core.packs(config.alice),aliceInventory:core.inventory(config.alice),bobPacks:core.packs(config.bob),wallet:core.wallet(config.alice),allocatedCopyIds:store.read(state=>Object.values(state.copies).filter(copy=>copy.ownerId===config.alice.userId).map(copy=>copy.id)),audit:core.audit({role:'admin'}),integrity:store.integrity()};break;
        case 'close':core.close();core=null;process.send({id,result:true},()=>process.exit(0));return;
        default:throw Error('Unknown coordinator fixture command');
      }
    }
    if(loseReply){core.close();core=null;process.exit(0);return;}
    process.send({id,result});
  }catch(error){process.send({id,error:{code:error.code,message:error.message}});}
});
process.on('disconnect',()=>{core?.close();process.exit(0);});
