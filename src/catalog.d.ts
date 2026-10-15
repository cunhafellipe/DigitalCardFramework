import type {CoreCatalog} from './core-operations.js';

export class FrameworkError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status?: number);
}
/** Validates and normalizes a detached catalog copy; invalid data throws FrameworkError. */
export function validateCatalog(input: unknown): CoreCatalog;
