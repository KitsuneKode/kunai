import { expect, test } from "bun:test";

import { buildPlayIntent, type PlayableRef } from "@/domain/playback/playable-ref";

function ref(overrides: Partial<PlayableRef> = {}): PlayableRef {
  return {
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    source: "search",
    ...overrides,
  };
}

test("movie ref produces NO episode and autoplay disabled (the bug guard)", () => {
  const intent = buildPlayIntent(ref({ mediaKind: "movie", title: "Transformers" }));
  expect(intent.episode).toBeUndefined();
  expect(intent.autoplayEligible).toBe(false);
  expect(intent.mode).toBe("series"); // general-provider routing, NOT a content label
});

test("movie ref drops season/episode even if a buggy caller supplies them", () => {
  const intent = buildPlayIntent(
    ref({ mediaKind: "movie", season: 1, episode: 1, absoluteEpisode: 1 }),
  );
  expect(intent.episode).toBeUndefined();
  expect(intent.autoplayEligible).toBe(false);
});

test("series ref carries its episode and enables autoplay", () => {
  const intent = buildPlayIntent(ref({ mediaKind: "series", season: 2, episode: 5 }));
  expect(intent.episode).toEqual({ season: 2, episode: 5 });
  expect(intent.autoplayEligible).toBe(true);
  expect(intent.mode).toBe("series");
});

test("series first-watch with no episode defaults to S1E1", () => {
  const intent = buildPlayIntent(ref({ mediaKind: "series" }));
  expect(intent.episode).toEqual({ season: 1, episode: 1 });
});

test("anime ref routes to anime mode and uses absoluteEpisode when episode is absent", () => {
  const intent = buildPlayIntent(ref({ mediaKind: "anime", absoluteEpisode: 64 }));
  expect(intent.mode).toBe("anime");
  expect(intent.autoplayEligible).toBe(true);
  expect(intent.episode).toEqual({ season: 1, episode: 64, absoluteEpisode: 64 });
});

test("resumeSeconds passes through; absent means fresh (0)", () => {
  expect(buildPlayIntent(ref({ resumeSeconds: 743 })).resumeSeconds).toBe(743);
  expect(buildPlayIntent(ref()).resumeSeconds).toBe(0);
  expect(buildPlayIntent(ref({ resumeSeconds: -5 })).resumeSeconds).toBe(0);
});

test("identity fields and provider hint pass through", () => {
  const intent = buildPlayIntent(
    ref({ providerHint: "vidking", externalIds: { tmdbId: "1" }, source: "recommendation" }),
  );
  expect(intent.providerHint).toBe("vidking");
  expect(intent.externalIds).toEqual({ tmdbId: "1" });
  expect(intent.source).toBe("recommendation");
  expect(intent.titleId).toBe("tmdb:1");
  expect(intent.title).toBe("Example");
});
