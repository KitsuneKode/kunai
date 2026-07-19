import { describe, expect, test } from "bun:test";

import { resolveVideasyClientProfile } from "../src/videasy/direct";

const runtimeContext = { now: () => new Date().toISOString() };

describe("resolveVideasyClientProfile", () => {
  test("bc-frontend uses cineby.at origin and title-scoped series referer", () => {
    const profile = resolveVideasyClientProfile(
      {
        title: {
          id: "1396",
          tmdbId: "1396",
          kind: "series",
          title: "Breaking Bad",
          year: 2008,
        },
        mediaKind: "series",
        episode: { season: 1, episode: 1 },
      },
      runtimeContext,
      { appId: "bc-frontend" },
    );

    expect(profile).toMatchObject({
      appId: "bc-frontend",
      origin: "https://www.cineby.at",
      defaultReferer: "https://www.cineby.at/tv/1396/1/1",
      streamReferer: "https://www.cineby.at/tv/1396/1/1",
    });
  });

  test("bc-frontend uses cineby.at movie referer", () => {
    const profile = resolveVideasyClientProfile(
      {
        title: {
          id: "181886",
          tmdbId: "181886",
          kind: "movie",
          title: "Enemy",
          year: 2013,
        },
        mediaKind: "movie",
      },
      runtimeContext,
      { appId: "bc-frontend" },
    );

    expect(profile.origin).toBe("https://www.cineby.at");
    expect(profile.streamReferer).toBe("https://www.cineby.at/movie/181886");
  });

  test("vidking profile keeps vidking.net origin", () => {
    const profile = resolveVideasyClientProfile(
      {
        title: {
          id: "181886",
          tmdbId: "181886",
          kind: "movie",
          title: "Enemy",
          year: 2013,
        },
        mediaKind: "movie",
      },
      runtimeContext,
      { appId: "vidking" },
    );

    expect(profile.origin).toBe("https://www.vidking.net");
    expect(profile.streamReferer).toContain("vidking.net");
  });
});
