import { describe, expect, test } from "bun:test";

import {
  isStremioAddonProviderId,
  parseStremioAddonUrl,
  stremioStreamUrl,
  stremioVideoId,
} from "../src/stremio-addon/addon-url";

function parsed(url: string) {
  const result = parseStremioAddonUrl(url);
  if (!result.ok) throw new Error(`expected ${url} to parse: ${result.reason}`);
  return result.addon;
}

describe("addon manifest URL", () => {
  test("accepts an https manifest URL and derives base, host and id from it", () => {
    const addon = parsed("  https://addon.example.com/abc123/manifest.json ");

    expect(addon.manifestUrl).toBe("https://addon.example.com/abc123/manifest.json");
    expect(addon.baseUrl).toBe("https://addon.example.com/abc123");
    expect(addon.host).toBe("addon.example.com");
    expect(addon.providerId).toMatch(/^stremio-addon-example-com-[0-9a-f]{8}$/);
    expect(isStremioAddonProviderId(addon.providerId)).toBe(true);
  });

  test("reads the stremio:// form as the same address", () => {
    expect(parsed("stremio://addon.example.com/manifest.json")).toEqual(
      parsed("https://addon.example.com/manifest.json"),
    );
  });

  test("the id is stable for one URL and differs between two configurations of one host", () => {
    const first = parsed("https://addon.example.com/token-a/manifest.json");
    const again = parsed("https://addon.example.com/token-a/manifest.json");
    const other = parsed("https://addon.example.com/token-b/manifest.json");

    expect(first.providerId).toBe(again.providerId);
    expect(first.providerId).not.toBe(other.providerId);
  });

  test("the id never contains the path, which may hold a token", () => {
    const addon = parsed("https://addon.example.com/SECRETTOKEN/manifest.json");

    expect(addon.providerId.toLowerCase()).not.toContain("secrettoken");
    expect(addon.host).not.toContain("SECRETTOKEN");
  });

  test.each([
    ["", "Type an addon"],
    ["not a url", "not a URL"],
    ["http://addon.example.com/manifest.json", "https://"],
    ["https://user:pass@addon.example.com/manifest.json", "username or password"],
    ["https://addon.example.com/manifest.json?token=1", "query string"],
    ["https://addon.example.com/", "/manifest.json"],
    ["https://addon.example.com/configure", "/manifest.json"],
    ["https://127.0.0.1/manifest.json", "public host"],
    ["https://localhost/manifest.json", "public host"],
    ["https://192.168.1.10/manifest.json", "public host"],
    ["https://[::1]/manifest.json", "public host"],
  ])("refuses %p with a reason", (url, reason) => {
    const result = parseStremioAddonUrl(url);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });
});

describe("addon resource paths", () => {
  test("a movie is asked for by IMDb id", () => {
    const addon = parsed("https://addon.example.com/cfg/manifest.json");

    expect(stremioStreamUrl(addon, "movie", stremioVideoId("tt1375666"))).toBe(
      "https://addon.example.com/cfg/stream/movie/tt1375666.json",
    );
  });

  test("an episode is asked for as id:season:episode, encoded as one path segment", () => {
    const addon = parsed("https://addon.example.com/manifest.json");
    const videoId = stremioVideoId("tt0944947", { season: 1, episode: 2 });

    expect(videoId).toBe("tt0944947:1:2");
    expect(stremioStreamUrl(addon, "series", videoId)).toBe(
      "https://addon.example.com/stream/series/tt0944947%3A1%3A2.json",
    );
  });
});
