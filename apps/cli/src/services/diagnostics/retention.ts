import { pruneOldestFiles } from "./prune-oldest-files";

export { pruneOldestFiles } from "./prune-oldest-files";

/** Default retention for diagnostics exports and JSONL traces. */
export const DIAGNOSTICS_FILE_RETENTION = 10;

export const DIAGNOSTICS_EXPORT_FILE_PATTERN = /^kunai-diagnostics-export-.*\.json$/;
export const DIAGNOSTICS_REPORT_FILE_PATTERN = /^kunai-diagnostics-report-.*\.json$/;
export const DIAGNOSTICS_TRACE_FILE_PATTERN = /^kunai-trace-.*\.jsonl$/;

/**
 * @deprecated Prefer {@link pruneOldestFiles} with an explicit RegExp pattern.
 * Kept for callers that still match by filename prefix.
 */
export async function pruneOldDiagnosticFiles({
  dir,
  prefix,
  maxFiles,
}: {
  readonly dir: string;
  readonly prefix: string;
  readonly maxFiles: number;
}): Promise<void> {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await pruneOldestFiles(dir, new RegExp(`^${escaped}`), maxFiles);
}
