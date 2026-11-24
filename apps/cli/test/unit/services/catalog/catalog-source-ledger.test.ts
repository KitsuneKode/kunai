import { afterEach, describe, expect, test } from "bun:test";

import { buildDiagnosticsPanelLines } from "@/app-shell/panel-data";
import { createInitialState } from "@/domain/session/SessionState";
import {
  catalogAnswersSnapshot,
  describeCatalogAnswers,
  recordCatalogAnswer,
  resetCatalogSourceLedgerForTest,
} from "@/services/catalog/catalog-source-ledger";

afterEach(() => resetCatalogSourceLedgerForTest());

describe("catalog source ledger", () => {
  test("keeps the latest answer per capability and lane", () => {
    let now = 1_000;
    resetCatalogSourceLedgerForTest(() => now);
    recordCatalogAnswer({
      capability: "search",
      lane: "movie-series",
      sourceId: "tmdb",
      sourceName: "TMDB",
      fallback: false,
    });
    now = 2_000;
    recordCatalogAnswer({
      capability: "search",
      lane: "movie-series",
      sourceId: "wikidata",
      sourceName: "Wikidata (TMDB unreachable)",
      fallback: true,
      reason: "TMDB unreachable",
    });
    recordCatalogAnswer({
      capability: "search",
      lane: "anime",
      sourceId: "anilist",
      sourceName: "AniList",
      fallback: false,
    });
    expect(catalogAnswersSnapshot().map((answer) => `${answer.lane}:${answer.sourceId}`)).toEqual([
      "movie-series:wikidata",
      "anime:anilist",
    ]);
  });

  test("describes fallbacks first with their reason and age", () => {
    const line = describeCatalogAnswers(
      [
        {
          capability: "trending",
          lane: "anime",
          sourceId: "anilist",
          sourceName: "AniList",
          fallback: false,
          at: 50_000,
        },
        {
          capability: "series-episodes",
          lane: "movie-series",
          sourceId: "saved",
          sourceName: "saved TMDB copy",
          fallback: true,
          reason: "TMDB unreachable",
          at: 0,
        },
      ],
      5 * 60 * 1000,
    );
    expect(line).toEqual({
      degraded: true,
      detail:
        "episodes: saved TMDB copy (TMDB unreachable) · 5m ago  ·  anime trending: AniList · 4m ago",
    });
    expect(describeCatalogAnswers([], 0)).toBeNull();
  });

  test("the diagnostics panel shows the line, as a warning when degraded", () => {
    const lines = buildDiagnosticsPanelLines({
      state: createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "en" },
        movie: { audio: "original", subtitle: "en" },
      }),
      recentEvents: [],
      now: 1_000,
      catalogAnswers: [
        {
          capability: "search",
          lane: "movie-series",
          sourceId: "wikidata",
          sourceName: "Wikidata (TMDB unreachable)",
          fallback: true,
          reason: "TMDB unreachable",
          at: 1_000,
        },
      ],
    });
    const line = lines.find((entry) => entry.label === "Catalog sources");
    expect(line?.tone).toBe("warning");
    expect(line?.detail).toContain("search: Wikidata (TMDB unreachable)");
  });
});
