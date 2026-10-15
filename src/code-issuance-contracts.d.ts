import type {ActionJson} from './action-contracts.js';

export interface CodeIssuanceIdentity {
  protocol: 'digital-card-code-issuance@1';
  operation: 'issue' | 'lookup' | 'cancel';
  requestId: string;
  providerId: string;
  grantId: string;
  generation: number;
  batchId: string;
  inputDigest: string;
  deadline: number;
}
export interface CodeIssuanceEntry {
  issuanceId: string;
  inputDigest: string;
  attemptId: string;
  codeId: string;
  copyId: string;
  userId: string;
  poolId: string;
  variantId: string;
  packIndex: number;
  slotId: string;
  slotOrdinal: number;
  attachmentId: string;
  attachmentIndex: number;
}
export interface CodeIssuanceRequest extends CodeIssuanceIdentity {
  context: {entries: CodeIssuanceEntry[]};
}
export interface IssuedCodeResult {
  code: string;
  externalId?: string;
  metadata?: {[key: string]: ActionJson};
}
export type CodeIssuanceResult = CodeIssuanceEntry & (
  | {state: 'issued'; result: IssuedCodeResult}
  | {state: 'pending' | 'not-issued' | 'cancelled'}
  | {state: 'error'; errorCode: 'unavailable' | 'conflict' | 'invalid-request'}
);
export type CodeIssuanceResponse = CodeIssuanceIdentity & (
  | {status: 'processed'; results: CodeIssuanceResult[]}
  | {status: 'error'; errorCode: 'invalid-request' | 'unauthenticated' | 'rate-limited' | 'unavailable'}
);
export declare const codeIssuanceProtocol: 'digital-card-code-issuance@1';
export declare const codeIssuanceSchema: Record<string, unknown>;
/** Enforces unique issuance IDs, bounded JSON and identifier/text constraints. */
export declare function validateCodeIssuanceRequest(value: unknown): CodeIssuanceRequest;
export declare function validateCodeIssuanceResponse(value: unknown): CodeIssuanceResponse;
/** Validates response entries against the request and returns them in request order. */
export declare function matchCodeIssuanceResults(request: CodeIssuanceRequest, response: unknown): CodeIssuanceResult[];
