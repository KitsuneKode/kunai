import { describe, expect, test } from "bun:test";

import { formatMediaItemCount, presentMedia } from "@/domain/media/media-presentation";

describe("presentMedia", () => {
  test("movies ignore legacy synthetic season and episode values", () => {
    expect(
      presentMedia({
        title: "Dune: Part Two",
        mediaKind: "movie",
        season: 1,
        episode: 1,
      }),
    ).toEqual({
      title: "Dune: Part Two",
      kindLabel: "Movie",
      position: { kind: "title" },
      positionLabel: null,
      titleWithPosition: "Dune: Part Two",
      itemNoun: "movie",
    });
  });

  test("series use season and episode position", () => {
    expect(
      presentMedia({
        title: "Severance",
        mediaKind: "series",
        season: 1,
        episode: 3,
      }).positionLabel,
    ).toBe("S01E03");
  });

  test("series default a missing season to 1 when an episode is present", () => {
    expect(
      presentMedia({
        title: "Severance",
        mediaKind: "series",
        episode: 3,
      }),
    ).toMatchObject({
      kindLabel: "Series",
      position: { kind: "episode", episode: 3, season: 1, seasonIsMeaningful: true },
      positionLabel: "S01E03",
      titleWithPosition: "Severance S01E03",
      itemNoun: "episode",
    });
  });

  test("anime hides season unless it is explicitly meaningful", () => {
    expect(
      presentMedia({
        title: "Frieren",
        mediaKind: "anime",
        season: 1,
        episode: 4,
      }).positionLabel,
    ).toBe("E04");

    expect(
      presentMedia({
        title: "Frieren",
        mediaKind: "anime",
        season: 2,
        episode: 4,
        seasonIsMeaningful: true,
      }).positionLabel,
    ).toBe("S02E04");
  });

  test("anime with a meaningful flag but no valid season stays episode-only", () => {
    expect(
      presentMedia({
        title: "Frieren",
        mediaKind: "anime",
        episode: 4,
        seasonIsMeaningful: true,
      }),
    ).toMatchObject({
      kindLabel: "Anime",
      itemNoun: "episode",
      position: { kind: "episode", episode: 4, seasonIsMeaningful: false },
      positionLabel: "E04",
    });
  });

  test("anime theatrical films stay title-level even with a stored S01E01 slot", () => {
    expect(
      presentMedia({
        title: "Demon Slayer: Kimetsu no Yaiba Infinity Castle",
        mediaKind: "anime",
        contentType: "movie",
        season: 1,
        episode: 1,
      }),
    ).toMatchObject({
      kindLabel: "Anime",
      position: { kind: "title" },
      positionLabel: null,
      titleWithPosition: "Demon Slayer: Kimetsu no Yaiba Infinity Castle",
    });
  });

  test("an unrecognised legacy media kind degrades to a title-level presentation", () => {
    expect(
      presentMedia({
        title: "Mystery Row",
        mediaKind: "documentary" as never,
        season: 1,
        episode: 1,
      }),
    ).toMatchObject({
      position: { kind: "title" },
      positionLabel: null,
      titleWithPosition: "Mystery Row",
    });
  });

  test("videos remain title-level", () => {
    expect(
      presentMedia({
        title: "Kunai Release Trailer",
        mediaKind: "video",
        season: 1,
        episode: 1,
      }),
    ).toMatchObject({
      kindLabel: "Video",
      position: { kind: "title" },
      positionLabel: null,
      itemNoun: "video",
    });
  });

  test("series and anime without an episode are title-level, never episode 1", () => {
    expect(presentMedia({ title: "Severance", mediaKind: "series" })).toMatchObject({
      position: { kind: "title" },
      positionLabel: null,
      titleWithPosition: "Severance",
    });
    expect(presentMedia({ title: "Frieren", mediaKind: "anime", season: 2 })).toMatchObject({
      position: { kind: "title" },
      positionLabel: null,
    });
  });

  test.each([
    ["not a number", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["zero", 0],
    ["negative", -3],
    ["fractional", 2.5],
  ] as const)("rejects %s episode values as positions", (_label, episode) => {
    expect(
      presentMedia({ title: "Severance", mediaKind: "series", season: 1, episode }),
    ).toMatchObject({
      position: { kind: "title" },
      positionLabel: null,
    });
  });

  test.each([
    ["not a number", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["zero", 0],
    ["negative", -3],
    ["fractional", 2.5],
  ] as const)("falls back to season 1 for %s series season values", (_label, season) => {
    expect(
      presentMedia({ title: "Severance", mediaKind: "series", season, episode: 3 }).positionLabel,
    ).toBe("S01E03");
  });

  test("anime never renders an invalid season even when marked meaningful", () => {
    expect(
      presentMedia({
        title: "Frieren",
        mediaKind: "anime",
        season: 0,
        episode: 4,
        seasonIsMeaningful: true,
      }).positionLabel,
    ).toBe("E04");
  });

  test("three-digit episodes keep their full number", () => {
    expect(
      presentMedia({ title: "One Piece", mediaKind: "anime", episode: 1084 }).positionLabel,
    ).toBe("E1084");
  });
});

describe("formatMediaItemCount", () => {
  test.each([
    ["movie", 1, "1 movie"],
    ["movie", 2, "2 movies"],
    ["series", 1, "1 episode"],
    ["anime", 2, "2 episodes"],
    ["video", 2, "2 videos"],
  ] as const)("formats %s count %d", (mediaKind, count, expected) => {
    expect(formatMediaItemCount({ mediaKind, count })).toBe(expected);
  });

  test("zero uses the plural noun", () => {
    expect(formatMediaItemCount({ mediaKind: "series", count: 0 })).toBe("0 episodes");
  });
});
