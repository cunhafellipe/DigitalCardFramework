/// <reference types="node" />
import type {Buffer} from 'node:buffer';
import type {ActionJson} from './action-contracts.js';

export interface StateCodec {
  encode(value: ActionJson): string;
  /** Parses state without validating its application-specific structure. */
  decode(body: string): unknown;
}
/** A supplied key must be a 32-byte Node.js Buffer. Omitting it uses plaintext JSON. */
export declare function createStateCodec(key?: Buffer): StateCodec;
/** Converts exactly 64 hexadecimal characters to a 32-byte Node.js Buffer. */
export declare function keyFromHex(value: string): Buffer;
export declare function keyFromHex(value?: undefined): undefined;
export declare function keyFromHex(value: string | undefined): Buffer | undefined;
