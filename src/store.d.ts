import type {StorageState, StorageSnapshotMethods} from './storage-types.js';

export function initialState(): StorageState;
export interface MemoryStore extends StorageSnapshotMethods {}
export class MemoryStore {
  constructor();
}
