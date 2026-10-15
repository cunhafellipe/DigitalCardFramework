import type {Schemas, Operations} from './wire-types.js';
import type {PermissionActor} from './access.js';
import type {ExternalCreditInput} from './currency-gateway.js';

export type CoreActor = PermissionActor;
export type CoreUserActor = PermissionActor & {userId: string};
export type CorePreferences = Required<Pick<Schemas['Preferences'], 'inventoryVisibility' | 'favoriteCopyIds' | 'wishlistCardIds' | 'blockedUserIds'>>;
export interface CoreUser {
  id: string;
  provider: string;
  subject: string;
  displayName: string;
  createdAt: string;
  preferences?: CorePreferences;
}
export type CoreSiteStatus = Required<Schemas['AdminSiteChanges']>;
export type CoreUserRestrictions = Required<Schemas['AdminUserChanges']>;
export type CoreCatalog = Schemas['CatalogManifest'] & {
  features: Required<NonNullable<Schemas['CatalogManifest']['features']>>;
  capabilities: Schemas['CapabilityProfile'];
  cardTypes: NonNullable<Schemas['CatalogManifest']['cardTypes']>;
  recipes: NonNullable<Schemas['CatalogManifest']['recipes']>;
  combinations: NonNullable<Schemas['CatalogManifest']['combinations']>;
  displayFields: NonNullable<Schemas['CatalogManifest']['displayFields']>;
  metadataSchemas: NonNullable<Schemas['CatalogManifest']['metadataSchemas']>;
};
export type CorePublicCatalog = Schemas['PublicCatalog'] & {adminStatus: {revision: number; site: CoreSiteStatus}};
/** Authentication adapters add public role and permission fields to the HTTP response separately. */
export type CoreMe = Pick<Schemas['Me'], 'userId' | 'displayName'> & {
  preferences: CorePreferences;
  adminStatus: {site: CoreSiteStatus; restrictions: CoreUserRestrictions};
};
export interface CoreEvent {
  id: string;
  sequence: number;
  type: string;
  data: Record<string, unknown>;
  at: string;
  completionId?: string;
}
export interface CoreOperations {
  close(): void;
  catalog(): CorePublicCatalog;
  catalogVersion(): number;
  publishCatalog(actor: CoreActor, manifest: unknown): CorePublicCatalog;
  operatorCatalog(actor: CoreActor): CoreCatalog;
  previewImport(actor: CoreActor, input: Operations['previewImport']['request']): Operations['previewImport']['response'];
  commitImport(actor: CoreActor, input: Operations['commitImport']['request']): Operations['commitImport']['response'];
  userByIdentity(actor: CoreActor, input: {provider: string; subject: string}): CoreUser | null;
  providerIdentity(actor: CoreActor, userId: string): {provider: string; subject: string} | null;
  registerUser(actor: CoreActor, input: {provider: string; subject: string; displayName: string}): CoreUser;
  grantCurrency(actor: CoreActor, input: {userId: string; currencyId: string; amount: number; reason: string; key: string}): {
    userId: string; currencyId: string; amount: number; balance: number;
  };
  settleExternalCredit(actor: CoreActor, input: ExternalCreditInput): Schemas['ExternalCreditReceipt'];
  me(actor: CoreUserActor): CoreMe;
  setPreferences(actor: CoreUserActor, input: Operations['setPreferences']['request']): CorePreferences;
  capabilities(actor: CoreUserActor): Schemas['CapabilityAvailability'];
  wallet(actor: CoreUserActor): Record<string, number>;
  history(actor: CoreUserActor): Schemas['LedgerEntry'][];
  quote(actor: CoreUserActor, input: Operations['quote']['request']): Operations['quote']['response'];
  availability(): Operations['availability']['response'];
  pityProgress(actor: CoreUserActor): Record<string, number>;
  purchase(actor: CoreUserActor, input: Operations['purchase']['request']): Operations['purchase']['response'];
  purchaseAsync(actor: CoreUserActor, input: Operations['purchase']['request'], options?: {signal?: AbortSignal}): Promise<Operations['purchase']['response']>;
  packs(actor: CoreUserActor): Schemas['PackView'][];
  inventory(actor: CoreUserActor): Schemas['InventoryCopy'][];
  inspectCard(actor: CoreUserActor, copyId: string): Schemas['Copy'];
  openPack(actor: CoreUserActor, input: Operations['openPack']['request']): Schemas['Receipt'];
  openCard(actor: CoreUserActor, input: Operations['openCard']['request']): Schemas['Copy'];
  consumeBinding(actor: CoreUserActor, input: Operations['consumeBinding']['request']): Schemas['BindingUseReceipt'];
  bindings(actor: CoreUserActor): Schemas['HeldBinding'][];
  events(actor: CoreActor, options?: {after?: number; limit?: number}): CoreEvent[];
}
