import type {CoreOperations} from './core-operations.js';

export type FrameworkLimits = Partial<Record<
  'users' | 'copies' | 'packs' | 'requests' | 'albums' | 'trades' | 'copiesPerUser' | 'packsPerUser' |
  'actionJobs' | 'shops' | 'listings' | 'orders' | 'events' | 'commandIntents' |
  'completionRequests' | 'completionJobs' | 'completionEvents' | 'completionObligations' | 'completionBytes', number>>;
export interface FrameworkOptions {
  clock?(): string;
  random?(maximum: number): number;
  raffleRandom?(maximum: number): number;
  limits?: FrameworkLimits;
}
export interface CardFramework extends CoreOperations {}
export class CardFramework {
  constructor(options?: FrameworkOptions);
}
