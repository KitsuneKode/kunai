import type { CatalogIdentityService } from "../catalog/CatalogIdentityService";
import { resolveAniListIdentity, resolveTmdbIdentity } from "./sync-identity";
import type { SyncIdentity, TrackerIdSource } from "./types";

/**
 * Which trackers can address a title, and what it took to find out.
 *
 * A local list write always succeeds; mirroring it only can when some tracker
 * has an id for the title. Reporting that difference is the point of this
 * module — the previous code enqueued into the void and told the user
 * "Updated favourites", so a title that could never sync looked identical to
 * one that already had.
 */
export type MirrorTargets = {
  readonly identities: readonly SyncIdentity[];
  /** True when enrichment supplied an id the caller's item did not carry. */
  readonly enriched: boolean;
};

export interface MirrorIdentityDeps {
  readonly catalogIdentityService: Pick<CatalogIdentityService, "enrich">;
}

/**
 * Pick the tracker that owns this title, not every tracker that could hold it.
 *
 * Anime reaches the shell as a TMDB row with an AniList mapping, so both
 * resolvers can succeed for the same show. Writing to both would file one title
 * in two accounts from a single keypress, and the TMDB copy is the one the user
 * did not ask for — AniList is where anime progress, favourites and lists
 * actually live. So AniList wins when it resolves, and TMDB covers everything
 * AniList does not catalogue: films and non-anime series.
 */
function identitiesFor(source: TrackerIdSource): SyncIdentity[] {
  const anilist = resolveAniListIdentity(source);
  if (anilist) return [anilist];
  const tmdb = resolveTmdbIdentity(source);
  return tmdb ? [tmdb] : [];
}

/**
 * Resolve tracker identities for a title, enriching only when the fast path
 * finds nothing.
 *
 * The ordering matters for keypress latency: a row that already carries the
 * right id resolves without touching the crosswalk cache or the network, and
 * only a title that would otherwise mirror nowhere pays for enrichment. ARM
 * lookups degrade to "no ids" rather than throwing, so a cold cache and a dead
 * network both end as an honest empty result instead of a silent success.
 */
export async function resolveMirrorTargets(
  deps: MirrorIdentityDeps,
  item: {
    readonly titleId: string;
    readonly mediaKind: TrackerIdSource["mediaKind"];
    readonly title?: string;
    readonly externalIds?: TrackerIdSource["externalIds"];
  },
  options: { readonly signal?: AbortSignal } = {},
): Promise<MirrorTargets> {
  const source: TrackerIdSource = {
    titleId: item.titleId,
    mediaKind: item.mediaKind,
    ...(item.externalIds ? { externalIds: item.externalIds } : {}),
  };

  const direct = identitiesFor(source);
  if (direct.length > 0) return { identities: direct, enriched: false };

  let enrichedIds: TrackerIdSource["externalIds"];
  try {
    const result = await deps.catalogIdentityService.enrich(
      {
        id: item.titleId,
        kind: item.mediaKind,
        title: item.title ?? "",
        ...(item.externalIds ? { externalIds: item.externalIds } : {}),
      },
      options,
    );
    enrichedIds = result.externalIds;
  } catch {
    // Enrichment is an optimisation over "we could not address this title".
    // Failing it must not fail the list change that already landed.
    return { identities: [], enriched: false };
  }

  if (!enrichedIds) return { identities: [], enriched: false };
  return {
    identities: identitiesFor({ ...source, externalIds: enrichedIds }),
    enriched: true,
  };
}

/** Tracker display order for user-facing copy, so messages read consistently. */
export function describeMirrorTargets(targets: MirrorTargets): string | null {
  const names = targets.identities.map((identity) =>
    identity.tracker === "anilist" ? "AniList" : "TMDB",
  );
  if (names.length === 0) return null;
  return names.join(" and ");
}
