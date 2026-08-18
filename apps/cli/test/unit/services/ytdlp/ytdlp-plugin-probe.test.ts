import { describe, expect, test } from "bun:test";

import { parseYtDlpPluginProbe } from "@/services/ytdlp/YtDlpService";

/**
 * YouTube requires a Proof-of-Origin token for media requests on most player
 * clients. yt-dlp cannot mint one itself, so when no provider plugin is loaded a
 * resolve succeeds and playback then answers 403 — the failure the user actually
 * sees. These cases pin the parse of yt-dlp's `--verbose` banner that tells us
 * which case we are in.
 */
describe("parseYtDlpPluginProbe", () => {
  test("reports no provider on a stock yt-dlp install", () => {
    const probe = parseYtDlpPluginProbe(
      [
        "[debug] Plugin directories: none",
        "[debug] [youtube] [pot] PO Token Providers: none",
        "[debug] [youtube] [pot] PO Token Cache Providers: memory",
      ].join("\n"),
    );

    expect(probe.available).toBe(true);
    expect(probe.poTokenProvider).toBe(false);
    expect(probe.plugins).toEqual([]);
  });

  test("detects a provider from the pot banner and names it", () => {
    const probe = parseYtDlpPluginProbe(
      "[debug] [youtube] [pot] PO Token Providers: BgUtilHTTP-0.9.0, BgUtilScript-0.9.0",
    );

    expect(probe.poTokenProvider).toBe(true);
    expect(probe.plugins).toEqual(["BgUtilHTTP-0.9.0", "BgUtilScript-0.9.0"]);
  });

  test("detects the bgutil provider when it only shows as an extractor plugin", () => {
    const probe = parseYtDlpPluginProbe("[debug] Extractor Plugins: BgUtilPot");

    expect(probe.poTokenProvider).toBe(true);
    expect(probe.plugins).toEqual(["BgUtilPot"]);
  });

  test("an unrelated extractor plugin does not count as a token provider", () => {
    const probe = parseYtDlpPluginProbe("[debug] Extractor Plugins: SomeOtherSite");

    expect(probe.poTokenProvider).toBe(false);
    expect(probe.plugins).toEqual(["SomeOtherSite"]);
  });

  test("cache providers are not mistaken for token providers", () => {
    // `memory` is always present and says nothing about minting tokens.
    const probe = parseYtDlpPluginProbe(
      [
        "[debug] [youtube] [pot] PO Token Providers: none",
        "[debug] [youtube] [pot] PO Token Cache Providers: memory",
        "[debug] [youtube] [pot] PO Token Cache Spec Providers: webpo",
      ].join("\n"),
    );

    expect(probe.poTokenProvider).toBe(false);
  });
});
