import { describe, expect, test } from "bun:test";

import { selectYoutubeQuality } from "../../src/youtube/quality-selection";
import type { YtDlpProcess } from "../../src/youtube/spawn-ytdlp";
import {
  buildExactYtdlFormatSelector,
  buildYoutubeAudioSelector,
  buildYtdlFormatSelector,
  extractYtDlpVideoInfo,
  mapYtDlpFormatsToQualityLabels,
} from "../../src/youtube/yt-dlp-metadata";

describe("buildYoutubeAudioSelector", () => {
  test("maps original/unset to ba, languages to an ISO 639-1 prefix match, dub to English, and rejects unsafe input", () => {
    expect(buildYoutubeAudioSelector(undefined)).toBe("ba");
    expect(buildYoutubeAudioSelector("")).toBe("ba");
    expect(buildYoutubeAudioSelector("original")).toBe("ba");
    expect(buildYoutubeAudioSelector("auto")).toBe("ba");
    expect(buildYoutubeAudioSelector("sub")).toBe("ba");
    expect(buildYoutubeAudioSelector("ja")).toBe("(ba[language^=ja]/ba)");
    // yt-dlp filters are case-sensitive and YouTube reports `en-US`: match the primary subtag.
    expect(buildYoutubeAudioSelector("en-US")).toBe("(ba[language^=en]/ba)");
    expect(buildYoutubeAudioSelector("jpn")).toBe("(ba[language^=ja]/ba)");
    expect(buildYoutubeAudioSelector("Japanese")).toBe("(ba[language^=ja]/ba)");
    // `dub` is English everywhere else in Kunai (mpv --alang, dub catalogs).
    expect(buildYoutubeAudioSelector("dub")).toBe(
      "(ba[language^=en][format_note!*=original]/ba[language^=en]/ba)",
    );
    expect(buildYoutubeAudioSelector("ja]/best")).toBe("ba");
    expect(buildYoutubeAudioSelector("en;rm")).toBe("ba");
  });
});

describe("buildExactYtdlFormatSelector", () => {
  test("pins the video id while selecting audio only when needed", () => {
    expect(buildExactYtdlFormatSelector("137", false)).toBe("137+ba");
    expect(buildExactYtdlFormatSelector("18", true)).toBe("18");
    expect(buildExactYtdlFormatSelector("248")).toBe("248+ba/248");
    expect(buildExactYtdlFormatSelector("699", false, "ja")).toBe("699+(ba[language^=ja]/ba)");
    expect(buildExactYtdlFormatSelector("699", false, "original")).toBe("699+ba");
    expect(buildExactYtdlFormatSelector("18", true, "ja")).toBe("18");
    expect(buildExactYtdlFormatSelector("248", undefined, "dub")).toBe(
      "248+(ba[language^=en][format_note!*=original]/ba[language^=en]/ba)/248",
    );
  });

  test("rejects format expression injection instead of broadening the chosen video", () => {
    for (const id of ["", "137/best", "137+248", "137,248", "137[height>0]", "137\n"]) {
      expect(() => buildExactYtdlFormatSelector(id)).toThrow();
    }
  });
});

describe("buildYtdlFormatSelector", () => {
  test("returns default format for undefined, best, auto", () => {
    const def = "bv*+ba/b/ba";
    expect(buildYtdlFormatSelector(undefined)).toBe(def);
    expect(buildYtdlFormatSelector("best")).toBe(def);
    expect(buildYtdlFormatSelector("auto")).toBe(def);
    expect(buildYtdlFormatSelector("")).toBe(def);
    expect(buildYtdlFormatSelector("best", "ja")).toBe(
      "bv*+(ba[language^=ja]/ba)/b/(ba[language^=ja]/ba)",
    );
  });

  test("builds short-side ceiling with DASH merge for numeric qualities", () => {
    expect(buildYtdlFormatSelector("1080p")).toBe(
      "(bv*[height<=1080][aspect_ratio>=1]/bv*[width<=1080][aspect_ratio<1]/bv*[height<=?1080])+ba/(bv*[height<=1080][aspect_ratio>=1]/bv*[width<=1080][aspect_ratio<1]/bv*[height<=?1080])/bv*+ba/b/ba",
    );
    expect(buildYtdlFormatSelector("1440p")).toBe(
      "(bv*[height<=1440][aspect_ratio>=1]/bv*[width<=1440][aspect_ratio<1]/bv*[height<=?1440])+ba/(bv*[height<=1440][aspect_ratio>=1]/bv*[width<=1440][aspect_ratio<1]/bv*[height<=?1440])/bv*+ba/b/ba",
    );
    expect(buildYtdlFormatSelector("4K")).toBe(
      "(bv*[height<=2160][aspect_ratio>=1]/bv*[width<=2160][aspect_ratio<1]/bv*[height<=?2160])+ba/(bv*[height<=2160][aspect_ratio>=1]/bv*[width<=2160][aspect_ratio<1]/bv*[height<=?2160])/bv*+ba/b/ba",
    );
    expect(buildYtdlFormatSelector("1080p", "ja")).toContain("+(ba[language^=ja]/ba)/");
  });
});

