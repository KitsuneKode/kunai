import { expect, test } from "bun:test";

import {
  CatalogScheduleService,
  type CatalogScheduleLoaders,
} from "@/services/catalog/CatalogScheduleService";

const NOW = new Date("2026-06-05T12:00:00.000Z").getTime();

function serviceWithMovieLoader(): CatalogScheduleService {
  const loaders: CatalogScheduleLoaders = {
    nextRelease: async () => null,
    releasingToday: async () => [],
    movieWindow: async () => [
      {
        source: "tmdb",
        titleId: "m-9",
        titleName: "Dune: Part Three",
        type: "movie",
        posterPath: "/dune3.jpg",
        releaseAt: "2026-06-09",
        releasePrecision: "date",
        status: "unknown",
      },
    ],
  };
  return new CatalogScheduleService(loaders, () => NOW);
}

test("loadMovieReleaseWindow normalizes movie items and classifies status", async () => {
  const items = await serviceWithMovieLoader().loadMovieReleaseWindow(7);
  expect(items).toHaveLength(1);
  expect(items[0]?.type).toBe("movie");
  expect(items[0]?.titleId).toBe("m-9");
  // 2026-06-09 is after 2026-06-05 → upcoming once normalized through classifyReleaseStatus.
  expect(items[0]?.status).toBe("upcoming");
});
