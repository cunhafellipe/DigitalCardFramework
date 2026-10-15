import type {StorageState} from './storage-types.js';
import type {FrameworkStorage} from './storage-record-types.js';

export function initialState(): StorageState;
export interface MemoryStore extends FrameworkStorage {}
export class MemoryStore {
  constructor();
}
