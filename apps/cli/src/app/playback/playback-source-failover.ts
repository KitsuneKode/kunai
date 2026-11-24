import type { ProviderResolveResult } from "@kunai/types";

import type { RecentPlaybackStreamProvenance } from "./recent-playback-stream";

/** ~3 catalog sources + 1 provider hop before surfacing post-play recovery. */
export const MAX_STARTUP_FAILOVER_ATTEMPTS = 4;

/** Abort + mark dead only after this long with no first progress (slow CDNs need headroom). */
export const STARTUP_STALL_TIMEOUT_MS = 45_000;

export type StartupFailoverPlan =
  | { readonly kind: "advance-source"; readonly sourceId: string }
  | { readonly kind: "fallback-provider" }
  | { readonly kind: "give-up" };

/** Local artifacts have no provider source to refresh, invalidate, or fail over from. */
export function shouldUseProviderPlaybackRecovery(
  provenance: RecentPlaybackStreamProvenance,
): boolean {
  return provenance !== "local";
}

/**
 * Ordered source ids from a resolve result (catalog / inventory order).
 *
 * Sources the provider already reported `failed` or `exhausted` are left out:
 * failing over onto them spends a recovery attempt on a known-dead mirror.
 * `skipped` stays in — it marks a known source not tried yet, which a fresh
 * resolve can still reach.
 */
export function listOrderedPlaybackSourceIds(
  result: Pick<ProviderResolveResult, "sources" | "streams"> | null | undefined,
): readonly string[] {
  if (!result) return [];
  if (result.sources && result.sources.length > 0) {
    return result.sources
      .filter((source) => source.status !== "failed" && source.status !== "exhausted")
      .map((source) => source.id);
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const stream of result.streams) {
    const sourceId = stream.sourceId?.trim();
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    ids.push(sourceId);
  }
  return ids;
}

/**
 * Next untried catalog source after the current one, wrapping to the start.
 *
 * Playback often begins on a source that is not first (a saved favourite, a
 * pinned pick, a provider's own preference), so a forward-only walk never
 * reached the sources listed before it.
 */
export function pickNextCatalogSourceId(
  sourceIds: readonly string[],
  currentSourceId: string | null | undefined,
  triedSourceIds: ReadonlySet<string>,
): string | null {
  if (sourceIds.length === 0) return null;
  const current = currentSourceId?.trim() || null;
  const startIndex = current ? sourceIds.indexOf(current) : -1;
  for (let step = 1; step <= sourceIds.length; step += 1) {
    const candidate = sourceIds[(startIndex + step) % sourceIds.length];
    if (!candidate || candidate === current || triedSourceIds.has(candidate)) continue;
    return candidate;
  }
  return null;
}

/**
 * Prefer next same-provider catalog source; otherwise hop to a compatible provider;
 * give up when the attempt budget is exhausted or nothing remains.
 */
export function planStartupFailover(input: {
  readonly sourceIds: readonly string[];
  readonly currentSourceId: string | null | undefined;
  readonly triedSourceIds: ReadonlySet<string>;
  readonly hasFallbackProvider: boolean;
  readonly failoverAttempts: number;
  readonly maxFailoverAttempts?: number;
  readonly providerHopUsed?: boolean;
}): StartupFailoverPlan {
  const maxAttempts = input.maxFailoverAttempts ?? MAX_STARTUP_FAILOVER_ATTEMPTS;
  if (input.failoverAttempts >= maxAttempts) {
    return { kind: "give-up" };
  }

  const nextSourceId = pickNextCatalogSourceId(
    input.sourceIds,
    input.currentSourceId,
    input.triedSourceIds,
  );
  if (nextSourceId) {
    return { kind: "advance-source", sourceId: nextSourceId };
  }

  if (input.hasFallbackProvider && input.providerHopUsed !== true) {
    return { kind: "fallback-provider" };
  }

  return { kind: "give-up" };
}
