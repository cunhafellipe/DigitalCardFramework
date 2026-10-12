import {serialize} from 'node:v8';
import {FrameworkError} from './catalog.js';

// Deliberate public operations only; store callbacks and prototype traversal never cross this boundary.
export const frameworkMethods = Object.freeze([
  'adminOverview','configureAdmin','adminUsers','adminUser','adminHistory','administerCards',
  'cardPolicies','effectiveCardPolicy','saveCardPolicy','previewCardPolicy','activateCardPolicy',
  'retireCardPolicy','restoreCardPolicy','saveCardResource','retireCardResource','restoreCardResource',
  'updateCopyStats','registerCardPresentation','commerceSettings','configureCommerce','createShop',
  'setShopEnabled','shops','createListing','listings','quoteListing','buyListing','orders','cancelListing',
  'expireListings','enterRaffle','raffleStatus','drawRaffle','drawDueRaffles','openCard','fulfillments',
  'actionJobs','retryAction','claimAction','settleAction','dispatchActions','tradingPolicy','configureTrading',
  'setCardTransferLock','configureCodePool','importCodes','codePools','codeInventory','codeRegistrationMaterial',
  'codeHistory','revealCode','reportCodeUsage','confirmCodeStatus','codeLookupMaterial','rotateCodeEncryption',
  'verifyCodeVault','backfillProvenance','audit','capabilities','workerPlan','backfillCompletionReservations',
  'commandIntent','commandIntents','registerCommandIntent','executeCommandIntent','executeCommandIntentAsync',
  'acknowledgeCommandIntent','me','setPreferences','directory','tradeInventory','inventoryPage',
  'collectionSummary','notifications','readNotifications','publishCatalog','operatorCatalog','previewImport',
  'commitImport','catalog','catalogVersion','userByIdentity','providerIdentity','registerUser','grantCurrency',
  'settleExternalCredit','prepareExternalPurchase','commitExternalPurchase','cancelExternalPurchase',
  'confirmExternalCompensation','externalPurchaseStatus','lookupExternalPurchase','pendingExternalPurchases',
  'reconcileLegacyExternalPurchase','resolveLegacyExternalPurchase','wallet','history','quote','availability',
  'pityProgress','purchase','purchaseAsync','packs','packsPage','packPage','openPack','inventory','inspectCard',
  'consumeBinding','convert','tradeUp','proposeTrade','counterTrade','sweepExpiredTrades','trades','acceptTrade',
  'cancelTrade','saveAlbum','albums','viewAlbum','publicAlbums','bindings','events',
]);
export const storeMethods = Object.freeze(['storeIntegrity','storeDiagnostics','prepareRecordTransactions','runtimeCapabilities']);
export const sessionMethods = Object.freeze(['sessionCreate','sessionGet','sessionConsume','sessionRevoke']);
export const frameworkOptionNames = Object.freeze([
  'clock','random','bindings','policies','limits','codeVault','codeLimits','codeGenerators','actionHandlers',
  'actionOptions','eventSubscriptions','raffleRandom','externalPurchaseProviders','externalPurchaseLimits',
]);
export function unavailable() {
  return new FrameworkError('WORKER_UNAVAILABLE','Framework worker is unavailable; reconcile mutations using their original idempotency keys',503);
}
export function encodeTransport(value, maxBytes = Infinity) {
  const seen = new Set();
  let nodes = 0, estimatedBytes = 0;
  const account = bytes => {
    estimatedBytes += bytes;
    if (estimatedBytes > maxBytes) throw new FrameworkError('WORKER_OVERLOADED','Framework worker input byte limit reached',503);
  };
  function visit(item, depth) {
    account(1);
    if (++nodes > 1000000 || depth > 64) throw new FrameworkError('WORKER_TRANSPORT','Worker input is too complex');
    if (typeof item === 'string') {
      if (item.length > maxBytes - estimatedBytes) account(item.length);
      account(Buffer.byteLength(item)); return;
    }
    if (item === null || ['undefined','boolean'].includes(typeof item)) return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object') throw new FrameworkError('WORKER_TRANSPORT','Worker values must be plain data; load callbacks through a trusted module');
    if (Buffer.isBuffer(item) || item instanceof Uint8Array && Object.getPrototypeOf(item) === Uint8Array.prototype) {
      if (item.buffer instanceof SharedArrayBuffer) throw new FrameworkError('WORKER_TRANSPORT','Shared memory is unsupported');
      account(item.byteLength); return;
    }
    const proto = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new FrameworkError('WORKER_TRANSPORT','Unsupported worker transport object');
    if (seen.has(item)) throw new FrameworkError('WORKER_TRANSPORT','Cyclic worker values are unsupported');
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item,key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor,'value') || !descriptor.enumerable && !(Array.isArray(item) && key === 'length'))
        throw new FrameworkError('WORKER_TRANSPORT','Worker values require enumerable data properties');
      account(Buffer.byteLength(key));
      if (key !== 'length' || !Array.isArray(item)) visit(descriptor.value,depth + 1);
    }
    seen.delete(item);
  }
  visit(value,0);
  return serialize(value);
}
export function serializeError(error) {
  if (error instanceof FrameworkError && typeof error.code === 'string' && typeof error.message === 'string' && Number.isInteger(error.status))
    return {code:error.code,message:error.message,status:error.status};
  return {code:'WORKER_FAILURE',message:'Framework operation could not be completed; reconcile mutations using their original idempotency keys',status:500};
}
