import { describe, expect, test } from "bun:test";

import {
  buildPersistentLoadfileCommand,
  buildPersistentLoadfileOptions,
  buildPersistentSessionHeadersKey,
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

describe("buildPersistentSessionHeadersKey", () => {
  test("ignores per-episode referer drift for session reuse", () => {
    const stable = {
      origin: "https://www.cineplay.to",
      "user-agent": "kunai",
    };
    expect(
      buildPersistentSessionHeadersKey({
        ...stable,
        referer: "https://www.cineplay.to/tv/99/1/1",
      }),
    ).toBe(
      buildPersistentSessionHeadersKey({
        ...stable,
        referer: "https://www.cineplay.to/tv/99/1/2",
      }),
    );
  });

  test("changes when origin or user-agent changes", () => {
    const base = buildPersistentSessionHeadersKey({
      origin: "https://www.cineplay.to",
      "user-agent": "kunai",
      referer: "https://www.cineplay.to/tv/99/1/1",
    });
    expect(
      buildPersistentSessionHeadersKey({
        origin: "https://player.videasy.to",
        "user-agent": "kunai",
      }),
    ).not.toBe(base);
    expect(
      buildPersistentSessionHeadersKey({
        origin: "https://www.cineplay.to",
        "user-agent": "other-agent",
      }),
    ).not.toBe(base);
  });
});

describe("buildPersistentLoadfileOptions", () => {
  test("includes file-local HTTP options for autoplay-chain replacements", () => {
    expect(
      buildPersistentLoadfileOptions(0, {
        referer: "https://www.cineplay.to/tv/99/1/2",
        origin: "https://www.cineplay.to",
        "user-agent": "kunai",
      }),
    ).toEqual({
      start: "0",
      referrer: "https://www.cineplay.to/tv/99/1/2",
      "user-agent": "kunai",
      "http-header-fields": "Origin: https://www.cineplay.to",
    });
  });

  test("keeps resume start positions", () => {
    expect(buildPersistentLoadfileOptions(562, undefined)).toEqual({ start: "562" });
  });
});

describe("buildPersistentLoadfileCommand", () => {
  test("builds file-local loadfile start options for every persistent replacement", () => {
    expect(buildPersistentLoadfileCommand("https://cdn.example/next.m3u8")).toEqual([
      "loadfile",
      "https://cdn.example/next.m3u8",
      "replace",
      -1,
      { start: "0" },
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
      },
    ]);
  });
});
