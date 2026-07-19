import type { ProviderResolveResult } from "@kunai/types";

/** ~3 catalog sources + 1 provider hop before surfacing post-play recovery. */
export const MAX_STARTUP_FAILOVER_ATTEMPTS = 4;

export const STARTUP_STALL_TIMEOUT_MS = 20_000;

export type StartupFailoverPlan =
  | { readonly kind: "advance-source"; readonly sourceId: string }
  | { readonly kind: "fallback-provider" }
  | { readonly kind: "give-up" };

/** Ordered source ids from a resolve result (catalog / inventory order). */
export function listOrderedPlaybackSourceIds(
  result: ProviderResolveResult | null | undefined,
): readonly string[] {
  if (!result) return [];
  if (result.sources && result.sources.length > 0) {
    return result.sources.map((source) => source.id);
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

/** Next catalog source after the current one that has not already been tried. */
export function pickNextCatalogSourceId(
  sourceIds: readonly string[],
  currentSourceId: string | null | undefined,
  triedSourceIds: ReadonlySet<string>,
): string | null {
  if (sourceIds.length === 0) return null;
  const current = currentSourceId?.trim() || null;
  const startIndex = current ? sourceIds.indexOf(current) : -1;
  for (let index = Math.max(0, startIndex + 1); index < sourceIds.length; index += 1) {
    const candidate = sourceIds[index];
    if (!candidate || triedSourceIds.has(candidate)) continue;
    if (candidate === current) continue;
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
