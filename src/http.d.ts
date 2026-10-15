import type {IncomingMessage, ServerResponse, Server, OutgoingHttpHeader} from 'node:http';
import type {CoreOperations, CoreUserActor, CoreActor} from './core-operations.js';
import type {CurrencyGateway} from './currency-gateway.js';
import type {CodeGateway} from './code-gateway.js';

type HttpOperation =
  'acceptTrade' | 'acknowledgeAllocation' | 'acknowledgeCommandIntent' | 'actionJobs' |
  'activateCardPolicy' | 'adminHistory' | 'adminOverview' | 'adminUser' | 'adminUsers' |
  'administerCards' | 'albums' | 'allocationStatus' | 'audit' | 'availability' |
  'bindingFactoryStatus' | 'bindings' | 'buyListing' | 'cancelListing' | 'cancelTrade' |
  'capabilities' | 'cardPolicies' | 'catalog' | 'codeHistory' | 'codeInventory' |
  'codeIssuanceStatus' | 'codePools' | 'commandIntents' | 'commerceSettings' | 'commitImport' |
  'configureAdmin' | 'configureCodePool' | 'configureCommerce' | 'configureTrading' |
  'confirmCodeStatus' | 'consumeBinding' | 'convert' | 'counterTrade' | 'createListing' |
  'createShop' | 'directory' | 'drawRaffle' | 'effectiveCardPolicy' | 'enterRaffle' |
  'executeCommandIntent' | 'fulfillments' | 'history' | 'importCodes' | 'inspectCard' |
  'inventory' | 'inventoryPage' | 'listings' | 'me' | 'notifications' | 'openCard' |
  'openPack' | 'operatorCatalog' | 'orders' | 'packs' | 'pityProgress' | 'previewCardPolicy' |
  'previewImport' | 'proposeTrade' | 'publicAlbums' | 'purchase' | 'quote' | 'quoteListing' |
  'quoteMintPackStock' | 'raffleStatus' | 'readNotifications' | 'recoverBindingFactories' |
  'recoverCodeIssuance' | 'registerCommandIntent' | 'reportCodeUsage' | 'restoreCardPolicy' |
  'restoreCardResource' | 'retireCardPolicy' | 'retireCardResource' | 'retryAction' |
  'revealCode' | 'saveAlbum' | 'saveCardPolicy' | 'saveCardResource' | 'setCardTransferLock' |
  'setPreferences' | 'setShopEnabled' | 'shops' | 'stockAllocationStatus' | 'tradeInventory' |
  'tradeUp' | 'trades' | 'tradingPolicy' | 'updateCopyStats' | 'viewAlbum' | 'wallet';
type HttpAcceleratedOperation = 'acceptTradeAsync' | 'buyListingAsync' | 'counterTradeAsync' |
  'createListingAsync' | 'executeCommandIntentAsync' | 'proposeTradeAsync' | 'purchaseAsync' | 'quoteListingAsync';
type AwaitedOperation<K extends keyof CoreOperations> =
  (...args: Parameters<CoreOperations[K]>) => Awaited<ReturnType<CoreOperations[K]>> | PromiseLike<Awaited<ReturnType<CoreOperations[K]>>>;
/** The host awaits service results, including worker-backed implementations. */
export type HttpFramework = {[K in HttpOperation]: AwaitedOperation<K>} &
  {[K in HttpAcceleratedOperation]?: AwaitedOperation<K>} & (
    {reviewTransferAsync: AwaitedOperation<'reviewTransferAsync'>} |
    {reviewTransfer: AwaitedOperation<'reviewTransferAsync'>}
  );
export interface ApiRequestObservation {
  requestId: OutgoingHttpHeader | undefined;
  method: string | undefined;
  path: string;
  status: number;
}
export interface ApiHandlerOptions<A extends CoreActor = CoreUserActor> {
  framework: HttpFramework;
  resolveIdentity(request: IncomingMessage): A | null | undefined | PromiseLike<A | null | undefined>;
  allowedOrigin?: string;
  exposeOperators?: boolean;
  requireTradeReview?: boolean;
  requirePrincipal?: boolean;
  currencyGateway?: Pick<CurrencyGateway<A & {userId: string}>, 'reconcile'>;
  codeGateway?: Pick<CodeGateway<A & {userId: string}>, 'reconcile'>;
  /** Evaluated synchronously before dispatch; false rejects the request. */
  rateLimit?(context: {actor: A | null | undefined; request: IncomingMessage; mutation: boolean}): boolean;
  onRequest?(observation: ApiRequestObservation): void;
}
export type ApiHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
/** Returns false for paths outside /api/ so the caller can serve other routes. */
export function createApiHandler<A extends CoreActor = CoreUserActor>(options: ApiHandlerOptions<A>): ApiHandler;
export function createFrameworkServer<A extends CoreActor = CoreUserActor>(options: ApiHandlerOptions<A>): Server;
