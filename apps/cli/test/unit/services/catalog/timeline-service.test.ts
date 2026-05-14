import { describe, expect, test } from "bun:test";

import type { CatalogScheduleInput } from "@/services/catalog/CatalogScheduleService";
import { TimelineService, buildTimelineBadge } from "@/services/catalog/TimelineService";

const NOW = Date.parse("2026-05-14T10:00:00.000Z");

describe("TimelineService", () => {
  test("describes releases airing today", () => {
    expect(
      buildTimelineBadge(
        {
          source: "tmdb",
          titleId: "1",
          titleName: "Demo",
          type: "series",
          season: 1,
          episode: 2,
          releaseAt: "2026-05-14",
          releasePrecision: "date",
          status: "upcoming",
        },
        NOW,
      ),
    ).toMatchObject({ label: "airs today", tone: "info" });
  });

  test("describes the next future release without provider lookups", async () => {
    const service = new TimelineService(
      {
        getNextRelease: async (input: CatalogScheduleInput) => ({
          source: input.source,
          titleId: input.titleId,
          titleName: input.titleName,
          type: input.type,
          season: input.season,
          episode: input.episode,
          releaseAt: "2026-05-20T12:00:00.000Z",
          releasePrecision: "timestamp",
          status: "upcoming",
        }),
        loadReleasingToday: async () => [],
      },
      () => NOW,
    );

    await expect(
      service.getNextReleaseBadge({
        source: "tmdb",
        titleId: "1",
        titleName: "Demo",
        type: "series",
        season: 1,
        episode: 3,
      }),
    ).resolves.toMatchObject({ label: "next May 20", tone: "info" });
  });
});
