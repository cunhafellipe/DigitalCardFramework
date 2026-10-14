import {createClient} from '@digital-card/framework/client';
import {createWireTransport} from '@digital-card/framework/wire-client';
const client=createClient();
async function inspect(){
  const availability=await client.capabilities();
  const version:1=availability.version;
  const configured:boolean=availability.configured.trading;
  const available:boolean=availability.available.directSales;
  const draining:Array<'packs'|'directSales'|'trading'|'resale'>=availability.draining;
  const codeHistory:boolean=availability.history.codes;
  const rewardHistory:boolean=availability.history.rewards;
  const catalog=await client.catalog();const primitive:boolean|undefined=catalog.capabilities?.primitives.issuance;
  return {version,configured,available,draining,primitive,codeHistory,rewardHistory};
}
void inspect;
const call=createWireTransport({principal:()=>null});
void call('capabilities',undefined);
// @ts-expect-error capabilities is an authenticated read, not a mutation
void call('capabilities',{packs:true});
// @ts-expect-error public workflow flags remain booleans
const flag:Promise<string>=client.capabilities().then(value=>value.available.packs);
void flag;

import {cardBehavior,cardTypeDefaults} from '@digital-card/framework/card-types';
const behavior=cardBehavior({id:'authored-card',name:'Example',type:'custom-type',behavior:{tradable:false}});
const canTrade:boolean=behavior.tradable;
const albumEligible:boolean=cardTypeDefaults.collectible.albumEligible;
// @ts-expect-error behavior overrides require boolean values
cardBehavior({behavior:{tradable:'yes'}});
// @ts-expect-error published defaults are immutable
cardTypeDefaults.collectible.tradable=false;
// @ts-expect-error only the built-in names index the defaults table
void cardTypeDefaults.custom;
void [canTrade,albumEligible];

import {PERMISSIONS,hasPermission,publicPermissions,authorizePresentation} from '@digital-card/framework/access';
import type {Permission} from '@digital-card/framework/access';
const grants:Permission[]=publicPermissions({userId:'user',permissions:['art.import']});
const allowed:boolean=hasPermission(null,'unknown.permission');
const ownImport:boolean=authorizePresentation({id:'artist',permissions:['art.import']},'read-import',{actor:'artist'});
// @ts-expect-error public permissions have a finite known vocabulary
const unknownPermission:Permission='unknown.permission';
// @ts-expect-error principal disabled flag is boolean
hasPermission({disabled:'false'},'art.import');
// @ts-expect-error the published permission vocabulary is immutable
PERMISSIONS.push('art.import');
void [grants,allowed,ownImport,unknownPermission];
