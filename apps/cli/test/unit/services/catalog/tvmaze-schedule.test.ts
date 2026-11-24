import { describe, expect, test } from "bun:test";

import { buildLocalDayWindow } from "@/services/catalog/CatalogScheduleService";
import {
  loadTvmazeAiringToday,
  readTvmazeSchedule,
  TvmazeScheduleUnavailableError,
} from "@/services/catalog/tvmaze-schedule";
import {
  buildShowIdMappingQuery,
  readShowIdMapping,
  tmdbTvIdForShow,
  type WikidataFetch,
} from "@/services/catalog/wikidata-search";
import type { JsonValue } from "@kunai/types";

const WINDOW = buildLocalDayWindow(Date.parse("2026-11-24T12:00:00.000Z"));

const BROADCAST: JsonValue = [
  {
    airstamp: "2026-11-25T04:35:00+00:00",
    season: 24,
    number: 41,
    show: {
      name: "Jimmy Kimmel Live",
      weight: 98,
      externals: { imdb: "tt0320037", thetvdb: 71998 },
      image: { medium: "https://static.tvmaze.com/kimmel.jpg" },
    },
  },
  // A second airing of the same show today: the earliest one is kept.
  {
    airstamp: "2026-11-24T08:00:00+00:00",
    show: { name: "Jimmy Kimmel Live", weight: 98, externals: { imdb: "tt0320037" } },
  },
  // No external id: cannot be identified, dropped.
  { airstamp: "2026-11-24T10:00:00+00:00", show: { name: "Local News", externals: {} } },
];
const WEB: JsonValue = [
  {
    airstamp: "2026-11-24T17:00:00+00:00",
    _embedded: { show: { name: "Phony", weight: 60, externals: { thetvdb: 451234 } } },
  },
];

function serve(routes: Record<string, () => Response>): WikidataFetch {
  return async (url) => {
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) throw new Error(`unexpected ${url}`);
    return route();
  };
}

describe("TVmaze schedule as the series-calendar stand-in", () => {
  test("reads broadcast and embedded web entries, one per show, earliest airing", () => {
    const shows = readTvmazeSchedule(BROADCAST);
    expect(shows.map((show) => `${show.name}@${show.airstamp}`)).toEqual([
      "Jimmy Kimmel Live@2026-11-24T08:00:00+00:00",
    ]);
    expect(readTvmazeSchedule(WEB)[0]).toMatchObject({ name: "Phony", tvdb: "451234" });
  });

  test("maps through Wikidata ids, carries no episode numbers, and names the stand-in", async () => {
    const items = await loadTvmazeAiringToday(WINDOW, {
      fetchImpl: serve({
        "/schedule": () => Response.json(BROADCAST),
        "/schedule/web": () => Response.json(WEB),
      }),
      mapShows: async () =>
        new Map([
          ["imdb:tt0320037", "1489"],
          ["tvdb:71998", "1489"],
          ["tvdb:451234", "275139"],
        ]),
    });
    expect(items.map((item) => `${item.titleName}:${item.titleId}`)).toEqual([
      "Jimmy Kimmel Live:1489",
      "Phony:275139",
    ]);
    for (const item of items) {
      expect(item).toMatchObject({ source: "tmdb", type: "series", via: "TVmaze" });
      expect(item.season).toBeUndefined();
      expect(item.episode).toBeUndefined();
    }
  });

  test("a show whose IMDb and TheTVDB ids disagree is dropped", () => {
    const mapping = new Map([
      ["imdb:tt1", "10"],
      ["tvdb:2", "20"],
    ]);
    expect(tmdbTvIdForShow(mapping, { imdb: "tt1", tvdb: "2" })).toBeNull();
    expect(tmdbTvIdForShow(mapping, { imdb: "tt1" })).toBe("10");
    expect(tmdbTvIdForShow(mapping, { tvdb: "2" })).toBe("20");
  });

  test("one schedule down is tolerated; both down rejects as unavailable", async () => {
    const half = await loadTvmazeAiringToday(WINDOW, {
      fetchImpl: serve({
        "/schedule": () => new Response("busy", { status: 503 }),
        "/schedule/web": () => Response.json(WEB),
      }),
      mapShows: async () => new Map([["tvdb:451234", "275139"]]),
    });
    expect(half.map((item) => item.titleId)).toEqual(["275139"]);

    await expect(
      loadTvmazeAiringToday(WINDOW, {
        fetchImpl: serve({
          "/schedule": () => new Response("busy", { status: 503 }),
          "/schedule/web": () => new Response("busy", { status: 503 }),
        }),
      }),
    ).rejects.toBeInstanceOf(TvmazeScheduleUnavailableError);
  });
});

describe("Wikidata show id mapping", () => {
  test("ambiguous ids are left out", () => {
    const row = (key: "imdb" | "tvdb", id: string, tv: string): JsonValue => ({
      [key]: { type: "literal", value: id },
      tv: { type: "literal", value: tv },
    });
    const mapping = readShowIdMapping({
      results: {
        bindings: [
          row("imdb", "tt0320037", "1489"),
          row("imdb", "tt9", "42315"),
          row("imdb", "tt9", "216247"),
          row("tvdb", "451234", "275139"),
        ],
      },
    });
    expect([...mapping]).toEqual([
      ["imdb:tt0320037", "1489"],
      ["tvdb:451234", "275139"],
    ]);
  });

  test("the query unions only the id kinds it has", () => {
    expect(buildShowIdMappingQuery(["tt1"], [])).not.toContain("P4835");
    const both = buildShowIdMappingQuery(["tt1"], ["2"]);
    expect(both).toContain("wdt:P345");
    expect(both).toContain("wdt:P4835");
    expect(both).toContain("UNION");
  });
});
