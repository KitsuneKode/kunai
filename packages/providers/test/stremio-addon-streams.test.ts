import { describe, expect, test } from "bun:test";

import {
  describeManifestResources,
  manifestServesStream,
  readStreamSubtitles,
  STREMIO_ADDON_LIMITS,
  stremioManifestSchema,
  stremioStreamResponseSchema,
  stremioStreamSchema,
} from "../src/stremio-addon/protocol";
import {
  classifyAddonStreams,
  describeUnsupportedAddonStreams,
} from "../src/stremio-addon/streams";

describe("stream-list envelope", () => {
  test("entries past the cap are counted, never touched", () => {
    const entries = Array.from(
      { length: STREMIO_ADDON_LIMITS.streamsPerResponse + 1 },
      (_, index) => ({ url: `https://cdn.example.com/${index}.mp4` }),
    );
    Object.defineProperty(entries, STREMIO_ADDON_LIMITS.streamsPerResponse, {
      get() {
        throw new Error("the envelope read past its cap");
      },
    });

    const parsed = stremioStreamResponseSchema.parse({ streams: entries });

    expect(parsed.streams.entries).toHaveLength(STREMIO_ADDON_LIMITS.streamsPerResponse);
    expect(parsed.streams.truncated).toBe(1);
  });
});

describe("stream subtitles", () => {
  test("subtitles past the cap are never read", () => {
    const subtitles = Array.from({ length: STREMIO_ADDON_LIMITS.subtitlesPerStream + 1 }, () => ({
      url: "https://subs.example/en.vtt",
      lang: "en",
    }));
    Object.defineProperty(subtitles, STREMIO_ADDON_LIMITS.subtitlesPerStream, {
      get() {
        throw new Error("the stream read a subtitle past its cap");
      },
    });

    const parsed = stremioStreamSchema.parse({
      url: "https://cdn.example.com/a.mp4",
      subtitles,
    });

    expect(readStreamSubtitles(parsed)).toHaveLength(STREMIO_ADDON_LIMITS.subtitlesPerStream);
  });
});

