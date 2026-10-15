import type {AllocationStrategyVersion, AllocationStrategyIdentity, AllocationStrategyContext, PackAllocation} from './allocation-strategy-contracts.js';

export type StockAllocationStrategyIdentity<V extends AllocationStrategyVersion> = Omit<AllocationStrategyIdentity<V>, 'protocol' | 'scope'> & {
  protocol: `digital-card-commerce-stock-allocation@${V}`; scope: 'commerce-stock';
};
export type StockAllocationStrategyContext<V extends AllocationStrategyVersion> = Omit<AllocationStrategyContext<V>, 'mode'> &
  {shop: {id: string; ownerId: string}} & (V extends 1 ? object : {mode: 'stock'});
export type StockAllocationStrategyRequestFor<V extends AllocationStrategyVersion> = V extends AllocationStrategyVersion ?
  StockAllocationStrategyIdentity<V> & {context: StockAllocationStrategyContext<V>} : never;
export type StockAllocationStrategyResponseFor<V extends AllocationStrategyVersion> = V extends AllocationStrategyVersion ?
  StockAllocationStrategyIdentity<V> & (
    {status: 'planned'; allocations: PackAllocation[]} |
    {status: 'error'; errorCode: 'invalid-request' | 'unauthenticated' | 'rate-limited' | 'unavailable'}
  ) : never;
export type AnyStockAllocationStrategyRequest = StockAllocationStrategyRequestFor<AllocationStrategyVersion>;
export type AnyStockAllocationStrategyResponse = StockAllocationStrategyResponseFor<AllocationStrategyVersion>;
export type StockAllocationStrategyRequest = StockAllocationStrategyRequestFor<1>;
export type StockAllocationStrategyResponse = StockAllocationStrategyResponseFor<1>;
export declare const stockAllocationStrategyProtocol: 'digital-card-commerce-stock-allocation@1';
export declare const stockAllocationStrategySchema: Record<string, unknown>;
export declare function validateStockAllocationStrategyRequest(value: unknown): StockAllocationStrategyRequest;
export declare function validateStockAllocationStrategyResponse(value: unknown): StockAllocationStrategyResponse;
export type StockAllocationStrategyV2Request = StockAllocationStrategyRequestFor<2>;
export type StockAllocationStrategyV2Response = StockAllocationStrategyResponseFor<2>;
export declare const stockAllocationStrategyV2Protocol: 'digital-card-commerce-stock-allocation@2';
export declare const stockAllocationStrategyV2Schema: Record<string, unknown>;
export declare function validateStockAllocationStrategyV2Request(value: unknown): StockAllocationStrategyV2Request;
export declare function validateStockAllocationStrategyV2Response(value: unknown): StockAllocationStrategyV2Response;
export type StockAllocationStrategyV3Request = StockAllocationStrategyRequestFor<3>;
export type StockAllocationStrategyV3Response = StockAllocationStrategyResponseFor<3>;
export declare const stockAllocationStrategyV3Protocol: 'digital-card-commerce-stock-allocation@3';
export declare const stockAllocationStrategyV3Schema: Record<string, unknown>;
export declare function validateStockAllocationStrategyV3Request(value: unknown): StockAllocationStrategyV3Request;
export declare function validateStockAllocationStrategyV3Response(value: unknown): StockAllocationStrategyV3Response;
export type StockAllocationStrategyV4Request = StockAllocationStrategyRequestFor<4>;
export type StockAllocationStrategyV4Response = StockAllocationStrategyResponseFor<4>;
export declare const stockAllocationStrategyV4Protocol: 'digital-card-commerce-stock-allocation@4';
export declare const stockAllocationStrategyV4Schema: Record<string, unknown>;
export declare function validateStockAllocationStrategyV4Request(value: unknown): StockAllocationStrategyV4Request;
export declare function validateStockAllocationStrategyV4Response(value: unknown): StockAllocationStrategyV4Response;
