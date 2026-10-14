export interface ImportIsolationOptions {
  backend: "windows-job" | "linux-cgroup";
  /** Per-job Windows committed-memory or Linux cgroup memory.max budget. */
  memoryBytes?: number;
  aggregateMemoryBytes?: number;
  /** Application-enforced staging byte budget; this is not an OS disk quota. */
  temporaryBytes?: number;
  aggregateTemporaryBytes?: number;
  cgroupRoot?: string;
  powershellPath?: string;
}
export interface ImportExecutionOptions {
  limits?: Record<string, number>;
  performance?: Record<string, unknown>;
  timeoutMs?: number;
  maxHeapMb?: number;
  signal?: AbortSignal;
}
export interface ImportExecutor {
  validate(file: string, options?: ImportExecutionOptions): Promise<ImportValidationResult>;
  publish(file: string, options: ImportExecutionOptions & { contentRoot: string; expectedDigest?: string }): Promise<ImportPublicationResult>;
  close(): Promise<void>;
}
export interface ImportResourceMeasurement { backend: "windows-job" | "linux-cgroup"; peakJobMemoryBytes: number; memoryLimitBytes: number; processMemoryLimitBytes?: number }
export interface ImportValidationResult { ok: true; digest: string; report: Record<string, unknown>; capabilities: { required: string[]; optional: string[] }; resources?: ImportResourceMeasurement }
export interface ImportPublicationResult { ok: true; digest: string; folder: string; report: Record<string, unknown>; resources?: ImportResourceMeasurement }
export function createImportExecutor(options: ImportIsolationOptions): Promise<ImportExecutor>;
