import { lstat, rm, unlink } from "node:fs/promises";

export type DownloadPartialOutcome = "pause" | "retry" | "abort" | "fail";

/** Pause and retry keep the claim's partials. Terminal outcomes remove them. */
export function shouldRetainDownloadPartials(outcome: DownloadPartialOutcome): boolean {
  return outcome === "pause" || outcome === "retry";
}

/**
 * A partial this job may delete: its own temp path, or `${temp}.claim-<generation>`.
 * Anything else, including `..`, is refused.
 */
export function claimOwnedPartialPath(
  jobTempPath: string,
  candidate: string | undefined,
): string | undefined {
  if (!candidate || candidate.includes("\0")) return undefined;
  if (candidate.split(/[/\\]/).includes("..")) return undefined;
  if (candidate === jobTempPath) return candidate;
  const prefix = `${jobTempPath}.claim-`;
  if (!candidate.startsWith(prefix)) return undefined;
  const suffix = candidate.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return undefined;
  return candidate;
}

export async function removeClaimOwnedPartial(
  jobTempPath: string,
  candidate: string | undefined,
): Promise<"removed" | "absent" | "rejected" | "failed"> {
  const owned = claimOwnedPartialPath(jobTempPath, candidate);
  if (!owned) return "rejected";
  try {
    const info = await lstat(owned);
    if (info.isSymbolicLink()) {
      await unlink(owned);
      return "removed";
    }
    await rm(owned, { recursive: true, force: true });
    return "removed";
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) return "absent";
    return "failed";
  }
}
