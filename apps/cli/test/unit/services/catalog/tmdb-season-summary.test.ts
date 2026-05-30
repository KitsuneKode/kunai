import { expect, test } from "bun:test";

import { summarizeTmdbSeasonEpisodes } from "@/services/catalog/CatalogScheduleService";

const TODAY = "2026-05-29";

test("partitions into latest aired and earliest upcoming by date key", () => {
  const summary = summarizeTmdbSeasonEpisodes(
    [
      { episode_number: 1, air_date: "2026-05-01" },
      { episode_number: 2, air_date: "2026-05-28" },
      { episode_number: 3, air_date: "2026-06-05" },
      { episode_number: 4, air_date: "2026-06-12" },
    ],
    TODAY,
  );
  expect(summary.aired).toEqual({ number: 2, releaseAt: "2026-05-28" });
  expect(summary.next).toEqual({ number: 3, releaseAt: "2026-06-05" });
});

test("a fully-aired season has aired but no next", () => {
  const summary = summarizeTmdbSeasonEpisodes(
    [
      { episode_number: 1, air_date: "2026-01-01" },
      { episode_number: 2, air_date: "2026-01-08" },
    ],
    TODAY,
  );
  expect(summary.aired).toEqual({ number: 2, releaseAt: "2026-01-08" });
  expect(summary.next).toBeUndefined();
});

test("an entirely-future season has next but no aired", () => {
  const summary = summarizeTmdbSeasonEpisodes(
    [
      { episode_number: 1, air_date: "2026-12-01" },
      { episode_number: 2, air_date: "2026-12-08" },
    ],
    TODAY,
  );
  expect(summary.aired).toBeUndefined();
  expect(summary.next).toEqual({ number: 1, releaseAt: "2026-12-01" });
});

test("ignores episodes with no air date or non-positive number", () => {
  const summary = summarizeTmdbSeasonEpisodes(
    [
      { episode_number: 0, air_date: "2026-05-01" },
      { episode_number: 1, air_date: "" },
      { episode_number: 2, air_date: "2026-05-10" },
    ],
    TODAY,
  );
  expect(summary.aired).toEqual({ number: 2, releaseAt: "2026-05-10" });
  expect(summary.next).toBeUndefined();
});

test("a today-dated episode is upcoming, not aired (date-only precision)", () => {
  const summary = summarizeTmdbSeasonEpisodes(
    [
      { episode_number: 1, air_date: "2026-05-20" },
      { episode_number: 2, air_date: TODAY },
    ],
    TODAY,
  );
  expect(summary.aired).toEqual({ number: 1, releaseAt: "2026-05-20" });
  expect(summary.next).toEqual({ number: 2, releaseAt: TODAY });
});

test("empty episode list yields nothing", () => {
  expect(summarizeTmdbSeasonEpisodes([], TODAY)).toEqual({});
});
