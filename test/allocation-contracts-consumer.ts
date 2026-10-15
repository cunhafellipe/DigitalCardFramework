import {
  allocationStrategyProtocol, allocationStrategyV2Protocol, allocationStrategyV3Protocol, allocationStrategyV4Protocol,
  allocationStrategySchema, allocationStrategyV2Schema, allocationStrategyV3Schema, allocationStrategyV4Schema,
  validateAllocationStrategyRequest, validateAllocationStrategyResponse, validateAllocationStrategyV2Request, validateAllocationStrategyV2Response,
  validateAllocationStrategyV3Request, validateAllocationStrategyV3Response, validateAllocationStrategyV4Request, validateAllocationStrategyV4Response,
  validateAllocationEligibility, validateAllocationCodeEligibility, validateAllocationFeasibilityEligibility,
  type AllocationStrategyRequest, type AllocationStrategyV2Request, type AllocationStrategyV3Request, type AllocationStrategyV4Request,
  type AllocationStrategyV4Response, type AnyAllocationStrategyRequest, type AllocationEligibilityRequest, type AllocationSlot,
} from '@digital-card/framework/allocation-strategy-contracts';

const uuid='00000000-0000-4000-8000-000000000001',digest='a'.repeat(64);
const slot: AllocationSlot={id:'cards',role:'card',count:1,probability:{numerator:1,denominator:1},pool:[{variantId:'card.standard',weight:1}]};
const v1: AllocationStrategyRequest={protocol:allocationStrategyProtocol,operation:'allocatePacks',scope:'catalog-purchase',phase:'allocate',requestId:uuid,attemptId:uuid,providerId:'example.allocator',grantId:uuid,generation:1,commandId:digest,inputDigest:digest,snapshotDigest:digest,deadline:1,context:{userId:'collector',product:{id:'pack.basic',revision:1,strategy:{algorithm:'weighted-deck@1',version:1,deckScope:'purchase-slot'},slots:[slot]},quantity:1,variants:[{id:'card.standard',remaining:null}],entropy:{seed:digest,cursor:0}}};
const v2: AllocationStrategyV2Request={...v1,protocol:allocationStrategyV2Protocol,context:{...v1.context,product:{...v1.context.product,strategy:{algorithm:'weighted-deck@2',version:2,deckScope:'purchase-slot'},duplicatePolicy:{scope:'none',fallback:'allow'},pity:null},mode:'personalized',ownedCards:[],pityCount:0,variants:[{id:'card.standard',remaining:null,cardId:'card',rarityRank:0}]}};
const v3: AllocationStrategyV3Request={...v2,protocol:allocationStrategyV3Protocol,context:{...v2.context,product:{...v2.context.product,strategy:{algorithm:'weighted-deck@3',version:3,deckScope:'purchase-slot'}},codePools:[{id:'reward.codes',available:1}],variants:[{id:'card.standard',remaining:null,cardId:'card',rarityRank:0,codeDemand:[{poolId:'reward.codes',count:1}]}]}};
const v4: AllocationStrategyV4Request={...v3,protocol:allocationStrategyV4Protocol,context:{...v3.context,product:{...v3.context.product,strategy:{algorithm:'weighted-deck@4',version:4,deckScope:'purchase-slot'}}}};
const requests: AnyAllocationStrategyRequest[]=[v1,v2,v3,v4];
for(const request of requests){
  if(request.protocol===allocationStrategyV4Protocol){const version:4=request.context.product.strategy.version;request.context.codePools.map(pool=>pool.available);void version;}
}
validateAllocationStrategyRequest(v1).context.entropy.cursor.toFixed();validateAllocationStrategyV2Request(v2).context.ownedCards.map(card=>card.owned);
validateAllocationStrategyV3Request(v3).context.variants.map(variant=>variant.codeDemand);validateAllocationStrategyV4Request(v4).context.codePools.map(pool=>pool.id);
validateAllocationEligibility(v2);validateAllocationCodeEligibility(v3);validateAllocationCodeEligibility(v4);validateAllocationFeasibilityEligibility(v4);
const stock: AllocationEligibilityRequest<2>={...v2,context:{...v2.context,mode:'stock'}};validateAllocationEligibility(stock);
const input: unknown=JSON.parse('{}');
const replies=[validateAllocationStrategyResponse(input),validateAllocationStrategyV2Response(input),validateAllocationStrategyV3Response(input),validateAllocationStrategyV4Response(input)];
for(const reply of replies){if(reply.status==='planned')reply.allocations.map(row=>row.variantIds);else reply.errorCode.toUpperCase();}
const {context,...identity}=v4;const planned:AllocationStrategyV4Response={...identity,status:'planned',allocations:[{packIndex:0,slotId:'cards',variantIds:['card.standard']}]};
// @ts-expect-error The protocol and algorithm versions must agree.
const mixed:AllocationStrategyV4Request={...v4,context:{...v4.context,product:{...v4.context.product,strategy:{algorithm:'weighted-deck@3',version:3,deckScope:'purchase-slot'}}}};
// @ts-expect-error v2 eligibility requires owned-card and pity counters.
const missingEligibility:AllocationStrategyV2Request={...v2,context:v1.context};
// @ts-expect-error v3 resource snapshots require per-variant code demand.
const missingDemand:AllocationStrategyV3Request={...v3,context:{...v3.context,variants:v2.context.variants}};
// @ts-expect-error V1 snapshots do not expose code pools.
validateAllocationStrategyRequest(input).context.codePools;
// @ts-expect-error Solver admission needs a v4 snapshot.
validateAllocationFeasibilityEligibility(v3);
// @ts-expect-error Exact slot snapshots always carry probability and role.
const incompleteSlot:AllocationSlot={id:'cards',count:1,pool:[]};
// @ts-expect-error Planned replies carry allocations, not request context.
const wrongReply:AllocationStrategyV4Response={...planned,context};
void [allocationStrategySchema,allocationStrategyV2Schema,allocationStrategyV3Schema,allocationStrategyV4Schema,mixed,missingEligibility,missingDemand,incompleteSlot,wrongReply];

