import type { DownloadJobRecord } from "@kunai/storage";

/**
 * The single derivation of a shell mode from a persisted download job.
 *
 * `mode` only arrived in migration 006, so older rows carry none and it has to
 * be recovered from `mediaKind`. That recovery was inlined in the stream
 * re-resolve path, and offline identity needs exactly the same answer — a
 * disagreement between the two is invisible until a title resolves under one id
 * and is stored under another.
 */
export function downloadJobShellMode(
  job: Pick<DownloadJobRecord, "mode" | "mediaKind">,
): "series" | "anime" | "youtube" {
  if (job.mode) return job.mode;
  if (job.mediaKind === "anime") return "anime";
  if (job.mediaKind === "video") return "youtube";
  return "series";
}
