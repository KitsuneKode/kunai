import { describe, expect, test } from "bun:test";

import {
  buildPersistentLoadfileOptions,
  DEFAULT_MPV_YTDL_FORMAT,
  LIVE_DEMUXER_LAVF_OPTIONS,
} from "@/infra/player/mpv-stream-http-headers";
import { buildMpvArgs } from "@/mpv";
import { DEFAULT_CONFIG, DEFAULT_YOUTUBE_EXTRACTOR_ARGS } from "@kunai/config";
import {
  buildYoutubeMpvYtdlRawOptions,
  defaultYtdlPlaybackFormat,
  joinMpvYtdlRawOptions,
  parseYoutubePlayerClients,
  withYoutubePlayerClient,
} from "@kunai/providers/youtube";

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
        ytdlRawOptions: "sponsorblock-remove=%13%sponsor,intro,no-live-from-start=",
      },
      null,
    );

    expect(args).toContain(
      "--ytdl-raw-options=sponsorblock-remove=%13%sponsor,intro,no-live-from-start=",
    );
    expect(args).toContain("--script-opts=ytdlautoformat-domains=");
  });

  test("configures low-latency demuxer and disables start seeking for live streams", () => {
    const args = buildMpvArgs(
      {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        headers: {},
        subtitle: null,
        displayTitle: "Live Broadcast",
        requiresYtdl: true,
        isLive: true,
        startAt: 120,
      },
      null,
    );

    expect(args).toContain("--demuxer-readahead-secs=10");
    expect(args).toContain("--demuxer-max-bytes=32MiB");
    expect(args).toContain("--cache-pause-wait=1");
    expect(args.some((arg) => arg.startsWith("--start="))).toBe(false);
  });
});