import {createRemoteAllocationStrategy, allocationStrategyV4Protocol as remoteV4Protocol} from '@digital-card/framework/remote-allocation-strategy';
import {
  stockAllocationStrategyProtocol, stockAllocationStrategyV2Protocol, stockAllocationStrategyV3Protocol, stockAllocationStrategyV4Protocol,
  stockAllocationStrategySchema, stockAllocationStrategyV2Schema, stockAllocationStrategyV3Schema, stockAllocationStrategyV4Schema,
  validateStockAllocationStrategyRequest, validateStockAllocationStrategyV2Request, validateStockAllocationStrategyV3Request, validateStockAllocationStrategyV4Request,
  validateStockAllocationStrategyResponse, validateStockAllocationStrategyV2Response, validateStockAllocationStrategyV3Response, validateStockAllocationStrategyV4Response,
  type StockAllocationStrategyRequest, type StockAllocationStrategyV2Request, type StockAllocationStrategyV3Request, type StockAllocationStrategyV4Request,
  type StockAllocationStrategyV4Response, type AnyStockAllocationStrategyRequest,
} from '@digital-card/framework/stock-allocation-strategy-contracts';
const shop={id:uuid,ownerId:'merchant'};
const stockV1:StockAllocationStrategyRequest={...v1,protocol:stockAllocationStrategyProtocol,scope:'commerce-stock',context:{...v1.context,shop}};
const stockV2:StockAllocationStrategyV2Request={...v2,protocol:stockAllocationStrategyV2Protocol,scope:'commerce-stock',context:{...v2.context,shop,mode:'stock'}};
const stockV3:StockAllocationStrategyV3Request={...v3,protocol:stockAllocationStrategyV3Protocol,scope:'commerce-stock',context:{...v3.context,shop,mode:'stock'}};
const stockV4:StockAllocationStrategyV4Request={...v4,protocol:stockAllocationStrategyV4Protocol,scope:'commerce-stock',context:{...v4.context,shop,mode:'stock'}};
const stockRequests:AnyStockAllocationStrategyRequest[]=[stockV1,stockV2,stockV3,stockV4];
for(const request of stockRequests){if(request.protocol===stockAllocationStrategyV4Protocol){const version:4=request.context.product.strategy.version;request.context.codePools.map(pool=>pool.available);void version;}}
validateStockAllocationStrategyRequest(stockV1).context.shop.ownerId.toUpperCase();
validateStockAllocationStrategyV2Request(stockV2).context.ownedCards.map(card=>card.cardId);
validateStockAllocationStrategyV3Request(stockV3).context.variants.map(variant=>variant.codeDemand);
const stockMode:'stock'=validateStockAllocationStrategyV4Request(stockV4).context.mode;
const stockReplies=[validateStockAllocationStrategyResponse(input),validateStockAllocationStrategyV2Response(input),validateStockAllocationStrategyV3Response(input),validateStockAllocationStrategyV4Response(input)];
for(const reply of stockReplies){if(reply.status==='planned')reply.allocations.map(row=>row.variantIds);else reply.errorCode.toUpperCase();}
const stockPlanned:StockAllocationStrategyV4Response={...planned,protocol:stockAllocationStrategyV4Protocol,scope:'commerce-stock'};
const remote=createRemoteAllocationStrategy({algorithm:'weighted-deck@4',scope:'catalog-purchase',providerId:'example.allocator',url:'https://allocator.example/allocate',token:'example-token',timeoutMs:5000,maxRequestBytes:1048576,maxResponseBytes:262144,maxConcurrent:2});
remote.assertGrant(remote.grant());
const enabled:boolean=remote.setEnabled(true).enabled;
const supported:boolean=remote.supportsAlgorithm(input);
remote.evaluate(v4,{signal:new AbortController().signal}).then(reply=>{
  const protocol:typeof remoteV4Protocol=reply.protocol;
  const status:'planned'=reply.status;
  reply.allocations.map(row=>row.variantIds);
  // @ts-expect-error Error frames reject instead of resolving.
  reply.errorCode;
  void [protocol,status];
});
remote.evaluate(v1).then(reply=>{const protocol:typeof allocationStrategyProtocol=reply.protocol;void protocol;});
remote.close();
// @ts-expect-error Stock allocation requires a shop snapshot.
const missingShop:StockAllocationStrategyRequest={...stockV1,context:v1.context};
// @ts-expect-error Stock allocation cannot use personalized mode.
const personalizedStock:StockAllocationStrategyV2Request={...stockV2,context:{...stockV2.context,mode:'personalized'}};
// @ts-expect-error Stock protocol and strategy versions must agree.
const mixedStock:StockAllocationStrategyV4Request={...stockV4,context:stockV3.context};
// @ts-expect-error The remote adapter only accepts catalog-purchase requests.
remote.evaluate(stockV4);
// @ts-expect-error A supported algorithm selector is required.
createRemoteAllocationStrategy({scope:'catalog-purchase',providerId:'example.allocator',url:'https://allocator.example',token:'example-token'});
// @ts-expect-error Stock scope is not accepted by this adapter.
createRemoteAllocationStrategy({algorithm:'weighted-deck@4',scope:'commerce-stock',providerId:'example.allocator',url:'https://allocator.example',token:'example-token'});
void [stockAllocationStrategySchema,stockAllocationStrategyV2Schema,stockAllocationStrategyV3Schema,stockAllocationStrategyV4Schema,stockMode,stockPlanned,enabled,supported,missingShop,personalizedStock,mixedStock];

