import type {ActionJson} from './action-contracts.js';
import type {CodeIssuanceIdentity} from './code-issuance-contracts.js';

export type BindingFactoryOperation = 'produce' | 'provision' | 'activate' | 'lookup' | 'cancel';
export type BindingFactoryKind = 'pure' | 'provision' | 'activation';
export interface BindingFactoryIdentity extends Omit<CodeIssuanceIdentity, 'protocol' | 'operation'> {
  protocol: 'digital-card-binding-factory@1';
  operation: BindingFactoryOperation;
}
export interface BindingFactoryEntry {
  invocationId: string; inputDigest: string; attemptId: string; copyId: string; userId: string;
  namespace: string; factoryName: string; factoryRevision: number; kind: BindingFactoryKind;
  packIndex: number; slotId: string; slotOrdinal: number;
}
export interface BindingFactoryCopy {
  id: string; ownerId: string; cardId: string; variantId: string; lineId: string; rarityId: string;
  state: 'sealed'; serialNumber: number | null; editionTotal: number | null;
  createdAt: string; openedAt: null; openedBy: null; acquiredAt: string; version: 1;
  source: Record<string, ActionJson>; definition: Record<string, ActionJson>;
  variant: Record<string, ActionJson> & {bindings?: never};
  bindings: Record<string, ActionJson>; metadata: Record<string, ActionJson>;
}
export interface BindingFactoryInput {
  copy: BindingFactoryCopy;
  user: Record<string, ActionJson> & {id: string};
  spec: Record<string, ActionJson> & {factory: string; visibility: 'public' | 'owner'; transfer: 'follow' | 'retain' | 'block'};
}
export type BindingFactoryRequestEntry = BindingFactoryEntry & {input: BindingFactoryInput};
export type BindingFactoryRequestFor<O extends BindingFactoryOperation> = O extends BindingFactoryOperation ?
  Omit<BindingFactoryIdentity, 'operation'> & {operation: O; context: {entries: (BindingFactoryRequestEntry & {
    kind: O extends 'produce' ? 'pure' : O extends 'provision' ? 'provision' : O extends 'activate' ? 'activation' : O extends 'cancel' ? 'pure' | 'provision' : BindingFactoryKind;
  })[]}} : never;
export type BindingFactoryRequest = BindingFactoryRequestFor<BindingFactoryOperation>;
export type BindingFactoryResult = BindingFactoryEntry & (
  | {state: 'ready'; data: Record<string, ActionJson>}
  | {state: 'pending' | 'not-created'}
  | {state: 'cancelled'; kind: 'pure' | 'provision'}
  | {state: 'not-activated'; kind: 'activation'}
  | {state: 'error'; errorCode: 'unavailable' | 'conflict' | 'invalid-request'}
);
export type BindingFactoryResponse = BindingFactoryIdentity & (
  | {status: 'processed'; results: BindingFactoryResult[]}
  | {status: 'error'; errorCode: 'invalid-request' | 'unauthenticated' | 'rate-limited' | 'unavailable'}
);
export declare const bindingFactoryProtocol: 'digital-card-binding-factory@1';
export declare const bindingFactorySchema: Record<string, unknown>;
/** Computes the content digest with the inputDigest property excluded. */
export declare function bindingFactoryInputDigest(value: object): string;
export declare function bindingFactoryIdentity(value: BindingFactoryEntry): BindingFactoryEntry;
/** Enforces bounded JSON, entry identities and operation/kind compatibility. */
export declare function validateBindingFactoryRequest(value: unknown): BindingFactoryRequest;
export declare function validateBindingFactoryResponse(value: unknown): BindingFactoryResponse;
/** Validates matching envelope and entry identities, returning results in request order. */
export declare function matchBindingFactoryResults(request: BindingFactoryRequest, response: unknown): BindingFactoryResult[];