describe("mapYtDlpFormatsToQualityLabels", () => {
  test("omits unknown frame rate and bitrate and rejects invented or unsafe format ids", () => {
    const mapped = mapYtDlpFormatsToQualityLabels([
      { format_id: "137", height: 1080, vcodec: "avc1", fps: Infinity, tbr: NaN },
      { format_id: "248/best", height: 1080, vcodec: "vp9" },
      { height: 1080, vcodec: "avc1" },
    ]);
    expect(mapped).toEqual([
      { label: "1080p · H.264 · #137", rank: 1080, formatId: "137", hasAudio: undefined },
    ]);
  });

  test("retains format identity and describes codec, fps and bitrate without duplicating a format", () => {
    const mapped = mapYtDlpFormatsToQualityLabels([
      { format_id: "137", height: 1080, vcodec: "avc1.640028", acodec: "none", fps: 30, tbr: 4500 },
      { format_id: "248", height: 1080, vcodec: "vp9", acodec: "none", fps: 60, tbr: 3000 },
      { format_id: "248", height: 1080, vcodec: "vp9", acodec: "none", fps: 60, tbr: 3000 },
      { format_id: "18", height: 360, vcodec: "avc1", acodec: "mp4a", tbr: 500 },
      { format_id: "audio", height: 480, vcodec: "none" },
      { height: 720, vcodec: "avc1" },
    ]);
    expect(mapped).toHaveLength(3);
    expect(mapped.map((entry) => entry.formatId)).toEqual(["248", "137", "18"]);
    expect(mapped[0]?.label).toBe("1080p · VP9 · 60fps · 3 Mb/s · #248");
    expect(mapped[1]?.label).toContain("H.264");
    expect(mapped[2]).toMatchObject({ formatId: "18", rank: 360 });
    expect(mapped[0]).toMatchObject({ hasAudio: false });
    expect(mapped[2]).toMatchObject({ hasAudio: true });
  });

  test("ranks HTTPS DASH AV1/VP9 HDR10 ahead of slower HLS peak-bitrate streams and tags HDR10 in labels", () => {
    // Real-world format mix captured from YouTube HDR10 video `njX2bu-_Vw4`.
    const mapped = mapYtDlpFormatsToQualityLabels([
      {
        format_id: "642",
        width: 3840,
        height: 2160,
        fps: 60,
        tbr: 30942,
        dynamic_range: "HDR10",
        protocol: "m3u8_native",
        vcodec: "vp09.02.51.10.01.09.16.09.00",
        acodec: "none",
      },
      {
        format_id: "628",
        width: 3840,
        height: 2160,
        fps: 60,
        tbr: 28053,
        dynamic_range: "SDR",
        protocol: "m3u8_native",
        vcodec: "vp09.00.51.08",
        acodec: "none",
      },
      {
        format_id: "337",
        width: 3840,
        height: 2160,
        fps: 60,
        tbr: 28047,
        dynamic_range: "HDR10",
        protocol: "https",
        vcodec: "vp9.2",
        acodec: "none",
      },
      {
        format_id: "701",
        width: 3840,
        height: 2160,
        fps: 60,
        tbr: 24151,
        dynamic_range: "HDR10",
        protocol: "https",
        vcodec: "av01.0.13M.10.0.110.09.16.09.0",
        acodec: "none",
      },
      {
        format_id: "315",
        width: 3840,
        height: 2160,
        fps: 60,
        tbr: 20846,
        dynamic_range: "SDR",
        protocol: "https",
        vcodec: "vp9",
        acodec: "none",
      },
      {
        format_id: "636",
        width: 1920,
        height: 1080,
        fps: 60,
        tbr: 7423,
        dynamic_range: "HDR10",
        protocol: "m3u8_native",
        vcodec: "vp09.02.41.10.01.09.16.09.00",
        acodec: "none",
      },
      {
        format_id: "335",
        width: 1920,
        height: 1080,
        fps: 60,
        tbr: 5858,
        dynamic_range: "HDR10",
        protocol: "https",
        vcodec: "vp9.2",
        acodec: "none",
      },
      {
        format_id: "699",
        width: 1920,
        height: 1080,
        fps: 60,
        tbr: 4401,
        dynamic_range: "HDR10",
        protocol: "https",
        vcodec: "av01.0.09M.10.0.110.09.16.09.0",
        acodec: "none",
      },
      {
        format_id: "303",
        width: 1920,
        height: 1080,
        fps: 60,
        tbr: 2694,
        dynamic_range: "SDR",
        protocol: "https",
        vcodec: "vp9",
        acodec: "none",
      },
    ]);

    expect(mapped.map((entry) => entry.formatId)).toEqual([
      "701",
      "337",
      "642",
      "315",
      "628",
      "699",
      "335",
      "636",
      "303",
    ]);
    expect(selectYoutubeQuality(mapped, "best")?.formatId).toBe("701");
    expect(selectYoutubeQuality(mapped, "1080p")?.formatId).toBe("699");
    expect(mapped[0]?.label).toContain("HDR10");
    expect(mapped[0]?.label).toContain("AV1");
    expect(mapped[0]?.label).not.toContain("HLS");
    expect(mapped[2]?.label).toContain("HDR10");
    expect(mapped[2]?.label).toContain("HLS");
    expect(mapped[3]?.label).not.toContain("HDR");
  });

  test("prefers efficient HTTPS AV1/VP9 over higher-bitrate H.264/HLS on SDR videos", () => {
    const mapped = mapYtDlpFormatsToQualityLabels([
      {
        format_id: "270",
        width: 1920,
        height: 1080,
        fps: 30,
        tbr: 4690,
        dynamic_range: "SDR",
        protocol: "m3u8_native",
        vcodec: "avc1.640028",
        acodec: "none",
      },
      {
        format_id: "137",
        width: 1920,
        height: 1080,
        fps: 30,
        tbr: 3800,
        dynamic_range: "SDR",
        protocol: "https",
        vcodec: "avc1.640028",
        acodec: "none",
      },
      {
        format_id: "248",
        width: 1920,
        height: 1080,
        fps: 30,
        tbr: 2200,
        dynamic_range: "SDR",
        protocol: "https",
        vcodec: "vp9",
        acodec: "none",
      },
      {
        format_id: "399",
        width: 1920,
        height: 1080,
        fps: 30,
        tbr: 1140,
        dynamic_range: "SDR",
        protocol: "https",
        vcodec: "av01.0.08M.08",
        acodec: "none",
      },
    ]);

    expect(mapped.map((entry) => entry.formatId)).toEqual(["399", "248", "137", "270"]);
    expect(selectYoutubeQuality(mapped, "1080p")?.formatId).toBe("399");
  });

  test("ranks HDR10 above SDR but Dolby Vision below SDR at the same resolution", () => {
    const qualities = mapYtDlpFormatsToQualityLabels([
      {
        format_id: "dv",
        height: 2160,
        width: 3840,
        vcodec: "dvh1.05.06",
        dynamic_range: "DV",
        tbr: 30000,
        protocol: "https",
      },
      {
        format_id: "sdr",
        height: 2160,
        width: 3840,
        vcodec: "vp9",
        dynamic_range: "SDR",
        tbr: 18000,
        protocol: "https",
      },
      {
        format_id: "hdr",
        height: 2160,
        width: 3840,
        vcodec: "vp09.02.51.10",
        dynamic_range: "HDR10",
        tbr: 20000,
        protocol: "https",
      },
    ]);
    expect(qualities.map((quality) => quality.formatId)).toEqual(["hdr", "sdr", "dv"]);
    expect(qualities[2]?.dynamicRange).toBe("Dolby Vision");
    expect(qualities[1]?.dynamicRange).toBeUndefined();
  });

  test("ranks portrait Shorts by short side so 1080p selects 1080x1920 instead of 608x1080", () => {
    const mapped = mapYtDlpFormatsToQualityLabels([
      {
        format_id: "401",
        width: 2160,
        height: 3840,
        fps: 30,
        tbr: 9000,
        protocol: "https",
        vcodec: "av01.0.12M.08",
        acodec: "none",
      },
      {
        format_id: "399",
        width: 1080,
        height: 1920,
        fps: 30,
        tbr: 1800,
        protocol: "https",
        vcodec: "av01.0.08M.08",
        acodec: "none",
      },
      {
        format_id: "398",
        width: 720,
        height: 1280,
        fps: 30,
        tbr: 900,
        protocol: "https",
        vcodec: "av01.0.05M.08",
        acodec: "none",
      },
      {
        format_id: "780",
        width: 608,
        height: 1080,
        fps: 30,
        tbr: 650,
        protocol: "https",
        vcodec: "vp9",
        acodec: "none",
      },
    ]);

    expect(mapped.map((entry) => [entry.formatId, entry.rank])).toEqual([
      ["401", 2160],
      ["399", 1080],
      ["398", 720],
      ["780", 608],
    ]);
    expect(selectYoutubeQuality(mapped, "1080p")?.formatId).toBe("399");
    expect(selectYoutubeQuality(mapped, "720p")?.formatId).toBe("398");
    expect(selectYoutubeQuality(mapped, "1080p")?.label).toStartWith("1080p · ");
  });
});

