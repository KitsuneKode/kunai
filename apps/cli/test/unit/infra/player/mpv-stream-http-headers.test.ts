import { describe, expect, test } from "bun:test";

import { LOCAL_HLS_DEMUXER_LAVF_OPTIONS } from "@/infra/player/mpv-stream-http-headers";
import {
  buildPersistentLoadfileCommand,
  buildPersistentLoadfileOptions,
  normalizeStreamHttpHeaders,
  shouldDisableMpvTlsVerify,
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

describe("shouldDisableMpvTlsVerify", () => {
  test("detects mp4upload by URL or Referer", () => {
    expect(shouldDisableMpvTlsVerify("https://www6.mp4upload.com/d/file.mp4", {})).toBe(true);
    expect(
      shouldDisableMpvTlsVerify("https://cdn.example/file.mp4", {
        Referer: "https://www.mp4upload.com",
      }),
    ).toBe(true);
    expect(shouldDisableMpvTlsVerify("https://cdn.example/file.mp4", {})).toBe(false);
  });

  test("leaves other provider streams on default TLS verification", () => {
    const otherProviders = [
      {
        url: "https://cdn.videasy.example/ep.m3u8",
        headers: { Referer: "https://cineby.at/", "User-Agent": "kunai" },
      },
      {
        url: "https://cdn.vidlink.example/stream.mp4",
        headers: { Referer: "https://vidlink.pro/", "User-Agent": "kunai" },
      },
      {
        url: "https://cdn.rivestream.example/master.m3u8",
        headers: { Referer: "https://rivestream.example/watch", "User-Agent": "kunai" },
      },
      {
        url: "https://cdn.miruro.example/episode.m3u8",
        headers: { Referer: "https://www.miruro.tv/", "User-Agent": "kunai" },
      },
      {
        url: "https://cdn.allanime.example/video.mp4",
        headers: { Referer: "https://mkissa.to", "User-Agent": "kunai" },
      },
    ] as const;

    for (const sample of otherProviders) {
      expect(shouldDisableMpvTlsVerify(sample.url, sample.headers)).toBe(false);
      expect(buildPersistentLoadfileOptions(sample.url, 0, sample.headers)["tls-verify"]).toBe(
        undefined,
      );
    }
  });
});

describe("buildPersistentLoadfileOptions", () => {
  // mpv's `ytdl` is a yes/no Flag and `ytdl-format` is a String. Setting the
  // format on `ytdl` made mpv answer "unsupported format for accessing
  // property" over IPC and drop the option, so the ceiling never applied.
  test("puts the YouTube format in ytdl-format and keeps ytdl a yes/no flag", () => {
    const options = buildPersistentLoadfileOptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      0,
      undefined,
      { ytdlFormat: "bv*[height<=1080]+ba/b" },
    );

    expect(options.ytdl).toBe("yes");
    expect(options["ytdl-format"]).toBe("bv*[height<=1080]+ba/b");
  });

  test("falls back to the default format rather than leaving the ceiling unset", () => {
    const options = buildPersistentLoadfileOptions("https://example.test/v", 0, undefined, {
      requiresYtdl: true,
    });

    expect(options.ytdl).toBe("yes");
    expect(options["ytdl-format"]).toBe("bv*+ba/b");
  });

  test("still disables ytdl outright for remote HLS manifests", () => {
    const options = buildPersistentLoadfileOptions("https://cdn.example/a.m3u8", 0, undefined);

    expect(options.ytdl).toBe("no");
    expect(options["ytdl-format"]).toBeUndefined();
  });

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

  test("disables tls-verify for mp4upload streams (ani-cli parity)", () => {
    expect(
      buildPersistentLoadfileOptions("https://www6.mp4upload.com/d/file.mp4", 12, {
        Referer: "https://www.mp4upload.com",
        "User-Agent": "kunai",
      }),
    ).toEqual({
      start: "12",
      referrer: "https://www.mp4upload.com",
      "user-agent": "kunai",
      "http-header-fields-clr": "",
      "tls-verify": "no",
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

  test("a ytdl quality ceiling goes to ytdl-format, not the ytdl flag", () => {
    // mpv's `--ytdl` is a yes/no flag and `--ytdl-format` is the selector.
    // Assigning the selector to `ytdl` was accepted by mpv and then ignored, so
    // the persistent session silently played 720p for a `height<=144` request.
    const options = buildPersistentLoadfileOptions(
      "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      0,
      undefined,
      { requiresYtdl: true, ytdlFormat: "bestvideo[height<=144]+bestaudio/bv*+ba/b" },
    );

    expect(options["ytdl-format"]).toBe("bestvideo[height<=144]+bestaudio/bv*+ba/b");
    expect(options.ytdl).toBe("yes");
  });

  test("a YouTube watch URL enables ytdl even without an explicit format", () => {
    const options = buildPersistentLoadfileOptions(
      "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      0,
      undefined,
    );
    expect(options.ytdl).toBe("yes");
    expect(options["ytdl-format"]).toBe("bv*+ba/b");
  });

  test("a remote HLS manifest still turns ytdl off and sets no format", () => {
    const options = buildPersistentLoadfileOptions(
      "https://cdn.example/episode.m3u8",
      0,
      undefined,
    );
    expect(options.ytdl).toBe("no");
    expect(options["ytdl-format"]).toBeUndefined();
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
