import type { ProviderResolveResult } from "@kunai/types";

/** Single ORG-quality stream often indicates a stripped Neon route payload (stale cache risk). */
export function isOrgOnlyProviderResolveResult(result: ProviderResolveResult): boolean {
  if (result.streams.length !== 1) return false;
  const stream = result.streams[0];
  if (!stream) return false;
  const label = stream.qualityLabel?.trim().toUpperCase() ?? "";
  if (label === "ORG" || label.includes("ORG-ONLY")) return true;
  const rank = stream.metadata?.qualityRank;
  return rank === 0 || rank === "0";
}
