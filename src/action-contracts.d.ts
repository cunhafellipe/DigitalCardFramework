export type ActionJson=null|boolean|number|string|ActionJson[]|{[key:string]:ActionJson};
export interface ActionDelivery {
  protocol:'digital-card-action@1';pluginId:string;handlerId:string;jobId:string;
  beneficiaryId:string|null;source:{[key:string]:ActionJson};params:{[key:string]:ActionJson};
}
export interface ActionAcknowledgment {protocol:'digital-card-action@1';pluginId:string;jobId:string;status:'completed'}
export declare const actionProtocol:'digital-card-action@1';
export declare const actionDeliverySchema:Readonly<Record<string,unknown>>;
export declare function validateActionDelivery(value:unknown):ActionDelivery;
export declare function validateActionAcknowledgment(value:unknown):ActionAcknowledgment;

export interface KnownEventData {
  'code.pool-configured':{poolId:string;actorId:string|null};
  'code.batch-imported':{batchId:string;poolId:string;count:number;actorId:string|null;metadata:Record<string,ActionJson>};
  'code.keys-rotated':{count:number;actorId:string|null};
  'code.allocated':{codeId:string;copyId:string;actorId:string};
  'code.revealed':{codeId:string;copyId:string;actorId:string};
  'code.usage-reported':{codeId:string;copyId:string;actorId:string;used:boolean};
  'code.transferred':{codeId:string;copyId:string;from:string;to:string;tradeId:string};
  'code.redeemed':{codeId:string;copyId:string|null;actorId:string|null;providerId:string;eventId:string;occurredAt:string};
  'code.revoked':{codeId:string;copyId:string|null;actorId:string|null;providerId:string;eventId:string;occurredAt:string};
  'catalog.published':{version:number};
  'catalog.imported':{version:number;userId:string|null;digest:string};
  'user.registered':{userId:string};
  'provenance.backfilled':{count:number};
  'currency.external-settled':{providerId:string;transactionId:string;userId:string;currencyId:string;amount:number};
  'card.issued':{copyId:string;ownerId:string;variantId:string;provenance:Record<string,ActionJson>};
  'card.opened':{copyId:string;userId:string;packId:string|null;openedAt:string};
  'card.transferred':{copyId:string;from:string;to:string;tradeId:string};
}
export interface FrameworkEvent<Type extends string=string> {
  id:string;sequence:number;type:Type;at:string;completionId?:string;
  data:Type extends keyof KnownEventData?KnownEventData[Type]:Record<string,ActionJson>;
}
export type KnownFrameworkEvent={[Type in keyof KnownEventData]:FrameworkEvent<Type>}[keyof KnownEventData];
/** Validate an envelope without changing the arbitrary custom-action contract. */
export declare function validateFrameworkEvent<Type extends string>(value:unknown,expectedType:Type):FrameworkEvent<Type>;
export declare function validateFrameworkEvent(value:unknown):FrameworkEvent;