describe("extractYtDlpVideoInfo argv", () => {
  test("terminates options with -- before the provider-influenced watch URL", async () => {
    const seen: string[][] = [];
    const spawn = (command: readonly string[]): YtDlpProcess => {
      seen.push([...command]);
      const payload = new TextEncoder().encode(JSON.stringify({ id: "abc" }));
      const stream = (bytes: Uint8Array) =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
      return {
        stdout: stream(payload),
        stderr: stream(new Uint8Array()),
        exited: Promise.resolve(0),
        kill: () => undefined,
      };
    };

    // A watch URL shaped like a flag must not be parsed as yt-dlp options.
    const hostile = "--dump-json";
    await extractYtDlpVideoInfo(hostile, { spawn });
    expect(seen).toHaveLength(1);
    const argv = seen[0] ?? [];
    // ["yt-dlp", ...flags, "--", url]
    expect(argv[0]).toBe("yt-dlp");
    expect(argv[argv.length - 2]).toBe("--");
    expect(argv[argv.length - 1]).toBe(hostile);
  });

  test("passes the terminator exactly once, not once per call site", async () => {
    const seen: string[][] = [];
    const spawn = (command: readonly string[]): YtDlpProcess => {
      seen.push([...command]);
      const payload = new TextEncoder().encode(JSON.stringify({ id: "abc" }));
      const stream = (bytes: Uint8Array) =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
      return {
        stdout: stream(payload),
        stderr: stream(new Uint8Array()),
        exited: Promise.resolve(0),
        kill: () => undefined,
      };
    };

    await extractYtDlpVideoInfo("https://www.youtube.com/watch?v=abc", { spawn });
    // A second `--` is read by yt-dlp as a positional operand, not a terminator.
    expect((seen[0] ?? []).filter((arg) => arg === "--")).toHaveLength(1);
  });
});

describe("youtube search argv", () => {
  test("terminates options before the search target", async () => {
    const source = await Bun.file(new URL("../../src/youtube/direct.ts", import.meta.url)).text();
    expect(source).toMatch(/"--",\s*youtubeSearchTarget\(/);
  });
});