import {createRemoteStockAllocationStrategy, stockAllocationStrategyV4Protocol as remoteStockV4Protocol} from '@digital-card/framework/remote-stock-allocation-strategy';
const remoteStock=createRemoteStockAllocationStrategy({algorithm:'weighted-deck@4',scope:'commerce-stock',providerId:'example.allocator',url:'https://allocator.example/stock',token:'example-provider-token'});
remoteStock.assertGrant(remoteStock.grant());
const remoteStockScope:'commerce-stock'=remoteStock.setEnabled(true).scope;
const remoteStockSupports:boolean=remoteStock.supportsAlgorithm(input);
remoteStock.evaluate(stockV4,{signal:new AbortController().signal}).then(reply=>{
  const protocol:typeof remoteStockV4Protocol=reply.protocol;
  const status:'planned'=reply.status;
  reply.allocations.map(row=>row.variantIds);
  // @ts-expect-error Error frames reject instead of resolving.
  reply.errorCode;
  void [protocol,status];
});
remoteStock.evaluate(stockV1).then(reply=>{const protocol:typeof stockAllocationStrategyProtocol=reply.protocol;void protocol;});
remoteStock.close();
// @ts-expect-error Stock adapters require commerce-stock scope.
createRemoteStockAllocationStrategy({algorithm:'weighted-deck@4',scope:'catalog-purchase',providerId:'example.allocator',url:'https://allocator.example',token:'example-provider-token'});
// @ts-expect-error Stock adapters require a supported algorithm selector.
createRemoteStockAllocationStrategy({algorithm:'weighted-deck@5',scope:'commerce-stock',providerId:'example.allocator',url:'https://allocator.example',token:'example-provider-token'});
// @ts-expect-error Stock adapters accept stock protocol envelopes.
remoteStock.evaluate(v4);

