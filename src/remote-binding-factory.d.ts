import type {ActionJson} from './action-contracts.js';
import type {BindingFactoryKind, BindingFactoryRequest, BindingFactoryRequestEntry, BindingFactoryRequestFor, BindingFactoryResponse} from './binding-factory-contracts.js';
import type {RemoteCodeProviderOptions} from './remote-code-provider.js';
import type {RemoteAllocationStrategy} from './remote-allocation-strategy.js';
export {bindingFactoryProtocol, bindingFactorySchema, validateBindingFactoryRequest, validateBindingFactoryResponse, bindingFactoryInputDigest} from './binding-factory-contracts.js';

export interface BindingFactoryConfiguration {
  kind: BindingFactoryKind;
  providerId: string;
  revision: number;
  userFields?: string[];
}
export interface BindingFactoryDescriptor extends Omit<BindingFactoryConfiguration, 'userFields'> {
  userFields: readonly string[];
}
export interface RemoteBindingFactoryOptions extends RemoteCodeProviderOptions, BindingFactoryConfiguration {
  /** Ignored: the adapter always fixes the transport scope to binding-factory. */
  scope?: unknown;
  produce?: never;
}
export interface PureBindingFactoryOptions extends Omit<BindingFactoryConfiguration, 'kind'> {
  kind: 'pure';
  /** Pure production must return JSON synchronously. */
  produce(entry: BindingFactoryRequestEntry & {kind: 'pure'}): Record<string, ActionJson>;
}
export interface BindingFactory extends BindingFactoryDescriptor, Pick<RemoteAllocationStrategy, 'grant' | 'assertGrant' | 'close'> {
  readonly timeoutMs: number;
  setEnabled(enabled: boolean): {providerId: string; enabled: boolean; generation: number; scope?: 'binding-factory'};
  /** Provider errors reject; processed entries may still be pending or failed. */
  evaluate(request: BindingFactoryRequest, options?: {signal?: AbortSignal}): Promise<Extract<BindingFactoryResponse, {status: 'processed'}>>;
}
export interface RemoteBindingFactory extends BindingFactory {
  setEnabled(enabled: boolean): {providerId: string; enabled: boolean; generation: number; scope: 'binding-factory'};
}
export type PureBindingFactoryRequest = BindingFactoryRequestFor<'produce' | 'lookup' | 'cancel'> & {context: {entries: (BindingFactoryRequestEntry & {kind: 'pure'})[]}};
export type PureBindingFactoryResponse = Omit<Extract<BindingFactoryResponse, {status: 'processed'}>, 'results'> & {
  results: (Omit<BindingFactoryRequestEntry, 'input' | 'kind'> & {kind: 'pure'} & (
    {state: 'ready'; data: Record<string, ActionJson>} | {state: 'not-created' | 'cancelled'}
  ))[];
};
export interface PureBindingFactory extends Omit<BindingFactory, 'kind' | 'evaluate' | 'setEnabled'> {
  readonly kind: 'pure';
  setEnabled(enabled: boolean): {providerId: string; enabled: boolean; generation: number};
  evaluate(request: PureBindingFactoryRequest, options?: {signal?: AbortSignal}): Promise<PureBindingFactoryResponse>;
}
export interface BindingFactoryRegistry {
  factories: Readonly<Record<string, PureBindingFactory | RemoteBindingFactory>>;
  close(): void;
}
/** Validates configuration and returns a descriptor with sorted, frozen user fields. */
export declare function bindingFactoryConfiguration(config: BindingFactoryConfiguration): BindingFactoryDescriptor;
/** Copies only granted user fields and enforces bounded JSON. */
export declare function snapshotBindingFactoryUser(user: Record<string, ActionJson>, fields: readonly string[]): Record<string, ActionJson>;
export declare function createRemoteBindingFactory(options: RemoteBindingFactoryOptions): RemoteBindingFactory;
export declare function createBindingFactoryRegistry(options?: {allocationBindingFactories?: Record<string, PureBindingFactoryOptions | RemoteBindingFactoryOptions>}): BindingFactoryRegistry;
