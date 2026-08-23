import { describe, expect, test } from "bun:test";

import { createPendingBootstrap, spendBootstrapIntent } from "@/app/session/pending-bootstrap";

const TITLE = { id: "tmdb:438631", type: "movie" as const, name: "Dune" };

describe("pending session bootstrap", () => {
  test("carries every launch field it was given", () => {
    const pending = createPendingBootstrap({
      initialTitle: TITLE,
      initialEpisode: { season: 1, episode: 3 },
      initialQuery: "Dune",
      initialRoute: "history",
      preserveExistingSearch: true,
      autoPickSearchResultIndex: 1,
    });

    expect(pending.initialTitle).toEqual(TITLE);
    expect(pending.initialQuery).toBe("Dune");
    expect(pending.initialRoute).toBe("history");
    expect(pending.preserveExistingSearch).toBe(true);
    expect(pending.autoPickSearchResultIndex).toBe(1);
  });

  /**
   * The regression this exists for: launching with *both* a query and a direct
   * target (`-S "Dune" --history`, a share link, `-i` with `-t`) took the
   * direct-title branch, which cleared only `initialTitle` and
   * `initialEpisode`. The query, route, auto-pick index and
   * preserveExistingSearch all survived into the next loop iteration, so when
   * the chosen title finished, a search nobody asked for ran — and with the
   * auto-pick index still set, `--quick`/`--zen` played its first hit.
   */
  test("spending it clears every field, not just the title", () => {
    const pending = createPendingBootstrap({
      initialTitle: TITLE,
      initialEpisode: { season: 1, episode: 3 },
      initialQuery: "Dune",
      initialRoute: "history",
      preserveExistingSearch: true,
      autoPickSearchResultIndex: 1,
    });

    spendBootstrapIntent(pending);

    expect(pending).toEqual({
      initialTitle: null,
      initialEpisode: null,
      initialQuery: undefined,
      initialRoute: undefined,
      preserveExistingSearch: false,
      autoPickSearchResultIndex: undefined,
    });
  });

  test("the auto-pick index specifically does not survive", () => {
    // Called out on its own because this is the field that turns a stray
    // search into unrequested playback, with a history row and a tracker sync.
    const pending = createPendingBootstrap({
      initialTitle: TITLE,
      initialQuery: "Dune",
      autoPickSearchResultIndex: 1,
    });

    spendBootstrapIntent(pending);

    expect(pending.autoPickSearchResultIndex).toBeUndefined();
    expect(pending.initialQuery).toBeUndefined();
  });

  test("spending an already-spent intent is a no-op", () => {
    const pending = createPendingBootstrap({ initialQuery: "Dune" });
    spendBootstrapIntent(pending);
    const spent = { ...pending };
    spendBootstrapIntent(pending);
    expect(pending).toEqual(spent);
  });

  test("defaults are empty when nothing was passed", () => {
    expect(createPendingBootstrap({})).toEqual({
      initialTitle: null,
      initialEpisode: null,
      initialQuery: undefined,
      initialRoute: undefined,
      preserveExistingSearch: false,
      autoPickSearchResultIndex: undefined,
    });
  });
});
