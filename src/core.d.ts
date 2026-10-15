import type {CoreOperations, CoreActor, CoreUser} from './core-operations.js';
import type {Schemas} from './wire-types.js';
import type {ActionJson} from './action-contracts.js';
import type {CodeVault} from './code-vault.js';
import type {IssuedCodeResult} from './code-issuance-contracts.js';
import type {PureCodeIssuerOptions, RemoteCodeIssuerOptions} from './remote-code-issuer.js';
import type {PureBindingFactoryOptions, RemoteBindingFactoryOptions} from './remote-binding-factory.js';
import type {BindingFactoryInput} from './binding-factory-contracts.js';
import type {CommittedAction} from './remote-actions.js';
import type {TradePolicyRequest} from './trade-policy-contracts.js';
import type {RemotePurchasePolicyOptions} from './remote-purchase-policy.js';
import type {RemoteListingPolicyOptions} from './remote-listing-policy.js';
import type {RemoteTransferPolicyOptions} from './remote-transfer-policy.js';
import type {RemoteTradePolicyOptions} from './remote-trade-policy.js';
import type {RemoteAllocationStrategyOptions} from './remote-allocation-strategy.js';
import type {RemoteStockAllocationStrategyOptions} from './remote-stock-allocation-strategy.js';
import type {RemoteExternalAllocationStrategyOptions} from './remote-external-allocation-strategy.js';
import type {FrameworkStorage} from './storage-record-types.js';

/** Capabilities needed across the complete framework operation surface. */
export type FrameworkStore = Pick<FrameworkStorage,
  'read' | 'transact' | 'query' | 'measure' | 'transactRecords' | 'prepareRecordTransactions' | 'close'> &
  Partial<Pick<FrameworkStorage, 'selectDueRaffles' | 'selectDueExpirations'>> & {
    selectDueActions?(at: string, limit?: number): string[];
  };

export type FrameworkLimits = Partial<Record<
  'users' | 'copies' | 'packs' | 'requests' | 'albums' | 'trades' | 'copiesPerUser' | 'packsPerUser' |
  'actionJobs' | 'shops' | 'listings' | 'orders' | 'events' | 'commandIntents' |
  'completionRequests' | 'completionJobs' | 'completionEvents' | 'completionObligations' | 'completionBytes', number>>;
/** Raw copy fields supplied to trusted synchronous host integrations. */
export type FrameworkCopy = Schemas['Copy'] & {
  source: Record<string, unknown>; version: number; createdAt: string; acquiredAt: string;
  openedAt: string | null; openedBy: string | null; serialNumber: number | null; editionTotal: number | null;
  codeIds?: string[]; lockedBy?: string;
};
export type FrameworkUser = CoreUser & {lastTradeAt?: string};
export interface FrameworkBindingContext {
  copy: FrameworkCopy;
  user: FrameworkUser;
  spec: BindingFactoryInput['spec'] & {data: Record<string, ActionJson>};
}
export interface FrameworkPolicies {
  canList?(context: {actor: CoreActor; shop: Schemas['ShopRecord']; listing: Schemas['ListingRecord']}): boolean | string;
  canPurchase?(context: {user: FrameworkUser; shop: Schemas['ShopRecord']; listing: Schemas['ListingRecord']}): boolean | string;
  canTransfer?(copy: FrameworkCopy, fromUserId: string, context: {channel: 'trade' | 'sale'; toUserId: string | null}): boolean | string;
  canTrade?(context: TradePolicyRequest['context']): boolean | string;
}
export interface FrameworkActionOptions {maxAttempts?: number; leaseMs?: number; timeoutMs?: number; retryMs?: number}
export interface FrameworkEventSubscription {id: string; handler: string; events: readonly string[]}
export interface FrameworkExternalPurchaseProvider {
  /** These attestations run synchronously; asynchronous results are rejected. */
  validateIntent(context: {intent: Schemas['ExternalPurchaseIntent']; user: FrameworkUser}): boolean;
  verifyProof(context: {
    proof: Schemas['ExternalDebitProof'] | Schemas['ExternalNoDebitProof'] | Schemas['ExternalRefundProof'];
    intent: Schemas['ExternalPurchaseIntent']; preparationId: string;
    operation: 'debit' | 'no_debit' | 'refund' | 'resolve_legacy';
  }): boolean;
}
export interface FrameworkRemotePolicies {
  canPurchase?: RemotePurchasePolicyOptions;
  canList?: RemoteListingPolicyOptions;
  canTransfer?: RemoteTransferPolicyOptions;
  canTrade?: RemoteTradePolicyOptions;
}
export interface FrameworkOptions {
  store?: FrameworkStore;
  clock?(): string;
  random?(maximum: number): number;
  raffleRandom?(maximum: number): number;
  limits?: FrameworkLimits;
  bindings?: Readonly<Record<string, (context: FrameworkBindingContext) => Record<string, ActionJson>>>;
  policies?: FrameworkPolicies;
  codeVault?: CodeVault;
  codeLimits?: {maxCodes?: number; maxRequests?: number};
  codeGenerators?: Readonly<Record<string, (context: {copy: FrameworkCopy; pool: Schemas['CodePoolRecord']}) => IssuedCodeResult>>;
  allocationCodeIssuers?: Record<string, PureCodeIssuerOptions | RemoteCodeIssuerOptions>;
  allocationBindingFactories?: Record<string, PureBindingFactoryOptions | RemoteBindingFactoryOptions>;
  /** Handler completion is awaited; its return value is ignored. */
  actionHandlers?: Readonly<Record<string, (job: CommittedAction & {signal: AbortSignal}) => unknown>>;
  actionOptions?: FrameworkActionOptions;
  eventSubscriptions?: readonly FrameworkEventSubscription[];
  externalPurchaseProviders?: Readonly<Record<string, FrameworkExternalPurchaseProvider>>;
  externalPurchaseLimits?: {pendingPerUser?: number; pendingPerProvider?: number; records?: number};
  remotePolicies?: FrameworkRemotePolicies;
  remoteAllocation?: RemoteAllocationStrategyOptions | null;
  remoteStockAllocation?: RemoteStockAllocationStrategyOptions | null;
  remoteExternalAllocation?: RemoteExternalAllocationStrategyOptions | null;
}
export interface CardFramework extends CoreOperations {}
export class CardFramework {
  constructor(options?: FrameworkOptions);
}
