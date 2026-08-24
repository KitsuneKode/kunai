import { describe, expect, test } from "bun:test";

import { hasResolvableSeriesCoordinates } from "../src/shared/series-coordinates";
import {
  buildQueryVariants,
  classifyVideasyHttpFailure,
  getPhaseAVidkingFlavorIds,
  isVidkingFlavorDeprecated,
  listDeprecatedVidkingEndpoints,
  listEligibleVidkingFlavorIds,
  listVidkingFlavors,
} from "../src/videasy";

describe("classifyVideasyHttpFailure", () => {
  test("only permanent route removal is route-dead", () => {
    expect(classifyVideasyHttpFailure(404)).toBe("route-dead");
    expect(classifyVideasyHttpFailure(410)).toBe("route-dead");
  });

  /**
   * Intentional: speedracelight returns 500 "No streams available" per title
   * while the endpoint stays healthy for others. Quarantining on 500 would take
   * a working route offline.
   */
  test("HTTP 500 stays transient", () => {
    expect(classifyVideasyHttpFailure(500)).toBe("transient");
    expect(classifyVideasyHttpFailure(502)).toBe("transient");
    expect(classifyVideasyHttpFailure(503)).toBe("transient");
  });

  test("client errors other than removal are transient", () => {
    expect(classifyVideasyHttpFailure(403)).toBe("transient");
    expect(classifyVideasyHttpFailure(429)).toBe("transient");
  });
});

describe("deprecated Videasy routes stay inert", () => {
  test("wings-tejo is a deprecated endpoint and is not an active flavor", () => {
    expect(listDeprecatedVidkingEndpoints()).toContain("wings-tejo");
    expect(isVidkingFlavorDeprecated("wingsdb-titanium")).toBe(true);
    expect(listVidkingFlavors().some((flavor) => flavor.endpoint === "wings-tejo")).toBe(false);
  });

  test("no deprecated flavor is eligible or scheduled in phase A", () => {
    const eligible = listEligibleVidkingFlavorIds();
    const phaseA = getPhaseAVidkingFlavorIds();

    expect(eligible).not.toContain("wingsdb-titanium");
    expect(phaseA).not.toContain("wingsdb-titanium");
    for (const id of [...eligible, ...phaseA]) {
      expect(isVidkingFlavorDeprecated(id)).toBe(false);
    }
  });

  test("the active flavor list never contains a deprecated definition", () => {
    for (const flavor of listVidkingFlavors()) {
      expect(flavor.deprecated).not.toBe(true);
    }
  });
});

/**
 * Season 0 is the catalog identity for specials and OVAs.
 *
 * The series guard was `!episode?.season || !episode.episode` — a truthiness
 * test on a field where zero is meaningful. `!0` is true, so every special
 * produced an empty variant list and the provider was never called: no
 * request, no failure, no trace. The lane simply reported nothing to play,
 * which is indistinguishable from "this special has no source".
 *
 * Season and episode are deliberately asymmetric. Season may be 0; episode may
 * not, because episode numbers are 1-based across Kunai, so a zero episode is
 * a caller bug rather than a special.
 */
describe("videasy series coordinates", () => {
  const TITLE = { title: "Example Show", year: 2020, tmdbId: "1399" } as const;

  function variantsFor(episode: { season?: number; episode?: number } | undefined) {
    return buildQueryVariants({
      title: TITLE as never,
      mediaKind: "series",
      tmdbId: 1399,
      episode: episode as never,
      singleVariant: true,
    });
  }

  test("season 0 with a positive episode produces the request, with seasonId=0", () => {
    const variants = variantsFor({ season: 0, episode: 3 });
    expect(variants).toHaveLength(1);
    expect(variants[0]?.get("seasonId")).toBe("0");
    expect(variants[0]?.get("episodeId")).toBe("3");
    expect(variants[0]?.get("mediaType")).toBe("tv");
    expect(variants[0]?.get("tmdbId")).toBe("1399");
  });

  test("ordinary seasons are unchanged", () => {
    const variants = variantsFor({ season: 2, episode: 7 });
    expect(variants[0]?.get("seasonId")).toBe("2");
    expect(variants[0]?.get("episodeId")).toBe("7");
  });

  test("a missing season still fails before any network call", () => {
    expect(variantsFor({ episode: 3 })).toEqual([]);
    expect(variantsFor(undefined)).toEqual([]);
  });

  test("episode 0 stays rejected — episodes are 1-based here", () => {
    expect(variantsFor({ season: 1, episode: 0 })).toEqual([]);
    expect(variantsFor({ season: 0, episode: 0 })).toEqual([]);
  });

  test("a nonsense season is rejected rather than sent upstream", () => {
    expect(variantsFor({ season: -1, episode: 3 })).toEqual([]);
    expect(variantsFor({ season: 1.5, episode: 3 })).toEqual([]);
    expect(variantsFor({ season: Number.NaN, episode: 3 })).toEqual([]);
  });

  test("the predicate agrees with what the builder does", () => {
    expect(hasResolvableSeriesCoordinates({ season: 0, episode: 1 })).toBe(true);
    expect(hasResolvableSeriesCoordinates({ season: 1, episode: 1 })).toBe(true);
    expect(hasResolvableSeriesCoordinates({ season: 0, episode: 0 })).toBe(false);
    expect(hasResolvableSeriesCoordinates({ episode: 1 })).toBe(false);
    expect(hasResolvableSeriesCoordinates(undefined)).toBe(false);
  });
});
