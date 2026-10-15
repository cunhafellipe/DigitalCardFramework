import type {PresentationReference, PresentationResolverFactory} from './integration.js';
import type {PlayerBudget, PlayerAdapter, PlayerResolver, PlayerResult} from './player.js';
import type {PerformanceQuality} from './performance.js';
import type {AlbumMotionInput} from './album-motion.js';
import type {PresentationEvent} from './integration.js';

export interface PresentationCardCopy {
  definition: {name: string; presentation?: PresentationReference};
  variant?: {presentation?: PresentationReference};
}
export interface PortableCardNode extends HTMLElement {
  setPresentationInputs(input: AlbumMotionInput): void;
  setPresentationSide(side: 'front' | 'back'): Promise<PlayerResult | undefined> | undefined;
  dispose(): void;
}
export interface CardRendererOptions<C extends PresentationCardCopy> {
  fallbackRenderer?(copy: C, options: {onSelect?: (copy: C) => void}): HTMLElement | null | undefined;
  mode?: 'poster' | 'interactive';
  quality?: PerformanceQuality;
  resolve?: PresentationResolverFactory<PlayerResolver>;
  budget?: Partial<PlayerBudget>;
  adapters?: readonly PlayerAdapter[];
  preloadMargin?: string;
  onDiagnostic?(event: PresentationEvent): void;
}
/** Copies without presentation data use the fallback and may return an ordinary element. */
export function createCardRenderer<C extends PresentationCardCopy = PresentationCardCopy>(options?: CardRendererOptions<C>):
  (copy: C, options?: {onSelect?: (copy: C) => void}) => PortableCardNode | HTMLElement;
