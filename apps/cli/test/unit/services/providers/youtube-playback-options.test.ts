import { afterEach, describe, expect, test } from "bun:test";

import { resolveYoutubeYtdlRawOptions } from "@/services/providers/youtube-playback-options";
import { configureYoutubeProvider } from "@kunai/providers/youtube";
import type { StreamCandidate } from "@kunai/types";

function youtubeStream(overrides: Partial<StreamCandidate> = {}): StreamCandidate {
  return {
    id: "stream:youtube:abc:1080p",
    providerId: "youtube",
    sourceId: "source:youtube:visionos",
    url: "https://www.youtube.com/watch?v=abc",
    protocol: "youtube",
    container: "unknown",
    qualityLabel: "1080p",
    qualityRank: 1080,
    requiresYtdl: true,
    confidence: 0.95,
    ...overrides,
  } as StreamCandidate;
}

afterEach(() => {
  configureYoutubeProvider({});
});

describe("resolveYoutubeYtdlRawOptions", () => {
  test("carries a configured PO token through to the mpv raw options", () => {
    // Pass the config into the reader rather than only stashing it on the
    // process-global provider slot: `bun test --parallel` shares that slot
    // across files, so a sibling suite's configureYoutubeProvider({}) used
    // to drop the token between the write and the assertion.
    const config = {
      extractorArgs: "youtube:player_client=visionos",
      poToken: "TOKENVALUE",
    };
    configureYoutubeProvider(config);

    const raw = resolveYoutubeYtdlRawOptions(youtubeStream(), undefined, config) ?? "";
    const expected = "youtube:player_client=visionos;po_token=visionos.gvs+TOKENVALUE";
    // mpv sub-option values are length-prefixed; a miscount truncates the value.
    expect(raw).toContain(`extractor-args=%${expected.length}%${expected}`);
  });

  test("the token follows the lane's own client, not the global default", () => {
    // Each source is one player client and yt-dlp matches a token against the client
    // it was issued for, so a token pinned to the global default is skipped on every
    // other lane.
    const config = {
      extractorArgs: "youtube:player_client=visionos,web",
      poToken: "TOKENVALUE",
    };
    configureYoutubeProvider(config);

    const raw =
      resolveYoutubeYtdlRawOptions(
        youtubeStream({ metadata: { extractorArgs: "youtube:player_client=web" } }),
        undefined,
        config,
      ) ?? "";
    expect(raw).toContain("po_token=web.gvs+TOKENVALUE");
    expect(raw).not.toContain("visionos");
  });

  test("one youtube: prefix only, so yt-dlp can parse the args at all", () => {
    // yt-dlp strips `IE_KEY:` exactly once and splits the rest on `;`. A second
    // `youtube:` lands in the key name and the value is silently dropped.
    const config = {
      extractorArgs: "youtube:player_client=visionos",
      poToken: "TOKENVALUE",
    };
    configureYoutubeProvider(config);

    const raw = resolveYoutubeYtdlRawOptions(youtubeStream(), undefined, config) ?? "";
    const args = raw.slice(raw.indexOf("extractor-args="));
    expect(args.split("youtube:").length - 1).toBe(1);
  });

  test("no token configured leaves the extractor args untouched", () => {
    const config = { extractorArgs: "youtube:player_client=visionos" };
    configureYoutubeProvider(config);
    const raw = resolveYoutubeYtdlRawOptions(youtubeStream(), undefined, config) ?? "";
    expect(raw).not.toContain("po_token");
  });

  test("a live stream asks yt-dlp to join at the live edge", () => {
    const config = { extractorArgs: "youtube:player_client=visionos" };
    configureYoutubeProvider(config);
    const raw =
      resolveYoutubeYtdlRawOptions(
        youtubeStream({ metadata: { liveStatus: "live" } }),
        undefined,
        config,
      ) ?? "";
    // `live-from-start=no` reached yt-dlp as `--live-from-start no`, making `no` a
    // positional URL; the flag form is the one mpv's ytdl hook emits correctly.
    expect(raw).toContain("no-live-from-start=");
    expect(raw).not.toContain("live-from-start=no");
  });

  test("a non-ytdl stream is left alone", () => {
    expect(
      resolveYoutubeYtdlRawOptions(
        youtubeStream({ protocol: "hls", requiresYtdl: false } as Partial<StreamCandidate>),
      ),
    ).toBeUndefined();
  });
});
