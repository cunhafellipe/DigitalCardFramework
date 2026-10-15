import type {AlbumMotionConfiguration, AlbumMotionController, AlbumMotionInput, AlbumMotionState} from './album-motion.js';
import type {PerformanceQuality} from './performance.js';
import type {DirectoryResolver} from './resolver.js';

export interface PresentationReference {
  contract: 'digital-card@0.1';
  digest: string;
  baseURL: string;
}
/** Returns the same reference after validating its fields and location. */
export function validatePresentationReference(reference: unknown): PresentationReference;
export type PublicInputRule = {type: 'number'; default: number; min?: number; max?: number} |
  {type: 'boolean'; default: boolean};
export interface PublicInputManifest {inputs?: Readonly<Record<string, PublicInputRule>>}
export type PublicInputValues = Record<string, number | boolean>;
export function publicInputs(manifest: PublicInputManifest, values?: Readonly<Record<string, unknown>>): PublicInputValues;
/** Structural resolver subset consumed by the integration helpers. */
export interface PresentationResolver {
  manifest: PublicInputManifest;
  dispose(): void;
}
export interface PresentationView {
  setInputs(input: AlbumMotionInput): void;
  dispose(): void;
}
export interface PresentationEvent {
  type?: string;
  code?: string;
  [field: string]: unknown;
}
export interface PresentationStage<R extends PresentationResolver = PresentationResolver, V extends PresentationView = PresentationView> {
  mount(target: HTMLElement, model: {title: string | undefined; resolver: R}, options: {
    quality: PerformanceQuality;
    inputMode: string;
    onEvent?: (event: PresentationEvent) => void;
  }): V;
}
export interface PresentationDefinition {
  presentation: PresentationReference;
  title?: string;
  name?: string;
}
export type PresentationResolverFactory<R extends PresentationResolver> =
  (baseURL: string, options: {digest: string; signal?: AbortSignal}) => Promise<R>;
export function mountPresentation<R extends PresentationResolver = DirectoryResolver, V extends PresentationView = PresentationView>(options: {
  stage: PresentationStage<NoInfer<R>, V>;
  target: HTMLElement;
  definition: PresentationDefinition;
  resolve?: PresentationResolverFactory<R>;
  quality?: PerformanceQuality;
  hostInputs?: Readonly<Record<string, unknown>>;
  onEvent?: (event: PresentationEvent) => void;
  inputMode?: string;
  signal?: AbortSignal;
}): Promise<V>;
export interface AssemblyMember {
  id: string;
  bounds: readonly [number, number, number, number];
  presentation?: PresentationReference;
  title?: string;
  name?: string;
  tilt?: readonly [number, number];
  motion?: AlbumMotionConfiguration;
}
export interface AssemblyView<V extends PresentationView = PresentationView> extends Pick<AlbumMotionController, 'snapshot' | 'dispose'> {
  views: V[];
  setInputs(input: AlbumMotionInput): void;
  setMemberInputs(id: string, input: AlbumMotionInput): void;
}
export function mountAssembly<R extends PresentationResolver, V extends PresentationView, M extends AssemblyMember>(options: {
  stage: PresentationStage<R, V>;
  root: HTMLElement;
  descriptor: {version: 1; members: readonly M[]};
  resolve?: PresentationResolverFactory<R>;
  interaction?: {
    defaults?: AlbumMotionConfiguration;
    rotate?: boolean;
    inputMode?: string;
    onChange?: (id: string, value: AlbumMotionState) => void;
  };
  missing?: (member: M) => string;
  signal?: AbortSignal;
}): Promise<AssemblyView<V>>;
export type ConnectedInputRead = {
  state: 'fresh' | 'stale'; at: number; values: PublicInputValues;
} | {state: 'offline'; at: null; values: PublicInputValues};
export function connectedInputs(manifest: PublicInputManifest, options?: {maxAgeMs?: number; clock?: () => number}): {
  update(values: Readonly<Record<string, unknown>>, options?: {at?: number}): void;
  read(): ConnectedInputRead;
  snapshot(): {at: number | null; values: PublicInputValues};
};
