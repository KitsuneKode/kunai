import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { resolveVidlinkDirect } from "../src/vidlink/direct";

const COOKIE = "CloudFront-Policy=abc;CloudFront-Signature=def;CloudFront-Key-Pair-Id=ghi";

function buildContext(onRequest?: (url: string, init: RequestInit) => void) {
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    onRequest?.(url, init);
    if (url.includes("enc-dec.app")) {
      return new Response(JSON.stringify({ result: "ENCRYPTED" }), { status: 200 });
    }
    if (url.includes("vidlink.pro/api/b")) {
      return new Response(
        JSON.stringify({
          stream: {
            type: "dash",
            playlist: "https://sacdn.hakunaymatata.com/dash/x_1080_h265/index_web.mpd",
            playlistHeaders: { Cookie: COOKIE },
            requiresProxy: true,
            playbackMetadata: {
              format: "DASH",
              codecName: "hevc",
              resolutions: ["480", "1080", "720"],
            },
            captions: [{ url: "https://cacdn.example/en.srt", language: "English", type: "srt" }],
          },
        }),
        { status: 200 },
      );
    }
    // Resolve-gate probe on the manifest: 200 only when the cookie rides along.
    const cookie = (init.headers as Record<string, string> | undefined)?.Cookie;
    return new Response(cookie === COOKIE ? '<?xml version="1.0"?><MPD/>' : "denied", {
      status: cookie === COOKIE ? 200 : 403,
    });
  };
  return {
    providerId: "vidlink",
    now: () => new Date().toISOString(),
    fetch: { runtime: "direct-http", fetch: fetchImpl },
  } as unknown as ProviderRuntimeContext;
}

const INPUT = {
  mediaKind: "movie",
  title: { id: "tmdb:27205", title: "Inception", tmdbId: 27205 },
  allowedRuntimes: ["direct-http"],
  qualityPreference: "best",
  startupPriority: "balanced",
} as unknown as ProviderResolveInput;

describe("vidlink DASH delivery", () => {
  test("asks for the webkit playback environment", async () => {
    const seen: Record<string, RequestInit> = {};
    await resolveVidlinkDirect(
      INPUT,
      buildContext((url, init) => {
        if (url.includes("vidlink.pro/api/b")) seen.api = init;
      }),
    );

    const headers = seen.api?.headers as Record<string, string>;
    // Without this VidLink returns proxy-locked MP4s that answer 429 to any CLI.
    expect(headers["x-playback-environment"]).toBe("webkit");
  });

  test("carries the CloudFront cookie onto the stream, so gate and mpv both pass", async () => {
    const result = await resolveVidlinkDirect(INPUT, buildContext());

    expect(result.status).toBe("resolved");
    const stream = result.streams[0];
    expect(stream?.url).toContain(".mpd");
    expect(stream?.protocol).toBe("dash");
    expect(stream?.headers?.Cookie).toBe(COOKIE);
  });

  test("labels the DASH stream with the highest stated rendition", async () => {
    const result = await resolveVidlinkDirect(INPUT, buildContext());
    // resolutions arrive unordered; without this the panel shows a bare "auto".
    expect(result.streams[0]?.qualityLabel).toBe("1080p");
  });

  test("keeps the provider's subtitle inventory", async () => {
    const result = await resolveVidlinkDirect(INPUT, buildContext());
    expect(result.subtitles.length).toBe(1);
    expect(result.subtitles[0]?.language).toBe("en");
  });
});
