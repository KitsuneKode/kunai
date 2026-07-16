// =============================================================================
// CatalogIdentityService — one enrichment path for the cross-catalog id bag.
//
// Given a title with partial external ids, fill the rest of the
// AniList/MAL/TMDB/IMDB bag: pass-through when both lane ids exist, then the
// SQLite crosswalk cache, then ARM. High confidence comes only from exact id
// maps; low-confidence results never rewrite history (callers must check
// graph.confidence before rekeying). See .plans/catalog-identity-parity.md.
// =============================================================================

import { mergeBackfillExternalIds } from "@kunai/core";
import type { CatalogIdGraph, MediaKind, ProviderExternalIds } from "@kunai/types";

import type { ArmIdGraph, ArmSource } from "./arm-client";

export interface ArmClientPort {
  fetchIds(
    source: ArmSource,
    id: string,
    signal?: AbortSignal,
  ): Promise<ArmIdGraph | null | undefined>;
}

export interface CrosswalkCachePort {
  get(sourceNs: CrosswalkSourceNs, sourceId: string): CatalogIdGraph | undefined;
  put(sourceNs: CrosswalkSourceNs, sourceId: string, graph: CatalogIdGraph): void;
}

export type CrosswalkSourceNs = "anilist" | "mal" | "tmdb" | "imdb";

export type CatalogIdentityEnrichInput = {
  readonly id: string;
  readonly kind: MediaKind;
  readonly title: string;
  readonly year?: number;
  readonly externalIds?: ProviderExternalIds;
};

export type CatalogIdentityEnrichResult = {
  readonly externalIds?: ProviderExternalIds;
  readonly graph: CatalogIdGraph;
};

export type CatalogIdentityServiceDeps = {
  readonly arm: ArmClientPort;
  readonly cache?: CrosswalkCachePort;
};

const SOURCE_NS_TO_ARM: Readonly<Record<CrosswalkSourceNs, ArmSource>> = {
  anilist: "anilist",
  mal: "myanimelist",
  tmdb: "themoviedb",
  imdb: "imdb",
};

export class CatalogIdentityService {
  constructor(private readonly deps: CatalogIdentityServiceDeps) {}

  async enrich(
    input: CatalogIdentityEnrichInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CatalogIdentityEnrichResult> {
    const seeded = seedExternalIds(input);

    // Both lane keys known → nothing ARM could add that changes routing.
    if (seeded?.anilistId && seeded.tmdbId) {
      return {
        externalIds: seeded,
        graph: graphFromExternalIds(seeded, "high", "passthrough"),
      };
    }

    const lookup = pickLookupSource(seeded);
    if (!lookup) {
      return {
        externalIds: seeded,
        graph: graphFromExternalIds(seeded, "low", "passthrough"),
      };
    }

    const cached = this.deps.cache?.get(lookup.ns, lookup.id);
    if (cached) {
      return {
        externalIds: mergeGraphIntoExternalIds(seeded, cached),
        graph: cached,
      };
    }

    const fetched = await this.deps.arm.fetchIds(
      SOURCE_NS_TO_ARM[lookup.ns],
      lookup.id,
      options.signal,
    );

    if (fetched === undefined) {
      // Network failure — degrade gracefully, never cache.
      return {
        externalIds: seeded,
        graph: graphFromExternalIds(
          seeded,
          seeded?.anilistId || seeded?.tmdbId ? "medium" : "low",
          "passthrough",
        ),
      };
    }

    const graph: CatalogIdGraph =
      fetched === null
        ? { confidence: "low", source: "arm" }
        : {
            ...(fetched.anilistId ? { anilistId: fetched.anilistId } : {}),
            ...(fetched.malId ? { malId: fetched.malId } : {}),
            ...(fetched.tmdbId ? { tmdbId: fetched.tmdbId } : {}),
            ...(fetched.imdbId ? { imdbId: fetched.imdbId } : {}),
            ...(fetched.tmdbSeason !== undefined ? { tmdbSeason: fetched.tmdbSeason } : {}),
            confidence: "high",
            source: "arm",
          };

    this.deps.cache?.put(lookup.ns, lookup.id, graph);

    return {
      externalIds: mergeGraphIntoExternalIds(seeded, graph),
      graph,
    };
  }
}

/** Fold obvious id-shape knowledge into the bag before any lookup. */
function seedExternalIds(input: CatalogIdentityEnrichInput): ProviderExternalIds | undefined {
  const { id, kind, externalIds } = input;

  if (kind === "anime" && !externalIds?.anilistId && /^\d+$/.test(id)) {
    // Bare numeric anime ids are AniList ids everywhere in the runtime.
    return { ...externalIds, anilistId: id };
  }

  const tmdbFromId = id.startsWith("tmdb:") ? id.slice("tmdb:".length) : undefined;
  if (
    (kind === "movie" || kind === "series") &&
    !externalIds?.tmdbId &&
    tmdbFromId &&
    /^\d+$/.test(tmdbFromId)
  ) {
    return { ...externalIds, tmdbId: tmdbFromId };
  }

  return externalIds;
}

function pickLookupSource(
  externalIds: ProviderExternalIds | undefined,
): { readonly ns: CrosswalkSourceNs; readonly id: string } | undefined {
  if (externalIds?.anilistId) return { ns: "anilist", id: externalIds.anilistId };
  if (externalIds?.malId) return { ns: "mal", id: externalIds.malId };
  if (externalIds?.tmdbId) return { ns: "tmdb", id: externalIds.tmdbId };
  if (externalIds?.imdbId) return { ns: "imdb", id: externalIds.imdbId };
  return undefined;
}

function graphFromExternalIds(
  externalIds: ProviderExternalIds | undefined,
  confidence: CatalogIdGraph["confidence"],
  source: CatalogIdGraph["source"],
): CatalogIdGraph {
  return {
    ...(externalIds?.anilistId ? { anilistId: externalIds.anilistId } : {}),
    ...(externalIds?.malId ? { malId: externalIds.malId } : {}),
    ...(externalIds?.tmdbId ? { tmdbId: externalIds.tmdbId } : {}),
    ...(externalIds?.imdbId ? { imdbId: externalIds.imdbId } : {}),
    confidence,
    source,
  };
}

function mergeGraphIntoExternalIds(
  existing: ProviderExternalIds | undefined,
  graph: CatalogIdGraph,
): ProviderExternalIds | undefined {
  return mergeBackfillExternalIds(existing, {
    ...(graph.anilistId ? { anilistId: graph.anilistId } : {}),
    ...(graph.malId ? { malId: graph.malId } : {}),
    ...(graph.tmdbId ? { tmdbId: graph.tmdbId } : {}),
    ...(graph.imdbId ? { imdbId: graph.imdbId } : {}),
  });
}
