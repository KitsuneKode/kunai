import { describe, expect, test } from "bun:test";

import { LOCAL_HLS_DEMUXER_LAVF_OPTIONS } from "@/infra/player/mpv-stream-http-headers";
import {
  buildPersistentLoadfileCommand,
  buildPersistentLoadfileOptions,
  normalizeStreamHttpHeaders,
} from "@/infra/player/mpv-stream-http-headers";

describe("normalizeStreamHttpHeaders", () => {
  test("normalizes mixed-case header keys", () => {
    expect(
      normalizeStreamHttpHeaders({
        Referer: "https://cineplay.to/tv/1/1/1",
        "User-Agent": "kunai-test",
        Origin: "https://www.cineplay.to",
      }),
    ).toEqual({
      referer: "https://cineplay.to/tv/1/1/1",
      userAgent: "kunai-test",
      origin: "https://www.cineplay.to",
    });
  });

  test("drops empty header values", () => {
    expect(normalizeStreamHttpHeaders({ referer: "  ", origin: "" })).toEqual({});
  });
});

describe("buildPersistentLoadfileOptions", () => {
  test("includes file-local HTTP options for autoplay-chain replacements", () => {
    expect(
      buildPersistentLoadfileOptions("https://cdn.example/episode.m3u8", 0, {
        referer: "https://www.cineplay.to/tv/99/1/2",
        origin: "https://www.cineplay.to",
        "user-agent": "kunai",
      }),
    ).toEqual({
      start: "0",
      referrer: "https://www.cineplay.to/tv/99/1/2",
      "user-agent": "kunai",
      "http-header-fields": "Origin: https://www.cineplay.to",
      ytdl: "no",
      "demuxer-lavf-o-clr": "",
    });
  });

  test("clears origin when the next stream does not provide one", () => {
    expect(
      buildPersistentLoadfileOptions("https://rivestream.example/episode.m3u8", 0, {
        referer: "https://rivestream.example/watch",
        "user-agent": "kunai",
      }),
    ).toEqual({
      start: "0",
      referrer: "https://rivestream.example/watch",
      "user-agent": "kunai",
      "http-header-fields-clr": "",
      ytdl: "no",
      "demuxer-lavf-o-clr": "",
    });
  });

  test("applies local HLS demuxer options for materialized playlists", () => {
    expect(
      buildPersistentLoadfileOptions("/tmp/kunai-hls/abc/playlist.m3u8", 0, {
        referer: "https://cdn.example/page",
        origin: "https://cdn.example",
        "user-agent": "kunai",
      }),
    ).toEqual({
      start: "0",
      referrer: "https://cdn.example/page",
      "user-agent": "kunai",
      "http-header-fields": "Origin: https://cdn.example",
      "demuxer-lavf-o": LOCAL_HLS_DEMUXER_LAVF_OPTIONS,
    });
  });

  test("supports origin changes across provider profiles on the same loadfile", () => {
    const cineplay = buildPersistentLoadfileOptions("https://cdn.example/a.m3u8", 0, {
      referer: "https://www.cineplay.to/tv/1/1/1",
      origin: "https://www.cineplay.to",
      "user-agent": "kunai",
    });
    const vidking = buildPersistentLoadfileOptions("https://cdn.example/b.m3u8", 0, {
      referer: "https://player.videasy.to/",
      origin: "https://player.videasy.to",
      "user-agent": "kunai",
    });

    expect(cineplay["http-header-fields"]).toBe("Origin: https://www.cineplay.to");
    expect(vidking["http-header-fields"]).toBe("Origin: https://player.videasy.to");
    expect(cineplay["http-header-fields-clr"]).toBeUndefined();
    expect(vidking["http-header-fields-clr"]).toBeUndefined();
  });

  test("keeps resume start positions", () => {
    expect(buildPersistentLoadfileOptions("https://cdn.example/e.mp4", 562, undefined)).toEqual({
      start: "562",
      "http-header-fields-clr": "",
      "demuxer-lavf-o-clr": "",
    });
  });
});

describe("buildPersistentLoadfileCommand", () => {
  test("builds file-local loadfile options for persistent replacements", () => {
    expect(buildPersistentLoadfileCommand("https://cdn.example/next.m3u8")).toEqual([
      "loadfile",
      "https://cdn.example/next.m3u8",
      "replace",
      -1,
      {
        start: "0",
        "http-header-fields-clr": "",
        ytdl: "no",
        "demuxer-lavf-o-clr": "",
      },
    ]);

    expect(
      buildPersistentLoadfileCommand("https://cdn.example/resume.m3u8", 562, {
        referer: "https://cdn.example/page",
        origin: "https://cdn.example",
        "user-agent": "kunai",
      }),
    ).toEqual([
      "loadfile",
      "https://cdn.example/resume.m3u8",
      "replace",
      -1,
      {
        start: "562",
        referrer: "https://cdn.example/page",
        "user-agent": "kunai",
        "http-header-fields": "Origin: https://cdn.example",
        ytdl: "no",
        "demuxer-lavf-o-clr": "",
      },
    ]);
  });

  test("rejects unsafe remote loadfile targets", () => {
    expect(() => buildPersistentLoadfileCommand("--script=evil.lua")).toThrow("unsafe stream URL");
    expect(() => buildPersistentLoadfileCommand("file:///etc/passwd")).toThrow("unsafe stream URL");
  });

  test("allows an explicitly trusted local loadfile target", () => {
    expect(
      buildPersistentLoadfileCommand("/tmp/kunai-hls/playlist.m3u8", 0, undefined, {
        urlKind: "local",
      })[1],
    ).toBe("/tmp/kunai-hls/playlist.m3u8");
  });
});
