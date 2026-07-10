import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

import {
  buildWatchGenreBreakdown,
  resolveTmdbIdentityFromStoredIds,
  resolveWatchTitleTmdbIdentity,
} from "@/domain/lists/WatchGenreStats";
import * as tmdbProxy from "@/services/catalog/tmdb-proxy";
import type { WatchStatsTitleSecondsRow } from "@kunai/storage";

function row(
  patch: Partial<WatchStatsTitleSecondsRow> & Pick<WatchStatsTitleSecondsRow, "titleId">,
): WatchStatsTitleSecondsRow {
  return {
    title: "Demo",
    mediaKind: "series",
    externalIdsJson: null,
    totalSeconds: 1_000,
    ...patch,
  };
}

let fetchSpy: ReturnType<typeof spyOn<typeof tmdbProxy, "fetchTmdbJsonCached">>;

beforeEach(() => {
  fetchSpy = spyOn(tmdbProxy, "fetchTmdbJsonCached").mockImplementation(async (path: string) => {
    if (path.startsWith("/search/")) {
      return { results: [{ id: 42 }] };
    }
    if (path === "/tv/42") {
      return { genres: [{ id: 16, name: "Animation" }] };
    }
    return { genres: [] };
  });
});

afterEach(() => {
  mock.restore();
});

describe("resolveTmdbIdentityFromStoredIds", () => {
  test("reads tmdbId from external ids", () => {
    expect(
      resolveTmdbIdentityFromStoredIds(
        row({
          titleId: "opaque",
          externalIdsJson: JSON.stringify({ tmdbId: "99" }),
        }),
      ),
    ).toEqual({ id: "99", mediaType: "tv" });
  });

  test("accepts numeric title_id and tmdb: prefix", () => {
    expect(resolveTmdbIdentityFromStoredIds(row({ titleId: "12345" }))).toEqual({
      id: "12345",
      mediaType: "tv",
    });
    expect(resolveTmdbIdentityFromStoredIds(row({ titleId: "tmdb:77" }))).toEqual({
      id: "77",
      mediaType: "tv",
    });
  });
});

describe("resolveWatchTitleTmdbIdentity", () => {
  test("falls back to TMDB search when stored ids are missing", async () => {
    const resolved = await resolveWatchTitleTmdbIdentity(
      row({ titleId: "anilist:1", title: "Barakamon" }),
    );
    expect(resolved).toEqual({ id: "42", mediaType: "tv" });
    expect(fetchSpy).toHaveBeenCalledWith("/search/tv?query=Barakamon&include_adult=false&page=1");
  });
});

describe("buildWatchGenreBreakdown", () => {
  test("allocates watched seconds equally across genres", async () => {
    fetchSpy.mockImplementation(async (path: string) => {
      if (path.startsWith("/search/")) return { results: [{ id: 7 }] };
      if (path === "/tv/7") {
        return {
          genres: [
            { id: 16, name: "Animation" },
            { id: 18, name: "Drama" },
          ],
        };
      }
      return { genres: [] };
    });

    const breakdown = await buildWatchGenreBreakdown([
      row({ titleId: "opaque-anime", title: "Split Genres", totalSeconds: 1_000 }),
    ]);

    expect(breakdown.resolvedTitles).toBe(1);
    expect(breakdown.genres).toHaveLength(2);
    expect(breakdown.genres[0]?.totalSeconds).toBe(500);
    expect(breakdown.genres[1]?.totalSeconds).toBe(500);
  });

  test("returns empty genres when TMDB resolution fails", async () => {
    fetchSpy.mockImplementation(async () => ({ results: [] }));

    const breakdown = await buildWatchGenreBreakdown([
      row({ titleId: "no-match", title: "Unknown Title" }),
    ]);

    expect(breakdown.resolvedTitles).toBe(0);
    expect(breakdown.genres).toHaveLength(0);
  });
});
