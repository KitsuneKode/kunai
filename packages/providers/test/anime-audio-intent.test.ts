import { describe, expect, test } from "bun:test";

import {
  isAnimeDubAudioPreference,
  resolveAnimeAudioIntent,
} from "../src/shared/anime-audio-intent";

describe("resolveAnimeAudioIntent", () => {
  test("maps original and ja to sub catalog", () => {
    expect(resolveAnimeAudioIntent("original")).toEqual({
      catalogMode: "sub",
      presentation: "sub",
      preferredAudioLanguage: "original",
    });
    expect(resolveAnimeAudioIntent("ja")).toEqual({
      catalogMode: "sub",
      presentation: "sub",
      preferredAudioLanguage: "ja",
    });
  });

  test("maps en and dub to dub catalog", () => {
    expect(resolveAnimeAudioIntent("en")).toEqual({
      catalogMode: "dub",
      presentation: "dub",
      preferredAudioLanguage: "en",
    });
    expect(resolveAnimeAudioIntent("dub")).toEqual({
      catalogMode: "dub",
      presentation: "dub",
      preferredAudioLanguage: "dub",
    });
  });

  test("isAnimeDubAudioPreference reflects catalog mode", () => {
    expect(isAnimeDubAudioPreference("en")).toBe(true);
    expect(isAnimeDubAudioPreference("original")).toBe(false);
  });
});
