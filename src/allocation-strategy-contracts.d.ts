import type {Schemas} from './wire-types.js';
import type {PurchasePolicyIdentity} from './purchase-policy-contracts.js';

export type AllocationStrategyVersion = 1 | 2 | 3 | 4;
export type AllocationStrategySelector<V extends AllocationStrategyVersion> = V extends AllocationStrategyVersion ? {algorithm: `weighted-deck@${V}`; version: V; deckScope: 'purchase-slot'} : never;
export type AllocationSlot = Required<Pick<Schemas['PackSlot'], 'id' | 'role' | 'count' | 'probability'>> & {pool: Pick<Schemas['PackSlot']['pool'][number], 'variantId' | 'weight'>[]};
export interface AllocationVariant {id: string; remaining: number | null;}
export interface AllocationEligibilityVariant extends AllocationVariant {cardId: string; rarityRank: number;}
export interface AllocationCodeVariant extends AllocationEligibilityVariant {codeDemand: {poolId: string; count: number}[];}
export interface AllocationPity {after: number; rarityId: string; minimumRank: number;}
export interface AllocationPersonalization {
  duplicatePolicy: {scope: 'none' | 'pack' | 'inventory'; fallback: 'allow' | 'reject'};
  pity: AllocationPity | null;
}
export type AllocationProduct<V extends AllocationStrategyVersion> = {id: string; revision: number; strategy: AllocationStrategySelector<V>; slots: AllocationSlot[]} & (V extends 1 ? object : AllocationPersonalization);
export type AllocationStrategyContext<V extends AllocationStrategyVersion> = {
  userId: string;
  product: AllocationProduct<V>;
  quantity: number;
  variants: (V extends 1 ? AllocationVariant : V extends 2 ? AllocationEligibilityVariant : AllocationCodeVariant)[];
  entropy: {seed: string; cursor: number};
} & (V extends 1 ? object : {mode: 'personalized'; ownedCards: {cardId: string; owned: boolean}[]; pityCount: number})
  & (V extends 3 | 4 ? {codePools: {id: string; available: number}[]} : object);
export type AllocationStrategyIdentity<V extends AllocationStrategyVersion> = Omit<PurchasePolicyIdentity, 'protocol' | 'operation' | 'scope' | 'phase'> & {
  protocol: `digital-card-pack-allocation@${V}`;
  operation: 'allocatePacks'; scope: 'catalog-purchase'; phase: 'allocate'; attemptId: string;
};
export interface PackAllocation {packIndex: number; slotId: string; variantIds: string[];}
export type AllocationStrategyRequestFor<V extends AllocationStrategyVersion> = V extends AllocationStrategyVersion ? AllocationStrategyIdentity<V> & {context: AllocationStrategyContext<V>} : never;
export type AllocationStrategyResponseFor<V extends AllocationStrategyVersion> = V extends AllocationStrategyVersion ? AllocationStrategyIdentity<V> & (
  {status: 'planned'; allocations: PackAllocation[]} |
  {status: 'error'; errorCode: 'invalid-request' | 'unauthenticated' | 'rate-limited' | 'unavailable'}
) : never;
export type AnyAllocationStrategyRequest = AllocationStrategyRequestFor<AllocationStrategyVersion>;
export type AnyAllocationStrategyResponse = AllocationStrategyResponseFor<AllocationStrategyVersion>;
/** Shared eligibility checks also admit stock mode after a stock adapter normalizes its envelope. */
export type AllocationEligibilityRequest<V extends 2 | 3 | 4> = V extends 2 | 3 | 4 ? AllocationStrategyIdentity<V> & {context: Omit<AllocationStrategyContext<V>, 'mode'> & {mode: 'personalized' | 'stock'}} : never;

export type AllocationStrategyRequest = AllocationStrategyRequestFor<1>;
export type AllocationStrategyResponse = AllocationStrategyResponseFor<1>;
export declare const allocationStrategyProtocol: 'digital-card-pack-allocation@1';
export declare const allocationStrategySchema: Record<string, unknown>;
export declare function validateAllocationStrategyRequest(value: unknown): AllocationStrategyRequest;
export declare function validateAllocationStrategyResponse(value: unknown): AllocationStrategyResponse;

export type AllocationStrategyV2Request = AllocationStrategyRequestFor<2>;
export type AllocationStrategyV2Response = AllocationStrategyResponseFor<2>;
export declare const allocationStrategyV2Protocol: 'digital-card-pack-allocation@2';
export declare const allocationStrategyV2Schema: Record<string, unknown>;
export declare function validateAllocationStrategyV2Request(value: unknown): AllocationStrategyV2Request;
export declare function validateAllocationStrategyV2Response(value: unknown): AllocationStrategyV2Response;

export type AllocationStrategyV3Request = AllocationStrategyRequestFor<3>;
export type AllocationStrategyV3Response = AllocationStrategyResponseFor<3>;
export declare const allocationStrategyV3Protocol: 'digital-card-pack-allocation@3';
export declare const allocationStrategyV3Schema: Record<string, unknown>;
export declare function validateAllocationStrategyV3Request(value: unknown): AllocationStrategyV3Request;
export declare function validateAllocationStrategyV3Response(value: unknown): AllocationStrategyV3Response;

export type AllocationStrategyV4Request = AllocationStrategyRequestFor<4>;
export type AllocationStrategyV4Response = AllocationStrategyResponseFor<4>;
export declare const allocationStrategyV4Protocol: 'digital-card-pack-allocation@4';
export declare const allocationStrategyV4Schema: Record<string, unknown>;
export declare function validateAllocationStrategyV4Request(value: unknown): AllocationStrategyV4Request;
export declare function validateAllocationStrategyV4Response(value: unknown): AllocationStrategyV4Response;

/** Additional cross-field checks on a structurally validated v2 eligibility snapshot. */
export declare function validateAllocationEligibility<T extends AllocationEligibilityRequest<2>>(value: T): T;
/** Additional resource checks on a structurally validated v3/v4 snapshot. */
export declare function validateAllocationCodeEligibility<T extends AllocationEligibilityRequest<3 | 4>>(value: T): T;
/** Also enforces bounded solver admission for the validated v4 snapshot. */
export declare function validateAllocationFeasibilityEligibility<T extends AllocationEligibilityRequest<4>>(value: T): T;