import {
  externalAllocationStrategyProtocol, externalAllocationStrategyV2Protocol, externalAllocationStrategyV3Protocol, externalAllocationStrategyV4Protocol,
  externalAllocationStrategySchema, externalAllocationStrategyV2Schema, externalAllocationStrategyV3Schema, externalAllocationStrategyV4Schema,
  validateExternalAllocationStrategyRequest, validateExternalAllocationStrategyV2Request, validateExternalAllocationStrategyV3Request, validateExternalAllocationStrategyV4Request,
  validateExternalAllocationStrategyResponse, validateExternalAllocationStrategyV2Response, validateExternalAllocationStrategyV3Response, validateExternalAllocationStrategyV4Response,
  type ExternalAllocationStrategyRequest, type ExternalAllocationStrategyV2Request, type ExternalAllocationStrategyV3Request, type ExternalAllocationStrategyV4Request,
  type ExternalAllocationStrategyV4Response, type AnyExternalAllocationStrategyRequest,
} from '@digital-card/framework/external-allocation-strategy-contracts';
const preparationId='ep_'+digest;
const externalV1:ExternalAllocationStrategyRequest={...v1,protocol:externalAllocationStrategyProtocol,scope:'external-fulfillment',context:{...v1.context,preparationId}};
const externalV2:ExternalAllocationStrategyV2Request={...v2,protocol:externalAllocationStrategyV2Protocol,scope:'external-fulfillment',context:{...v2.context,preparationId}};
const externalV3:ExternalAllocationStrategyV3Request={...v3,protocol:externalAllocationStrategyV3Protocol,scope:'external-fulfillment',context:{...v3.context,preparationId}};
const externalV4:ExternalAllocationStrategyV4Request={...v4,protocol:externalAllocationStrategyV4Protocol,scope:'external-fulfillment',context:{...v4.context,preparationId}};
const externalRequests:AnyExternalAllocationStrategyRequest[]=[externalV1,externalV2,externalV3,externalV4];
for(const request of externalRequests){if(request.protocol===externalAllocationStrategyV4Protocol){const version:4=request.context.product.strategy.version;request.context.codePools.map(pool=>pool.available);void version;}}
validateExternalAllocationStrategyRequest(input).context.preparationId.toUpperCase();
const externalMode:'personalized'=validateExternalAllocationStrategyV2Request(input).context.mode;
validateExternalAllocationStrategyV3Request(input).context.variants.map(variant=>variant.codeDemand);
validateExternalAllocationStrategyV4Request(input).context.codePools.map(pool=>pool.available);
const externalReplies=[validateExternalAllocationStrategyResponse(input),validateExternalAllocationStrategyV2Response(input),validateExternalAllocationStrategyV3Response(input),validateExternalAllocationStrategyV4Response(input)];
for(const reply of externalReplies){if(reply.status==='planned')reply.allocations.map(row=>row.variantIds);else reply.errorCode.toUpperCase();}
const externalPlanned:ExternalAllocationStrategyV4Response={...planned,protocol:externalAllocationStrategyV4Protocol,scope:'external-fulfillment'};
const externalError:ExternalAllocationStrategyV4Response={...externalPlanned,status:'error',errorCode:'unavailable'};
// @ts-expect-error External preparation snapshots require a preparation identity.
const missingPreparation:ExternalAllocationStrategyRequest={...externalV1,context:v1.context};
// @ts-expect-error External eligibility snapshots require personalized mode.
const stockExternal:ExternalAllocationStrategyV2Request={...externalV2,context:{...externalV2.context,mode:'stock'}};
// @ts-expect-error External protocol and strategy versions must agree.
const mixedExternal:ExternalAllocationStrategyV4Request={...externalV4,context:externalV3.context};
// @ts-expect-error External responses require the external protocol envelope.
const catalogExternalReply:ExternalAllocationStrategyV4Response=planned;
// @ts-expect-error External planned replies do not carry request context.
const externalContextReply:ExternalAllocationStrategyV4Response={...externalPlanned,context:externalV4.context};
void [remoteStockScope,remoteStockSupports,externalAllocationStrategySchema,externalAllocationStrategyV2Schema,externalAllocationStrategyV3Schema,externalAllocationStrategyV4Schema,externalMode,externalError,missingPreparation,stockExternal,mixedExternal,catalogExternalReply,externalContextReply];

