import { expect, test } from "bun:test";

import { resolveProvenNumericTmdbId } from "@/domain/catalog/tmdb-identity";

test("anime uses external TMDB id", () => {
  expect(
    resolveProvenNumericTmdbId(
      {
        id: "154587",
        externalIds: { anilistId: "154587", tmdbId: "209867" },
      },
      "anime",
    ),
  ).toBe("209867");
});

test("bare numeric anime id is not assumed TMDB", () => {
  expect(resolveProvenNumericTmdbId({ id: "154587" }, "anime")).toBeNull();
});

test("series bare numeric id is treated as TMDB", () => {
  expect(resolveProvenNumericTmdbId({ id: "1396" }, "series")).toBe("1396");
});

test("tmdb: prefix is proven in anime mode", () => {
  expect(resolveProvenNumericTmdbId({ id: "tmdb:209867" }, "anime")).toBe("209867");
});