describe("addon stream classification", () => {
  test("a direct https URL is playable and keeps the addon's labels", () => {
    const { playable, unsupportedTotal } = classifyAddonStreams([
      {
        url: "https://cdn.example.com/video/movie.1080p.mp4",
        name: "Example\n1080p",
        description: "Movie.2010.1080p.BluRay\n💾 2.1 GB",
        behaviorHints: { bingeGroup: "example|1080p", filename: "Movie.2010.1080p.mp4" },
      },
    ]);

    expect(unsupportedTotal).toBe(0);
    expect(playable).toHaveLength(1);
    expect(playable[0]).toMatchObject({
      url: "https://cdn.example.com/video/movie.1080p.mp4",
      name: "Example",
      description: "Movie.2010.1080p.BluRay 💾 2.1 GB",
      bingeGroup: "example|1080p",
      qualityLabel: "1080p",
      qualityRank: 1080,
      protocol: "mp4",
      container: "mp4",
      index: 0,
    });
  });

  test("every kind Kunai cannot play is counted under its own reason", () => {
    const { playable, unsupported, unsupportedTotal } = classifyAddonStreams([
      { infoHash: "0123456789abcdef0123456789abcdef01234567", fileIdx: 0 },
      { infoHash: "fedcba9876543210fedcba9876543210fedcba98" },
      { ytId: "dQw4w9WgXcQ" },
      { externalUrl: "https://example.com/watch" },
      { url: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567" },
      { url: "http://192.168.1.20:8080/video.mp4" },
      { url: "http://localhost:11470/abc/0" },
      { name: "nothing playable here" },
      "not an object",
      { url: "https://user:pw@cdn.example.com/video.mp4" },
    ]);

    expect(playable).toEqual([]);
    expect(unsupported).toEqual({
      torrent: 2,
      youtube: 1,
      "external-page": 1,
      "unsupported-scheme": 1,
      "private-address": 2,
      invalid: 3,
    });
    expect(unsupportedTotal).toBe(10);
    expect(describeUnsupportedAddonStreams(unsupported)).toBe(
      "2 torrent, 1 YouTube id, 1 external page, 1 unsupported URL scheme, 2 private address, 3 invalid entry",
    );
  });

  test("a year or a file size is never read as a resolution", () => {
    const { playable } = classifyAddonStreams([
      { url: "https://cdn.example.com/a", name: "Example", description: "Movie 2160 kbps 1999" },
      { url: "https://cdn.example.com/b", name: "Example 4K", description: "Movie" },
    ]);

    expect(playable[0]?.qualityLabel).toBeUndefined();
    expect(playable[0]?.qualityRank).toBe(0);
    expect(playable[1]?.qualityLabel).toBe("2160p");
  });

  test("protocol comes from the URL path or the declared content type", () => {
    const { playable } = classifyAddonStreams([
      { url: "https://cdn.example.com/master.m3u8?sig=1" },
      {
        url: "https://cdn.example.com/play/abc",
        behaviorHints: {
          proxyHeaders: { response: { "Content-Type": "application/vnd.apple.mpegurl" } },
        },
      },
      { url: "https://cdn.example.com/play/def" },
    ]);

    expect(playable.map((stream) => stream.protocol)).toEqual(["hls", "hls", "unknown"]);
  });

  test("request headers are carried, and transport headers are never taken from an addon", () => {
    const { playable } = classifyAddonStreams([
      {
        url: "https://cdn.example.com/a.mp4",
        behaviorHints: {
          notWebReady: true,
          proxyHeaders: {
            request: { Referer: "https://site.example/", Host: "evil.example", "User-Agent": "x" },
          },
        },
      },
    ]);

    expect(playable[0]?.headers).toEqual({ Referer: "https://site.example/", "User-Agent": "x" });
    expect(playable[0]?.notWebReady).toBe(true);
  });

  test("a header that cannot be sent safely rejects the stream instead of dropping the header", () => {
    const { playable, unsupported } = classifyAddonStreams([
      {
        url: "https://cdn.example.com/a.mp4",
        behaviorHints: { proxyHeaders: { request: { Cookie: "a=1\r\nX-Injected: 1" } } },
      },
      {
        url: "https://cdn.example.com/b.mp4",
        behaviorHints: { proxyHeaders: { request: { "Bad Name": "1" } } },
      },
    ]);

    expect(playable).toEqual([]);
    expect(unsupported).toEqual({ invalid: 2 });
  });

  test("a multi-value request header is refused rather than shipped as a combined list", () => {
    const { playable, unsupported } = classifyAddonStreams([
      {
        url: "https://cdn.example.com/a.mp4",
        behaviorHints: {
          proxyHeaders: { request: { Accept: "video/mp4,video/webm" } },
        },
      },
    ]);

    expect(playable).toEqual([]);
    expect(unsupported).toEqual({ invalid: 1 });
  });

  test("the same header listed under two casings cannot change the wire set", () => {
    const { playable, unsupported } = classifyAddonStreams([
      {
        url: "https://cdn.example.com/a.mp4",
        behaviorHints: {
          proxyHeaders: { request: { "X-Auth": "first", "x-auth": "second" } },
        },
      },
    ]);

    expect(playable).toEqual([]);
    expect(unsupported).toEqual({ invalid: 1 });
  });

  test("a valid header is trimmed before it is kept", () => {
    const { playable } = classifyAddonStreams([
      {
        url: "https://cdn.example.com/a.mp4",
        behaviorHints: {
          proxyHeaders: { request: { Referer: "  https://site.example/  " } },
        },
      },
    ]);

    expect(playable[0]?.headers).toEqual({ Referer: "https://site.example/" });
  });

  test("addon-supplied text never echoes the manifest URL's secret parts", () => {
    const manifestUrl = "https://addon.example.com/SECRETTOKEN/manifest.json";
    const { playable } = classifyAddonStreams(
      [
        {
          url: "https://cdn.example.com/a.mp4",
          name: "Example SECRETTOKEN",
          description: "mirrors https://addon.example.com/SECRETTOKEN/manifest.json",
          subtitles: [{ url: "https://subs.example/en.vtt", lang: "en-SECRETTOKEN" }],
          behaviorHints: {
            bingeGroup: "grp-SECRETTOKEN",
            filename: "Movie.SECRETTOKEN.1080p.mp4",
          },
        },
      ],
      manifestUrl,
    );

    const stream = playable[0];
    expect(stream?.url).toBe("https://cdn.example.com/a.mp4");
    for (const field of [
      stream?.name,
      stream?.description,
      stream?.filename,
      stream?.bingeGroup,
      stream?.subtitles[0]?.language,
    ]) {
      expect(field).toBeDefined();
      expect(field).not.toContain("SECRETTOKEN");
      expect(field).not.toContain("manifest.json");
    }
  });

  test("one URL listed twice is one stream at its first position", () => {
    const { playable, unsupportedTotal } = classifyAddonStreams([
      { url: "https://cdn.example.com/a.mp4", name: "First" },
      { url: "https://cdn.example.com/a.mp4", name: "Second" },
    ]);

    expect(playable.map((stream) => stream.name)).toEqual(["First"]);
    expect(unsupportedTotal).toBe(0);
  });

  test("subtitles on private hosts are left out; null optionals are accepted", () => {
    const { playable } = classifyAddonStreams([
      {
        url: "https://cdn.example.com/a.mp4",
        name: null,
        title: null,
        subtitles: [
          { id: "1", url: "https://subs.example.com/en.vtt", lang: "eng" },
          { id: "2", url: "http://127.0.0.1/local.srt", lang: "eng" },
          { broken: true },
        ],
      },
    ]);

    expect(playable[0]?.subtitles).toEqual([
      { url: "https://subs.example.com/en.vtt", language: "eng" },
    ]);
  });
});

describe("addon manifest", () => {
  const base = { id: "org.example", name: "Example", version: "1.0.0" };

  test("a bare stream resource inherits the manifest's types and id prefixes", () => {
    const manifest = stremioManifestSchema.parse({
      ...base,
      resources: ["catalog", "stream"],
      types: ["movie", "series"],
      idPrefixes: ["tt"],
    });

    expect(manifestServesStream(manifest, "movie", "tt1375666")).toEqual({ served: true });
    expect(manifestServesStream(manifest, "series", "tt0944947:1:2")).toEqual({ served: true });
    expect(describeManifestResources(manifest)).toEqual({
      streamTypes: ["movie", "series"],
      otherResources: ["catalog"],
    });
  });

  test("an object resource uses its own types and prefixes", () => {
    const manifest = stremioManifestSchema.parse({
      ...base,
      resources: [{ name: "stream", types: ["movie"], idPrefixes: ["tt"] }],
      types: ["movie", "series"],
    });

    expect(manifestServesStream(manifest, "movie", "tt1375666")).toEqual({ served: true });
    expect(manifestServesStream(manifest, "series", "tt0944947:1:2")).toEqual({
      served: false,
      reason: "the addon has no series streams",
    });
  });

  test("an addon with no stream resource, or no IMDb prefix, says why it is not asked", () => {
    const catalogOnly = stremioManifestSchema.parse({
      ...base,
      resources: ["catalog", "meta"],
      types: ["movie"],
    });
    const kitsuOnly = stremioManifestSchema.parse({
      ...base,
      resources: ["stream"],
      types: ["movie"],
      idPrefixes: ["kitsu:"],
    });

    expect(manifestServesStream(catalogOnly, "movie", "tt1")).toEqual({
      served: false,
      reason: "the addon does not provide streams",
    });
    expect(manifestServesStream(kitsuOnly, "movie", "tt1")).toEqual({
      served: false,
      reason: "the addon does not accept IMDb ids",
    });
  });

  test("a manifest without the required fields is refused", () => {
    expect(stremioManifestSchema.safeParse({ name: "x", resources: [], types: [] }).success).toBe(
      false,
    );
    expect(stremioManifestSchema.safeParse({ ...base, resources: "stream" }).success).toBe(false);
  });
});

describe("addon text shown in the terminal", () => {
  test("control characters in a stream's labels never reach the screen", () => {
    const { playable } = classifyAddonStreams([
      {
        url: "https://cdn.example.com/a.mp4",
        name: "\u001b[31mExample\u0007 1080p\nsecond line",
        description: "line one\u001b[2J\n\tline two",
      },
    ]);

    expect(playable[0]?.name).toBe("[31mExample 1080p");
    expect(playable[0]?.description).toBe("line one [2J line two");
  });
});
