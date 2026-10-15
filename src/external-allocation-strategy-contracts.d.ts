import type {AllocationStrategyVersion, AllocationStrategyIdentity, AllocationStrategyContext, AllocationStrategyResponseFor} from './allocation-strategy-contracts.js';

export type ExternalAllocationStrategyIdentity<V extends AllocationStrategyVersion> = Omit<AllocationStrategyIdentity<V>, 'protocol' | 'scope'> & {
  protocol: `digital-card-external-allocation@${V}`; scope: 'external-fulfillment';
};
export type ExternalAllocationStrategyContext<V extends AllocationStrategyVersion> = AllocationStrategyContext<V> & {preparationId: string};
export type ExternalAllocationStrategyRequestFor<V extends AllocationStrategyVersion> = V extends AllocationStrategyVersion ?
  ExternalAllocationStrategyIdentity<V> & {context: ExternalAllocationStrategyContext<V>} : never;
export type ExternalAllocationStrategyResponseFor<V extends AllocationStrategyVersion> = V extends AllocationStrategyVersion ?
  ExternalAllocationStrategyIdentity<V> & Omit<Extract<AllocationStrategyResponseFor<V>, {status: 'planned'}>, keyof AllocationStrategyIdentity<V>> |
  ExternalAllocationStrategyIdentity<V> & Omit<Extract<AllocationStrategyResponseFor<V>, {status: 'error'}>, keyof AllocationStrategyIdentity<V>> : never;
export type AnyExternalAllocationStrategyRequest = ExternalAllocationStrategyRequestFor<AllocationStrategyVersion>;
export type AnyExternalAllocationStrategyResponse = ExternalAllocationStrategyResponseFor<AllocationStrategyVersion>;

export type ExternalAllocationStrategyRequest = ExternalAllocationStrategyRequestFor<1>;
export type ExternalAllocationStrategyResponse = ExternalAllocationStrategyResponseFor<1>;
export declare const externalAllocationStrategyProtocol: 'digital-card-external-allocation@1';
export declare const externalAllocationStrategySchema: Record<string, unknown>;
export declare function validateExternalAllocationStrategyRequest(value: unknown): ExternalAllocationStrategyRequest;
export declare function validateExternalAllocationStrategyResponse(value: unknown): ExternalAllocationStrategyResponse;

export type ExternalAllocationStrategyV2Request = ExternalAllocationStrategyRequestFor<2>;
export type ExternalAllocationStrategyV2Response = ExternalAllocationStrategyResponseFor<2>;
export declare const externalAllocationStrategyV2Protocol: 'digital-card-external-allocation@2';
export declare const externalAllocationStrategyV2Schema: Record<string, unknown>;
export declare function validateExternalAllocationStrategyV2Request(value: unknown): ExternalAllocationStrategyV2Request;
export declare function validateExternalAllocationStrategyV2Response(value: unknown): ExternalAllocationStrategyV2Response;

export type ExternalAllocationStrategyV3Request = ExternalAllocationStrategyRequestFor<3>;
export type ExternalAllocationStrategyV3Response = ExternalAllocationStrategyResponseFor<3>;
export declare const externalAllocationStrategyV3Protocol: 'digital-card-external-allocation@3';
export declare const externalAllocationStrategyV3Schema: Record<string, unknown>;
export declare function validateExternalAllocationStrategyV3Request(value: unknown): ExternalAllocationStrategyV3Request;
export declare function validateExternalAllocationStrategyV3Response(value: unknown): ExternalAllocationStrategyV3Response;

export type ExternalAllocationStrategyV4Request = ExternalAllocationStrategyRequestFor<4>;
export type ExternalAllocationStrategyV4Response = ExternalAllocationStrategyResponseFor<4>;
export declare const externalAllocationStrategyV4Protocol: 'digital-card-external-allocation@4';
export declare const externalAllocationStrategyV4Schema: Record<string, unknown>;
export declare function validateExternalAllocationStrategyV4Request(value: unknown): ExternalAllocationStrategyV4Request;
export declare function validateExternalAllocationStrategyV4Response(value: unknown): ExternalAllocationStrategyV4Response;
