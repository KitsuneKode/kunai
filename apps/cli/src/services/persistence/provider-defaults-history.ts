import { migrateLegacyProviderId } from "@kunai/providers";
import { isJsonString } from "@kunai/types";

import type { KitsuneConfig } from "./ConfigService";
import { DEFAULT_CONFIG } from "./ConfigStore";

/**
 * Provider-default history: which priority lists each released revision wrote
 * to disk, and the exact-match rules that move a user who never touched a lane
 * onto the current defaults. Pure data plus matchers, read by ConfigServiceImpl
 * on load. Bump `providerDefaultsRevision` in @kunai/config and add the list it
 * replaces here, under the revision that shipped it.
 */

export const CURRENT_PROVIDER_DEFAULTS_REVISION = DEFAULT_CONFIG.providerDefaultsRevision ?? 0;

export function readProviderDefaultsRevision(loaded: Partial<KitsuneConfig>): number {
  const value = loaded.providerDefaultsRevision;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Every anime-lane default a build may have written to disk, keyed by the
 * revision it was written under.
 *
 * `ConfigStore.save` writes the whole merged config, so a default sits on disk
 * for every user who ever saved any setting — and the file cannot tell it apart
 * from a deliberate choice. The exact pair *under the revision it shipped in* is
 * the closest honest signal: anyone who touched the anime lane has something else
 * there, and is left alone. Tying each pair to its revision is what keeps a
 * choice made after a migration: a user stamped with revision 1 who picks AniDB
 * again holds the revision-0 pair, which is only inherited at revision 0.
 * anidb.app answering 503 at the origin makes an inherited anidb pair an
 * outage, not a preference, so moving even a deliberate re-pick to the working
 * default is the honest outcome.
 */
const INHERITED_ANIME_DEFAULTS: readonly {
  readonly revision: number;
  readonly animeProvider: string;
  readonly priorities: readonly (readonly string[] | undefined)[];
}[] = [
  // AniDB alone, before revisions existed. A config older than the priority
  // list has none, and inherited the default by definition.
  {
    revision: 0,
    animeProvider: "anidb",
    priorities: [undefined, ["anidb"], ["anidb", "allanime"]],
  },
  // Revision 1 moved the lane to Miruro, and the list then grew twice in
  // stacked changes. Either list is on disk if a build shipped between them.
  {
    revision: 1,
    animeProvider: "miruro",
    priorities: [
      ["miruro", "anidb", "allanime"],
      ["miruro", "animegg", "anidb", "allanime"],
    ],
  },
  // Revision 2 kept Miruro and filled in the independent backends. On disk it
  // is the pair below; revision 3 moves the lane to HiAnime.
  {
    revision: 2,
    animeProvider: "miruro",
    priorities: [["miruro", "kickassanime", "animegg", "anidb", "allanime"]],
  },
  // Revision 3 moved the lane to HiAnime but kept the tail that puts a dead
  // anidb.app ahead of AllAnime — anidb.app redirects to an unrelated landing
  // page as of 2026-10-12. Revision 4 swaps the tail, not the lead.
  {
    revision: 3,
    animeProvider: "hianime",
    priorities: [["miruro", "kickassanime", "animegg", "anidb", "allanime"]],
  },
  // Revision 4 led the rest with Miruro, whose `/api/secure/pipe` route is
  // gone from their shipped bundle as of 2026-10-13. Revision 5 moves the
  // dead pair (Miruro, AniDB) behind AllAnime; the lane default is untouched.
  {
    revision: 4,
    animeProvider: "hianime",
    priorities: [["miruro", "kickassanime", "animegg", "allanime", "anidb"]],
  },
  // Revision 5 kept HiAnime as the lane default but still shipped AniDB at the
  // anime tail while the domain was already repurposed. Revision 6 retires the
  // adapter from production and drops it from shipped defaults.
  {
    revision: 5,
    animeProvider: "hianime",
    priorities: [["kickassanime", "animegg", "allanime", "miruro", "anidb"]],
  },
  {
    revision: 6,
    animeProvider: "hianime",
    priorities: [["kickassanime", "animegg", "allanime", "miruro"]],
  },
  // Revision 7 led the rest with AnimeGG. Revision 8 leads with KickAssAnime,
  // which resolved and streamed on every 2026-11-26 live run, while AnimeGG
  // failed one of two.
  {
    revision: 7,
    animeProvider: "hianime",
    priorities: [["animegg", "kickassanime", "miruro", "allanime"]],
  },
  // Revision 8 led the rest with KickAssAnime. Revision 9 only appends the new
  // tail fallbacks, so this exact list is still treated as inherited.
  {
    revision: 8,
    animeProvider: "hianime",
    priorities: [["kickassanime", "animegg", "miruro", "allanime"]],
  },
  // Revision 9 kept the same order plus the AniLight and Anidap tails.
  // Revision 10 touches only the series lane, so this pair still migrates.
  {
    revision: 9,
    animeProvider: "hianime",
    priorities: [["kickassanime", "animegg", "miruro", "allanime", "anilight", "anidap"]],
  },
  // Revision 10 changed only the series lane, so the revision-9 anime list was
  // still on disk. Revision 11 appends AnimeParadise.
  {
    revision: 10,
    animeProvider: "hianime",
    priorities: [["kickassanime", "animegg", "miruro", "allanime", "anilight", "anidap"]],
  },
];

export function shouldMigrateInheritedAnimeDefaults(loaded: Partial<KitsuneConfig>): boolean {
  const revision = readProviderDefaultsRevision(loaded);
  if (revision >= CURRENT_PROVIDER_DEFAULTS_REVISION) return false;
  const priority = loaded.animeProviderPriority;
  return INHERITED_ANIME_DEFAULTS.some(
    (inherited) =>
      inherited.revision === revision &&
      loaded.animeProvider === inherited.animeProvider &&
      inherited.priorities.some((list) => sameProviderList(list, priority)),
  );
}

function sameProviderList(
  expected: readonly string[] | undefined,
  actual: readonly string[] | undefined,
): boolean {
  if (expected === undefined || actual === undefined) return expected === actual;
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((id, index) => actual[index] === id)
  );
}

