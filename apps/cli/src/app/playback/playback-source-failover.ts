import type { ProviderResolveResult } from "@kunai/types";

import type { RecentPlaybackStreamProvenance } from "./recent-playback-stream";

/** ~3 catalog sources + 1 provider hop before surfacing post-play recovery. */
export const MAX_STARTUP_FAILOVER_ATTEMPTS = 4;

/** Abort + mark dead only after this long with no first progress (slow CDNs need headroom). */
export const STARTUP_STALL_TIMEOUT_MS = 45_000;

/**
 * A stream that has sent nothing at all by now is not slow, it is dead: give
 * up on it this early instead of waiting out the full startup budget. Any byte
 * seen (input rate, cache speed, buffered seconds) hands the stream back to
 * STARTUP_STALL_TIMEOUT_MS.
 */
export const STARTUP_NO_BYTES_TIMEOUT_MS = 15_000;

/** True when a player network sample shows bytes arriving from the server. */
export function networkSampleShowsBytes(sample: {
  readonly rawInputRate?: number;
  readonly cacheSpeed?: number;
  readonly cacheAheadSeconds?: number;
}): boolean {
  return (
    (sample.rawInputRate ?? 0) > 0 ||
    (sample.cacheSpeed ?? 0) > 0 ||
    (sample.cacheAheadSeconds ?? 0) > 0
  );
}

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

/** Rungs above this step down on their own source before that source is abandoned. */
export const QUALITY_STEP_DOWN_CEILING = 1080;

/**
 * A cap set by recovery for the rest of the episode: nothing above `maxRank`,
 * on any source. A 4K rung that failed for bandwidth or a missing HEVC decoder
 * fails the same way on the next source. `sourceId` is where it was set.
 */
export type RecoveryQualityCeiling = { readonly sourceId: string; readonly maxRank: number };

/**
 * A failing 4K (above-1080p) stream steps down to 1080p on the same source
 * before failover moves to another one: 4K rungs fail for reasons the 1080p
 * rung beside them does not share (bandwidth, a missing HEVC decoder, a CDN
 * edge that only caches the top rung).
 *
 * Expressed as a quality ceiling, not a stream id: ids hash the URL, and the
 * re-resolve after a failure can rotate CDN tokens, so a pinned id would miss
 * and fall back to the 4K rung again. Once per source: if 1080p fails too,
 * the source is abandoned as before.
 */
export function planQualityStepDown(
  result: Pick<ProviderResolveResult, "streams" | "selectedStreamId"> | null | undefined,
  current: RecoveryQualityCeiling | null,
): RecoveryQualityCeiling | null {
  const selected = result?.streams.find((stream) => stream.id === result.selectedStreamId);
  const sourceId = selected?.sourceId;
  const rank = selected?.qualityRank;
  if (!result || !selected?.url || !sourceId || rank === undefined) return null;
  if (rank <= QUALITY_STEP_DOWN_CEILING || current?.sourceId === sourceId) return null;
  const hasLowerRung = result.streams.some(
    (stream) =>
      stream.sourceId === sourceId &&
      Boolean(stream.url) &&
      stream.url !== selected.url &&
      (stream.qualityRank ?? 0) > 0 &&
      (stream.qualityRank ?? 0) <= QUALITY_STEP_DOWN_CEILING,
  );
  return hasLowerRung ? { sourceId, maxRank: QUALITY_STEP_DOWN_CEILING } : null;
}

/**
 * The quality preference a stream is chosen with while a recovery ceiling
 * holds: the ceiling, unless the user's own preference is already at or below
 * it. Automatic preferences ("auto", "best", "max", none) and "4k" are capped.
 */
export function capQualityPreference(
  preference: string | undefined,
  ceiling: RecoveryQualityCeiling | null,
): string | undefined {
  if (!ceiling) return preference;
  // A resolution ("720", "720p"), not any leading digits: "4k" is not 4.
  const height = /^(\d{3,4})p?$/.exec(preference?.trim().toLowerCase() ?? "")?.[1];
  if (height && Number(height) <= ceiling.maxRank) return preference;
  return String(ceiling.maxRank);
}
