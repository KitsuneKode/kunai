import { expect, test } from "bun:test";

import { buildCalendarItem } from "@/domain/calendar/calendar-item";
import type { CatalogScheduleItem } from "@/services/catalog/CatalogScheduleService";

const NOW = new Date("2026-06-05T12:00:00.000Z").getTime();

function scheduleItem(overrides: Partial<CatalogScheduleItem>): CatalogScheduleItem {
  return {
    source: "anilist",
    titleId: "21",
    titleName: "Frieren",
    type: "anime",
    releaseAt: "2026-06-05T18:30:00.000Z",
    releasePrecision: "timestamp",
    status: "upcoming",
    ...overrides,
  };
}

test("anime airing today maps to airing-today reason with time + episode code", () => {
  const item = buildCalendarItem(scheduleItem({ episode: 29 }), { nowMs: NOW });
  expect(item.contentKind).toBe("anime");
  expect(item.releaseStatus).toBe("upcoming");
  expect(item.reason).toBe("airing-today");
  expect(item.providerConfirmed).toBe(false);
  expect(item.display.episodeCode).toBe("E29");
  expect(item.display.statusLabel).toContain("airs today");
  expect(item.display.time).not.toBeNull();
});

test("anime released in the past maps to catalog-only", () => {
  const item = buildCalendarItem(
    scheduleItem({ releaseAt: "2026-06-01T10:00:00.000Z", status: "released", episode: 28 }),
    { nowMs: NOW },
  );
  expect(item.releaseStatus).toBe("released");
  expect(item.reason).toBe("catalog-only");
});

test("series next episode keeps S/E code and date precision", () => {
  const item = buildCalendarItem(
    scheduleItem({
      source: "tmdb",
      titleId: "tv-1",
      titleName: "Slow Horses",
      type: "series",
      season: 5,
      episode: 3,
      episodeTitle: "Signals",
      releaseAt: "2026-06-07",
      releasePrecision: "date",
      status: "upcoming",
    }),
    { nowMs: NOW },
  );
  expect(item.contentKind).toBe("series");
  expect(item.display.episodeCode).toBe("S05E03");
  expect(item.releasePrecision).toBe("date");
  expect(item.reason).toBe("upcoming-episode");
});

test("movie release item has no episode and movie-release reason", () => {
  const item = buildCalendarItem(
    scheduleItem({
      source: "tmdb",
      titleId: "m-9",
      titleName: "Dune: Part Three",
      type: "movie",
      releaseAt: "2026-06-09",
      releasePrecision: "date",
      status: "upcoming",
      episode: undefined,
    }),
    { nowMs: NOW },
  );
  expect(item.contentKind).toBe("movie");
  expect(item.display.episodeCode).toBe("");
  expect(item.reason).toBe("movie-release");
  expect(item.display.statusLabel.toLowerCase()).toContain("releases");
});

test("today date-only stays upcoming and is not confirmed", () => {
  const item = buildCalendarItem(
    scheduleItem({
      source: "tmdb",
      type: "series",
      season: 1,
      episode: 4,
      releaseAt: "2026-06-05",
      releasePrecision: "date",
      status: "upcoming",
    }),
    { nowMs: NOW },
  );
  expect(item.releaseStatus).toBe("upcoming");
  expect(item.providerConfirmed).toBe(false);
});

test("unknown release date never renders as confirmed", () => {
  const item = buildCalendarItem(
    scheduleItem({ releaseAt: null, releasePrecision: "unknown", status: "unknown" }),
    { nowMs: NOW, providerConfirmed: true },
  );
  expect(item.releaseStatus).toBe("unknown");
  expect(item.providerConfirmed).toBe(false);
  expect(item.reason).toBe("catalog-only");
  expect(item.display.statusLabel.toLowerCase()).toContain("unknown");
});

test("provider-confirmed available item is marked confirmed", () => {
  const item = buildCalendarItem(
    scheduleItem({ releaseAt: "2026-06-04T10:00:00.000Z", status: "released", episode: 28 }),
    { nowMs: NOW, providerConfirmed: true },
  );
  expect(item.providerConfirmed).toBe(true);
  expect(item.reason).toBe("provider-confirmed");
});
