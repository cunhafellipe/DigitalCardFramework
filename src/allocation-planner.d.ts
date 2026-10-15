import type {AllocationStrategyVersion, AllocationStrategySelector, AllocationStrategyContext, AllocationSlot, AllocationVariant, AllocationCodeVariant, PackAllocation} from './allocation-strategy-contracts.js';

export declare const allocationAlgorithm: 'weighted-deck@1';
export declare const allocationAlgorithmV2: 'weighted-deck@2';
export declare const allocationAlgorithmV3: 'weighted-deck@3';
export declare const allocationAlgorithmV4: 'weighted-deck@4';
export declare function validateAllocationSelector(value: unknown): AllocationStrategySelector<AllocationStrategyVersion>;
/** The local planner also consumes stock snapshots without the stock envelope. */
export type AllocationPlannerContext = {[V in AllocationStrategyVersion]: V extends 1 ? AllocationStrategyContext<V> :
  Omit<AllocationStrategyContext<V>, 'mode'> & {mode: 'personalized' | 'stock'}
}[AllocationStrategyVersion];
export interface AllocationOutcome {allocations: PackAllocation[]; pityCount: number | null;}
export declare function planAllocation(context: AllocationPlannerContext): PackAllocation[];
export declare function allocationOutcome(context: AllocationPlannerContext): AllocationOutcome;
export declare function allocationCodeDemand(
  product: {slots: AllocationSlot[]},
  variants: (AllocationVariant & Partial<Pick<AllocationCodeVariant, 'codeDemand'>>)[],
  quantity: number,
): Map<string, number>;
