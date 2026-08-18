import { describe, expect, test } from "bun:test";

import { buildMpvArgs } from "@/mpv";
import { DEFAULT_CONFIG, DEFAULT_YOUTUBE_EXTRACTOR_ARGS } from "@kunai/config";
import { buildYoutubeMpvYtdlRawOptions, joinMpvYtdlRawOptions } from "@kunai/providers/youtube";

describe("buildMpvArgs youtube playback", () => {
  test("adds ytdl-format for YouTube watch URLs", () => {
    const args = buildMpvArgs(
      {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        headers: {},
        subtitle: null,
        displayTitle: "Never Gonna Give You Up",
      },
      null,
    );

    expect(args.some((arg) => arg.startsWith("--ytdl-format="))).toBe(true);
    expect(args.includes("--ytdl=no")).toBe(false);
  });

  test("maps youtube subtitle preference to mpv slang aliases", () => {
    const args = buildMpvArgs(
      {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        headers: {},
        subtitle: null,
        subtitlePreference: "en",
        displayTitle: "Test",
      },
      null,
    );

    expect(args).toContain("--slang=en,eng,en.*,eng.*");
    expect(args).toContain("--subs-fallback=default");
  });

  test("passes sponsorblock and live raw options to mpv ytdl", () => {
    const args = buildMpvArgs(
      {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        headers: {},
        subtitle: null,
        displayTitle: "Test",
        requiresYtdl: true,
        ytdlFormat: "bv*+ba/b",
        ytdlRawOptions: "sponsorblock-remove=%13%sponsor,intro,live-from-start=no",
      },
      null,
    );

    expect(args).toContain(
      "--ytdl-raw-options=sponsorblock-remove=%13%sponsor,intro,live-from-start=no",
    );
    expect(args).toContain("--script-opts=ytdlautoformat-domains=");
  });
});

describe("shipped YouTube extractor-args default", () => {
  test("the default is set and names only clients that serve playable media URLs", () => {
    // yt-dlp's own client order leads with ANDROID_VR, whose media URLs 403 at
    // playback time. Extraction still succeeds, so an unset default fails only
    // once mpv opens the stream — no test or gate catches it upstream of here.
    expect(DEFAULT_CONFIG.youtubeMetadata.extractorArgs).toBe(DEFAULT_YOUTUBE_EXTRACTOR_ARGS);
    expect(DEFAULT_YOUTUBE_EXTRACTOR_ARGS).toMatch(/^youtube:player_client=/);

    const clients = DEFAULT_YOUTUBE_EXTRACTOR_ARGS.split("=")[1]?.split(",") ?? [];
    // More than one, so a single client rotating out does not break playback.
    expect(clients.length).toBeGreaterThan(1);
    for (const client of clients) {
      expect(["mweb", "tv_simply"]).toContain(client);
    }
  });

  test("the default survives the trip into mpv's ytdl-raw-options", () => {
    const args = buildMpvArgs(
      {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        headers: {},
        subtitle: null,
        displayTitle: "Never Gonna Give You Up",
        requiresYtdl: true,
        ytdlRawOptions: joinMpvYtdlRawOptions(
          buildYoutubeMpvYtdlRawOptions({ extractorArgs: DEFAULT_YOUTUBE_EXTRACTOR_ARGS }),
        ),
      },
      null,
    );

    const rawOptions = args.find((arg) => arg.startsWith("--ytdl-raw-options="));
    expect(rawOptions).toBeDefined();
    expect(rawOptions).toContain(
      `extractor-args=%${DEFAULT_YOUTUBE_EXTRACTOR_ARGS.length}%${DEFAULT_YOUTUBE_EXTRACTOR_ARGS}`,
    );
  });
});