describe("shipped YouTube extractor-args default", () => {
  test("the default is set and names only clients that serve playable media URLs", () => {
    expect(DEFAULT_CONFIG.youtubeMetadata.extractorArgs).toBe(DEFAULT_YOUTUBE_EXTRACTOR_ARGS);
    expect(DEFAULT_YOUTUBE_EXTRACTOR_ARGS).toMatch(/^youtube:player_client=/);

    const clients = DEFAULT_YOUTUBE_EXTRACTOR_ARGS.split("=")[1]?.split(",") ?? [];
    // More than one, so a single client rotating out does not break playback.
    expect(clients.length).toBeGreaterThan(1);
    for (const client of clients) {
      expect(["web", "android", "ios", "visionos"]).toContain(client);
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

describe("live streams on the persistent session", () => {
  test("a live replacement carries the low-latency demuxer profile", () => {
    // buildMpvArgs only runs at process spawn. Autoplay and /next replace the file
    // over IPC, so without this a live stream loaded into a running session kept the
    // 60-second VOD readahead and drifted off the live edge.
    const options = buildPersistentLoadfileOptions(
      "https://youtube.com/watch?v=abc",
      900,
      {},
      {
        requiresYtdl: true,
        isLive: true,
      },
    );

    expect(options["demuxer-readahead-secs"]).toBe("10");
    expect(options["demuxer-max-bytes"]).toBe("32MiB");
    expect(options["cache-pause-wait"]).toBe("1");
    expect(options["demuxer-lavf-o"]).toContain("reconnect_max_retries=5");
  });

  test("a live replacement never carries a resume offset", () => {
    const options = buildPersistentLoadfileOptions(
      "https://youtube.com/watch?v=abc",
      900,
      {},
      {
        requiresYtdl: true,
        isLive: true,
      },
    );
    expect(options.start).toBe("0");
  });

  test("a recorded stream keeps its resume offset and the VOD profile", () => {
    const options = buildPersistentLoadfileOptions(
      "https://youtube.com/watch?v=abc",
      900,
      {},
      {
        requiresYtdl: true,
        isLive: false,
      },
    );
    expect(options.start).toBe("900");
    expect(options["demuxer-readahead-secs"]).toBeUndefined();
  });

  test("the loadfile format fallback matches the provider default", () => {
    // Importing the provider barrel here would pull it into the launcher bundle, so
    // the constant is duplicated on purpose and this guards the drift.
    expect(DEFAULT_MPV_YTDL_FORMAT).toBe(defaultYtdlPlaybackFormat());
  });
});

describe("default player clients", () => {
  test("the first failover lane is the client that needs no PO token", () => {
    // Kunai gives each client its own source lane and walks them in order. yt-dlp
    // *skips* formats whose GVS PO-token policy is unmet, so a token-gated client in
    // front spends a whole lane on formats that were never going to be offered.
    // visionos is the only client in INNERTUBE_CLIENTS with no GVS policy, which is
    // why yt-dlp's own _DEFAULT_CLIENTS leads with it too.
    const clients = parseYoutubePlayerClients(DEFAULT_YOUTUBE_EXTRACTOR_ARGS);
    expect(clients[0]).toBe("visionos");
    expect(clients.length).toBeGreaterThan(1);
  });

  test("every default client survives the per-lane rewrite as a single-client value", () => {
    for (const client of parseYoutubePlayerClients(DEFAULT_YOUTUBE_EXTRACTOR_ARGS)) {
      const lane = withYoutubePlayerClient(DEFAULT_YOUTUBE_EXTRACTOR_ARGS, client);
      expect(parseYoutubePlayerClients(lane)).toEqual([client]);
      // One `youtube:` prefix only — a second one turns the key into `youtube:<key>`.
      expect(lane.split("youtube:").length - 1).toBe(1);
    }
  });
});

describe("demuxer-lavf-o composition", () => {
  const LOCAL_HLS = "/tmp/kunai/materialized/stream.m3u8";

  test("a live local-HLS loadfile keeps both the reconnect ladder and the whitelist", () => {
    // mpv's demuxer-lavf-o is single-valued, so writing it twice drops one set.
    // A live stream served from a materialized manifest needs the whitelist or every
    // segment fails instantly, and needs the reconnect ladder or a blip ends playback.
    const options = buildPersistentLoadfileOptions(LOCAL_HLS, 0, {}, { isLive: true });
    const value = options["demuxer-lavf-o"] ?? "";
    expect(value).toContain("reconnect_max_retries=5");
    expect(value).toContain("protocol_whitelist=[file,tcp,tls,https,http,crypto,data]");
  });

  test("a non-live local-HLS loadfile still carries the whitelist alone", () => {
    const options = buildPersistentLoadfileOptions(LOCAL_HLS, 0, {}, { isLive: false });
    expect(options["demuxer-lavf-o"]).toBe(
      "protocol_whitelist=[file,tcp,tls,https,http,crypto,data]",
    );
  });

  test("a remote live loadfile carries the reconnect ladder and no whitelist", () => {
    const options = buildPersistentLoadfileOptions(
      "https://www.youtube.com/watch?v=abc",
      0,
      {},
      { requiresYtdl: true, isLive: true },
    );
    expect(options["demuxer-lavf-o"]).toBe(LIVE_DEMUXER_LAVF_OPTIONS);
    expect(options["demuxer-lavf-o-clr"]).toBeUndefined();
  });

  test("buildMpvArgs emits demuxer-lavf-o exactly once, carrying every fragment", () => {
    const args = buildMpvArgs(
      {
        url: LOCAL_HLS,
        urlKind: "local" as const,
        headers: {},
        subtitle: null,
        displayTitle: "Live",
        isLive: true,
      },
      null,
    );
    const lavf = args.filter((arg) => arg.startsWith("--demuxer-lavf-o="));
    expect(lavf).toHaveLength(1);
    expect(lavf[0]).toContain("reconnect_max_retries=5");
    expect(lavf[0]).toContain("protocol_whitelist=");
  });

  test("a non-live local-HLS launch keeps its reconnect ladder too", () => {
    // The whitelist used to be pushed last and replaced whichever ladder was chosen.
    const args = buildMpvArgs(
      {
        url: LOCAL_HLS,
        urlKind: "local" as const,
        headers: {},
        subtitle: null,
        displayTitle: "VOD",
      },
      null,
    );
    const lavf = args.filter((arg) => arg.startsWith("--demuxer-lavf-o="));
    expect(lavf).toHaveLength(1);
    expect(lavf[0]).toContain("reconnect=1");
    expect(lavf[0]).toContain("protocol_whitelist=");
  });
});
