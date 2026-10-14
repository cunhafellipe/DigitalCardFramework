import {actionProtocol,validateActionDelivery,validateActionAcknowledgment,createRemoteActionHandler} from '@digital-card/framework/remote-actions';
import type {ActionDelivery} from '@digital-card/framework/remote-actions';
declare const incoming:unknown;
const delivery:ActionDelivery=validateActionDelivery(incoming);
const protocol:'digital-card-action@1'=actionProtocol;
const handler=createRemoteActionHandler({url:'https://receiver.example/actions',pluginId:'example.receiver',handlerId:'example.record',token:'operator-configured-credential'});
handler({idempotencyKey:delivery.jobId,userId:delivery.beneficiaryId,source:delivery.source,params:delivery.params});
// @ts-expect-error Executable values cannot enter portable delivery metadata.
handler({idempotencyKey:'job',userId:null,source:{},params:{callback:()=>1}});
const reply=validateActionAcknowledgment(incoming);
const completed:'completed'=reply.status;
void protocol;void completed;


import {validateFrameworkEvent} from '@digital-card/framework/remote-actions';
import type {FrameworkEvent,KnownFrameworkEvent} from '@digital-card/framework/remote-actions';
const opened=validateFrameworkEvent(incoming,'card.opened');
const copyId:string=opened.data.copyId,packId:string|null=opened.data.packId;
const event:FrameworkEvent=validateFrameworkEvent(incoming);
const unknownValue:import('@digital-card/framework/remote-actions').ActionJson|undefined=event.data.custom;
declare const known:KnownFrameworkEvent;
if(known.type==='catalog.published'){const version:number=known.data.version;void version;}
// @ts-expect-error selected known event data has no issued-card provenance
void opened.data.provenance;
// @ts-expect-error known opened event requires its nullable pack ID
const missing:FrameworkEvent<'card.opened'>={id:'event',sequence:1,type:'card.opened',at:'time',data:{copyId:'copy',userId:'user',openedAt:'time'}};
void [copyId,packId,unknownValue,missing];

const codeUsage=validateFrameworkEvent(incoming,'code.usage-reported');
const used:boolean=codeUsage.data.used;
if(known.type==='code.revoked'){
  const holderCopy:string|null=known.data.copyId,actor:string|null=known.data.actorId;
  const provider:string=known.data.providerId;
  // @ts-expect-error Provider confirmation has no usage-report flag.
  void known.data.used;
  void [holderCopy,actor,provider];
}
// @ts-expect-error Usage reports require a boolean flag.
const malformedUsage:FrameworkEvent<'code.usage-reported'>={id:'event',sequence:1,type:'code.usage-reported',at:'time',data:{codeId:'code',copyId:'copy',actorId:'user',used:'yes'}};
void [used,malformedUsage];

const purchaseEvent=validateFrameworkEvent(incoming,'packs.purchased');
if('preparationId' in purchaseEvent.data){
  const preparation:string=purchaseEvent.data.preparationId,purchase:string=purchaseEvent.data.purchaseId;
  void [preparation,purchase];
}
// @ts-expect-error Ordinary purchases do not contain external preparation IDs.
const externalPreparation:string=purchaseEvent.data.preparationId;
const grantEvent=validateFrameworkEvent(incoming,'currency.granted');
const recipient:string=grantEvent.data.userId;
// @ts-expect-error Command events expose the user, not the command's currency amount.
void grantEvent.data.amount;
void [externalPreparation,recipient];

const operatorEvent=validateFrameworkEvent(incoming,'admin.cards.give');
const operatorUser:string|null=operatorEvent.data.userId;
// @ts-expect-error Service operators may have no linked user.
const linkedOperator:string=operatorEvent.data.userId;
if(known.type==='card-library.saved'){
  const author:string|null=known.data.userId;
  // @ts-expect-error Operator events do not expose library documents.
  void known.data.document;
  void author;
}
void [operatorUser,linkedOperator];
