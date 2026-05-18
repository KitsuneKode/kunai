import { expect, test } from "bun:test";

import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";

test("streamRequestToResolveInput preserves provider-native ids for anime resolve requests", () => {
  const input = streamRequestToResolveInput(
    {
      title: {
        id: "allanime-opaque-id",
        type: "series",
        name: "Provider Native Anime",
        externalIds: {
          anilistId: "21507",
          malId: "32182",
          tmdbId: "85937",
        },
      },
      episode: {
        season: 1,
        episode: 3,
        release: { availableAt: "2026-05-19T12:00:00.000Z", status: "released" },
      },
      audioPreference: "sub",
      subtitlePreference: "en",
    },
    "anime",
  );

  expect(input.title.id).toBe("allanime-opaque-id");
  expect(input.title.anilistId).toBe("21507");
  expect(input.title.malId).toBe("32182");
  expect(input.title.tmdbId).toBe("85937");
  expect(input.title.externalIds).toEqual({
    anilistId: "21507",
    malId: "32182",
    tmdbId: "85937",
  });
  expect(input.episode?.release?.availableAt).toBe("2026-05-19T12:00:00.000Z");
});