/**
 * The only movie/series priority list a released binary has written next to a
 * Videasy default.
 *
 * `api.videasy.to` no longer resolves at DNS — an inherited Videasy pair sits
 * on a degraded lane lead, not a preference. As with the anime twin, the
 * exact-pair match is the closest honest signal that the user never touched
 * the lane: a picker write
 * either reorders the priority or sets `provider` alone with the shipped list
 * intact. The vidking-era `provider` value normalizes to `videasy` here, so a
 * config old enough to carry the legacy id still counts as inherited.
 */
const SHIPPED_VIDEASY_DEFAULT_PRIORITIES: ReadonlyArray<readonly string[]> = [
  ["rivestream", "vidlink"],
];

/**
 * Non-Videasy series pairs a released binary shipped under a known revision.
 * The exact-pair match is the closest honest signal that the user never
 * touched the lane, same as the anime table: a picker write either reorders
 * the priority or sets `provider` alone with the shipped list intact.
 */
const INHERITED_SERIES_DEFAULTS: readonly {
  readonly revision: number;
  readonly provider: string;
  readonly priorities: readonly (readonly string[] | undefined)[];
}[] = [
  // Revision 3 led with VidLink and left Movy unlisted, so it floated to the
  // end of the order — behind a Videasy whose upstream was already gone.
  // Revision 4 names Movy ahead of Videasy.
  {
    revision: 3,
    provider: "vidlink",
    priorities: [["rivestream", "vidrock", "videasy"]],
  },
  // Revisions 4-7 shipped this list unchanged. Revision 8 moves Movy to the
  // head of the fallback order: on the 2026-11-26 live runs Rivestream timed
  // out and VidRock's streams answered 502 on every attempt, so a VidLink miss
  // waited out both before reaching the one working fallback.
  ...[4, 5, 6, 7].map((revision) => ({
    revision,
    provider: "vidlink",
    priorities: [["rivestream", "vidrock", "movy", "videasy"]],
  })),
  // Revision 8 led the rest with Movy. Revision 9 appends VidBolt at the tail.
  {
    revision: 8,
    provider: "vidlink",
    priorities: [["movy", "rivestream", "vidrock", "videasy"]],
  },
  // Revision 9 kept the same order plus the VidBolt tail. Revision 10 appends
  // FileSuN behind it.
  {
    revision: 9,
    provider: "vidlink",
    priorities: [["movy", "rivestream", "vidrock", "videasy", "vidbolt"]],
  },
  // Revision 10 shipped the FileSuN tail. Revision 11 changes only the anime
  // lane, so this pair still migrates.
  {
    revision: 10,
    provider: "vidlink",
    priorities: [["movy", "rivestream", "vidrock", "videasy", "vidbolt", "filesun"]],
  },
];

/**
 * Configs stamped before `CURRENT_PROVIDER_DEFAULTS_REVISION` whose series pair
 * is exactly a pair a release once shipped are moved to `DEFAULT_CONFIG`'s
 * series defaults. Anything else — a reordered custom list or a non-Videasy
 * pick — is left alone. A user who re-picks Videasy after the migration writes
 * `provider` alone (or with a missing/unreadable priority), which this check
 * no longer matches.
 */
export function shouldMigrateInheritedSeriesDefaults(loaded: Partial<KitsuneConfig>): boolean {
  const revision = readProviderDefaultsRevision(loaded);
  if (revision >= CURRENT_PROVIDER_DEFAULTS_REVISION) return false;
  const provider = isJsonString(loaded.provider) ? loaded.provider.trim() : "";
  const priority = loaded.providerPriority;
  if (migrateLegacyProviderId(provider) === "videasy") {
    // Revision 7 only changes anime defaults. A revision-6 Videasy pair
    // already had this migration applied and can be a deliberate re-pick.
    if (revision >= 6) return false;
    // A missing or unreadable priority cannot carry a deliberate ordering —
    // it normalizes to the shipped list below, so it must not shield the dead
    // provider pick from migration either.
    if (!Array.isArray(priority)) return true;
    return SHIPPED_VIDEASY_DEFAULT_PRIORITIES.some(
      (shipped) =>
        shipped.length === priority.length && shipped.every((id, index) => id === priority[index]),
    );
  }
  return INHERITED_SERIES_DEFAULTS.some(
    (inherited) =>
      inherited.revision === revision &&
      provider === inherited.provider &&
      inherited.priorities.some((list) => sameProviderList(list, priority)),
  );
}
