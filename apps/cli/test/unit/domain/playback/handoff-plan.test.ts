import { describe, expect, test } from "bun:test";

import { createHandoffPlan } from "@/domain/playback/handoff-plan";
import { DETACHED_HANDOFF_CAPABILITIES } from "@/domain/playback/player-capabilities";
import type { StreamInfo } from "@/domain/types";

function stream(overrides: Partial<StreamInfo> = {}): StreamInfo {
  return {
    url: "https://media.example/episode.m3u8",
    headers: {},
    timestamp: 1,
    ...overrides,
  };
}

function plan(overrides: Partial<StreamInfo> = {}, localSource = false) {
  return createHandoffPlan({
    stream: stream(overrides),
    player: "vlc",
    capabilities: DETACHED_HANDOFF_CAPABILITIES,
    localSource,
  });
}

function gatewayPlan(overrides: Partial<StreamInfo> = {}, serveDocument = false) {
  return createHandoffPlan({
    stream: stream(overrides),
    player: "vlc",
    capabilities: DETACHED_HANDOFF_CAPABILITIES,
    localSource: false,
    gateway: {
      serveHeaders: true,
      serveExternalSubtitles: true,
      serveDocument,
    },
  });
}

describe("detached handoff plan", () => {
  test.each(["http://media.example/video.mp4", "https://media.example/episode.m3u8"])(
    "accepts an absolute headerless URL: %s",
    (url) => {
      expect(plan({ url })).toEqual({ ok: true, url, player: "vlc" });
    },
  );

  test("classifies cookie and other non-empty headers separately", () => {
    expect(
      plan({
        headers: {
          Cookie: "session=secret",
          Referer: "https://provider.example/",
          Origin: "",
        },
      }),
    ).toEqual({
      ok: false,
      blockers: ["custom-headers-required", "cookies-required"],
    });
  });

  test("rejects yt-dlp and unresolved deferred media", () => {
    expect(plan({ requiresYtdl: true, deferredLocator: "allmanga-ak:fixture" })).toEqual({
      ok: false,
      blockers: ["yt-dlp-required", "deferred-source"],
    });
  });

  test.each(["file:///tmp/video.mp4", "javascript:alert(1)", "relative/video.m3u8", ""])(
    "rejects a non-HTTP source: %s",
    (url) => {
      expect(plan({ url })).toEqual({
        ok: false,
        blockers: ["unsupported-scheme"],
      });
    },
  );

  test("rejects selected external subtitles instead of dropping them", () => {
    expect(plan({ subtitle: "https://subs.example/episode.vtt" })).toEqual({
      ok: false,
      blockers: ["external-subtitle-unsupported"],
    });
  });

  test("rejects additional external subtitle tracks that managed mpv would attach", () => {
    expect(
      plan({
        subtitleList: [
          {
            url: "https://subs.example/episode.ass",
            language: "en",
            sourceKind: "external",
          },
        ],
      }),
    ).toEqual({
      ok: false,
      blockers: ["external-subtitle-unsupported"],
    });
  });

  test("the stream gateway lifts headers, cookies, and subtitle blockers", () => {
    const url = "https://media.example/episode.m3u8";
    expect(
      gatewayPlan({
        headers: { Referer: "https://provider.example/", Cookie: "s=1" },
        subtitle: "https://subs.example/episode.vtt",
      }),
    ).toEqual({ ok: true, url, player: "vlc" });
  });

  test("the gateway only lifts a deferred locator once the document exists", () => {
    expect(gatewayPlan({ deferredLocator: "allmanga-ak:x" }, false)).toEqual({
      ok: false,
      blockers: ["deferred-source"],
    });
    expect(gatewayPlan({ deferredLocator: "allmanga-ak:x", url: "" }, true)).toEqual({
      ok: true,
      url: "",
      player: "vlc",
    });
  });

  test("the gateway never lifts yt-dlp or local-file blockers", () => {
    expect(gatewayPlan({ requiresYtdl: true })).toEqual({
      ok: false,
      blockers: ["yt-dlp-required"],
    });
    expect(
      createHandoffPlan({
        stream: stream({}),
        player: "vlc",
        capabilities: DETACHED_HANDOFF_CAPABILITIES,
        localSource: true,
        gateway: { serveHeaders: true, serveExternalSubtitles: true, serveDocument: true },
      }),
    ).toEqual({ ok: false, blockers: ["local-source-unsupported"] });
  });

  test("rejects local playback until a player contract is proven", () => {
    expect(plan({}, true)).toEqual({
      ok: false,
      blockers: ["local-source-unsupported"],
    });
  });

  test("returns stable, deduplicated blocker order", () => {
    expect(
      plan(
        {
          url: "file:///tmp/video.mp4",
          headers: { cookie: "a=1", COOKIE: "b=2", Referer: "https://provider.example" },
          requiresYtdl: true,
          deferredLocator: "provider:deferred",
          subtitle: "https://subs.example/episode.vtt",
        },
        true,
      ),
    ).toEqual({
      ok: false,
      blockers: [
        "custom-headers-required",
        "cookies-required",
        "yt-dlp-required",
        "deferred-source",
        "unsupported-scheme",
        "external-subtitle-unsupported",
        "local-source-unsupported",
      ],
    });
  });
});
