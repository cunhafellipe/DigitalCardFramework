import type { Operations, Schemas } from './wire-types.js';
export declare class WireApiError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(error: Schemas['Error'], status: number);
}
export interface WireTransportOptions {
    baseUrl?: string;
    fetch?: typeof globalThis.fetch;
    principal: () => string | null;
}
export type WireCallOptions<K extends keyof Operations> = {
    signal?: AbortSignal;
} & ({} extends Operations[K]['path'] ? {
    path?: Operations[K]['path'];
} : {
    path: Operations[K]['path'];
}) & ({} extends Operations[K]['query'] ? {
    query?: Operations[K]['query'];
} : {
    query: Operations[K]['query'];
});
export type WireCallArguments<K extends keyof Operations> = {} extends WireCallOptions<K> ? [options?: WireCallOptions<K>] : [options: WireCallOptions<K>];
export declare function createWireTransport({ baseUrl, fetch: request, principal }: WireTransportOptions): <K extends keyof Operations>(id: K, input: Operations[K]['request'], ...args: WireCallArguments<K>) => Promise<Operations[K]['response']>;
