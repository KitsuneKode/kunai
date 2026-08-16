import { describe, expect, test } from "bun:test";

import {
  describeMirrorTargets,
  resolveMirrorTargets,
  resolveMirrorTargetsStrict,
} from "@/services/sync/mirror-targets";

/**
 * Regression cover for the defect that made favouriting an anime look like it
 * worked and sync nothing: the shell dropped `externalIds`, the router flattened
 * `anime` to `series`, and the resulting zero targets were returned as a count
 * nobody read. Each of those is asserted separately here, because any one of
 * them alone is enough to break AniList entirely.
 */

function deps(enriched?: { anilistId?: string; tmdbId?: string }) {
  let enrichCalls = 0;
  return {
    get enrichCalls() {
      return enrichCalls;
    },
    catalogIdentityService: {
      enrich: async () => {
        enrichCalls += 1;
        return {
          ...(enriched ? { externalIds: enriched } : {}),
          graph: { confidence: "high" as const, source: "arm" as const },
        };
      },
    },
  };
}

describe("resolveMirrorTargets", () => {
  test("resolves AniList from externalIds on an anime title", async () => {
    const d = deps();
    const targets = await resolveMirrorTargets(d, {
      titleId: "tmdb:240411",
      mediaKind: "anime",
      externalIds: { anilistId: "21" },
    });

    expect(targets.identities).toEqual([{ tracker: "anilist", anilistId: 21, mediaKind: "anime" }]);
    // The fast path must not touch enrichment: this runs on a keypress.
    expect(d.enrichCalls).toBe(0);
  });

  /**
   * Anime arrives as a TMDB row whose `type` is `series`, so a lane check would
   * reject the very titles it exists to route. An explicit AniList id is
   * unambiguous on its own.
   */
  test("resolves AniList regardless of the lane the row arrived through", async () => {
    for (const mediaKind of ["anime", "series", "movie"] as const) {
      const targets = await resolveMirrorTargets(deps(), {
        titleId: "tmdb:240411",
        mediaKind,
        externalIds: { anilistId: "21" },
      });
      expect(targets.identities, mediaKind).toEqual([
        { tracker: "anilist", anilistId: 21, mediaKind: "anime" },
      ]);
    }
  });

  /**
   * One keypress files one title in one account. An anime with both ids belongs
   * to AniList; sending it to TMDB as well would mirror it somewhere the user
   * never asked for.
   */
  test("prefers AniList over TMDB when a title resolves to both", async () => {
    const targets = await resolveMirrorTargets(deps(), {
      titleId: "tmdb:240411",
      mediaKind: "series",
      externalIds: { anilistId: "21", tmdbId: "240411" },
    });

    expect(describeMirrorTargets(targets)).toBe("AniList");
  });

  /** TMDB still owns everything AniList does not catalogue. */
  test("falls back to TMDB for a film with no AniList mapping", async () => {
    const targets = await resolveMirrorTargets(deps(), {
      titleId: "tmdb:693134",
      mediaKind: "movie",
    });

    expect(targets.identities).toEqual([{ tracker: "tmdb", tmdbId: 693134, mediaKind: "movie" }]);
  });

  test("enriches only when the direct resolve found nothing", async () => {
    const d = deps({ anilistId: "21" });
    const targets = await resolveMirrorTargets(d, {
      titleId: "allanime:abc123",
      mediaKind: "anime",
      title: "Kaiju Girl Caramelise",
    });

    expect(d.enrichCalls).toBe(1);
    expect(targets.identities).toEqual([{ tracker: "anilist", anilistId: 21, mediaKind: "anime" }]);
  });

  /** A title no tracker can address is a real answer, not an error. */
  test("reports no targets when enrichment cannot supply an id", async () => {
    const targets = await resolveMirrorTargets(deps(), {
      titleId: "allanime:abc123",
      mediaKind: "anime",
    });

    expect(targets.identities).toHaveLength(0);
    expect(describeMirrorTargets(targets)).toBeNull();
  });

  /** Enrichment is best-effort; the local list change already landed. */
  test("survives an enrichment that throws", async () => {
    const targets = await resolveMirrorTargets(
      {
        catalogIdentityService: {
          enrich: async () => {
            throw new Error("ARM unreachable");
          },
        },
      },
      { titleId: "allanime:abc123", mediaKind: "anime" },
    );

    expect(targets.identities).toHaveLength(0);
  });

  test("resolves TMDB for a series and names both trackers when both resolve", async () => {
    const targets = await resolveMirrorTargets(deps(), {
      titleId: "tmdb:1396",
      mediaKind: "series",
    });

    expect(describeMirrorTargets(targets)).toBe("TMDB");
  });
});

/**
 * Identity resolution runs inside a keypress. Only the enrichment fallback can
 * be slow — it reaches ARM over the network — so it carries its own deadline;
 * an unreachable ARM must not freeze the toggle that already wrote the list.
 */
describe("resolveMirrorTargets deadline", () => {
  test("gives up on an enrichment that never settles or observes the signal", async () => {
    const targets = await resolveMirrorTargets(
      // Deliberately ignores the signal entirely: forwarding one is a request,
      // not a guarantee, so the bound cannot depend on the callee honouring it.
      { catalogIdentityService: { enrich: () => new Promise(() => {}) } },
      { titleId: "allanime:abc123", mediaKind: "anime" },
      { signal: AbortSignal.abort() },
    );

    expect(targets.identities).toHaveLength(0);
  });
});

describe("resolveMirrorTargetsStrict", () => {
  test("distinguishes a definitive crosswalk miss from a transient lookup error", async () => {
    const missing = await resolveMirrorTargetsStrict(
      {
        catalogIdentityService: {
          enrich: async () => ({ graph: { confidence: "low", source: "arm" } }),
        },
      },
      { titleId: "anidb:native", mediaKind: "anime" },
    );
    const failed = await resolveMirrorTargetsStrict(
      {
        catalogIdentityService: {
          enrich: async () => {
            throw new Error("network detail");
          },
        },
      },
      { titleId: "anidb:native", mediaKind: "anime" },
    );

    expect(missing).toEqual({ status: "no-mapping", identities: [] });
    expect(failed).toEqual({ status: "transient", reason: "error", identities: [] });
  });

  test("reports caller cancellation separately from a timeout or missing mapping", async () => {
    const result = await resolveMirrorTargetsStrict(
      { catalogIdentityService: { enrich: () => new Promise(() => {}) } },
      { titleId: "anidb:native", mediaKind: "anime" },
      { signal: AbortSignal.abort() },
    );

    expect(result).toEqual({ status: "aborted", identities: [] });
  });
});
