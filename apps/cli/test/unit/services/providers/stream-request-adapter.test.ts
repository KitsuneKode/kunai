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
      selectedSourceId: " source-a ",
      selectedStreamId: " stream-a-1080 ",
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
  expect(input.preferredSourceId).toBe("source-a");
  expect(input.preferredStreamId).toBe("stream-a-1080");
});

test("streamRequestToResolveInput maps en audio preference to dub presentation", () => {
  const input = streamRequestToResolveInput(
    {
      title: {
        id: "allanime-opaque-id",
        type: "series",
        name: "Provider Native Anime",
      },
      episode: { season: 1, episode: 1 },
      audioPreference: "en",
      subtitlePreference: "en",
    },
    "anime",
  );

  expect(input.preferredPresentation).toBe("dub");
  expect(input.preferredAudioLanguage).toBe("en");
});

test("streamRequestToResolveInput maps startup priority", () => {
  const input = streamRequestToResolveInput(
    {
      title: {
        id: "1396",
        type: "series",
        name: "Breaking Bad",
        externalIds: { tmdbId: "1396" },
      },
      episode: { season: 1, episode: 2 },
      audioPreference: "original",
      subtitlePreference: "en",
      startupPriority: "fast",
    },
    "series",
    "play",
    "tmdb",
  );

  expect(input.startupPriority).toBe("fast");
  expect(input.title.tmdbId).toBe("1396");
});

test("streamRequestToResolveInput normalizes anilist catalog ids for miruro", () => {
  const input = streamRequestToResolveInput(
    {
      title: {
        id: "20431",
        type: "series",
        name: "Hozuki's Coolheadedness",
        externalIds: { anilistId: "20431" },
      },
      episode: { season: 1, episode: 1 },
      audioPreference: "original",
      subtitlePreference: "en",
    },
    "anime",
    "play",
    "anilist",
  );

  expect(input.title.id).toBe("20431");
  expect(input.title.anilistId).toBe("20431");
});

test("streamRequestToResolveInput does not infer anilistId without catalog identity", () => {
  const input = streamRequestToResolveInput(
    {
      title: {
        id: "20431",
        type: "series",
        name: "Hozuki's Coolheadedness",
      },
      episode: { season: 1, episode: 1 },
      audioPreference: "original",
      subtitlePreference: "en",
    },
    "anime",
  );

  expect(input.title.anilistId).toBeUndefined();
});

test("streamRequestToResolveInput uses stored provider native id for allanime resolve", () => {
  const input = streamRequestToResolveInput(
    {
      title: {
        id: "20431",
        type: "series",
        name: "Hozuki's Coolheadedness",
        externalIds: {
          anilistId: "20431",
          providerNativeIds: { allanime: "bxCKTnota29uSRnZw" },
        },
      },
      episode: { season: 1, episode: 1 },
      audioPreference: "sub",
      subtitlePreference: "en",
    },
    "anime",
    "play",
    "provider-native",
    "allanime",
  );

  expect(input.title.id).toBe("bxCKTnota29uSRnZw");
  expect(input.title.anilistId).toBe("20431");
});
