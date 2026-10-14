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