import {createRemoteExternalAllocationStrategy, externalAllocationStrategyV4Protocol as remoteExternalV4Protocol} from '@digital-card/framework/remote-external-allocation-strategy';
const remoteExternal=createRemoteExternalAllocationStrategy({algorithm:'weighted-deck@4',scope:'external-fulfillment',providerId:'example.allocator',url:'https://allocator.example/external',token:'example-provider-token'});
remoteExternal.assertGrant(remoteExternal.grant());
const remoteExternalScope:'external-fulfillment'=remoteExternal.setEnabled(true).scope;
const remoteExternalSupports:boolean=remoteExternal.supportsAlgorithm(input);
remoteExternal.evaluate(externalV4,{signal:new AbortController().signal}).then(reply=>{
  const protocol:typeof remoteExternalV4Protocol=reply.protocol;
  const status:'planned'=reply.status;
  reply.allocations.map(row=>row.variantIds);
  // @ts-expect-error Error frames reject instead of resolving.
  reply.errorCode;
  void [protocol,status];
});
remoteExternal.evaluate(externalV1).then(reply=>{const protocol:typeof externalAllocationStrategyProtocol=reply.protocol;void protocol;});
remoteExternal.close();
// @ts-expect-error External adapters require external-fulfillment scope.
createRemoteExternalAllocationStrategy({algorithm:'weighted-deck@4',scope:'commerce-stock',providerId:'example.allocator',url:'https://allocator.example',token:'example-provider-token'});
// @ts-expect-error External adapters require a supported algorithm selector.
createRemoteExternalAllocationStrategy({algorithm:'weighted-deck@5',scope:'external-fulfillment',providerId:'example.allocator',url:'https://allocator.example',token:'example-provider-token'});
// @ts-expect-error External adapters accept external preparation envelopes.
remoteExternal.evaluate(v4);
// @ts-expect-error Stock envelopes cannot be sent to the external adapter.
remoteExternal.evaluate(stockV4);
void [remoteExternalScope,remoteExternalSupports];
