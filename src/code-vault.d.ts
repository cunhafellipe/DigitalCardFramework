/// <reference types="node" />
import type {Buffer} from 'node:buffer';
import type {ActionJson} from './action-contracts.js';

export interface CodeVaultOptions {
  activeKeyId: string;
  /** Every encryption key must be a 32-byte Node.js Buffer. */
  keys: Readonly<Record<string, Buffer>>;
  /** Stable 32-byte key used for fingerprints across encryption-key rotations. */
  indexKey: Buffer;
}
export interface CodeEnvelope {
  version: 1;
  keyId: string;
  iv: string;
  tag: string;
  data: string;
}
export interface CodeVault {
  /** Fingerprints JSON with object keys sorted recursively. Array order is preserved. */
  fingerprint(value: ActionJson): string;
  seal(code: string, context: string): CodeEnvelope;
  /** Requires the same context used to seal the code. Authentication failure throws. */
  open(envelope: CodeEnvelope, context: string): string;
}
export declare function createCodeVault(options: CodeVaultOptions): Readonly<CodeVault>;
