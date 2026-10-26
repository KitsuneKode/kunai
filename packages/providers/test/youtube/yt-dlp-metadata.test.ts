import { describe, expect, test } from "bun:test";

import type { YtDlpProcess } from "../../src/youtube/spawn-ytdlp";
import {
  buildExactYtdlFormatSelector,
  buildYtdlFormatSelector,
  extractYtDlpVideoInfo,
  mapYtDlpFormatsToQualityLabels,
} from "../../src/youtube/yt-dlp-metadata";

describe("buildExactYtdlFormatSelector", () => {
  test("pins the video id while selecting audio only when needed", () => {
    expect(buildExactYtdlFormatSelector("137", false)).toBe("137+ba");
    expect(buildExactYtdlFormatSelector("18", true)).toBe("18");
    expect(buildExactYtdlFormatSelector("248")).toBe("248+ba/248");
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
  });

  test("builds height ceiling with DASH merge for numeric qualities", () => {
    expect(buildYtdlFormatSelector("1080p")).toBe(
      "bv*[height<=?1080]+ba/bv*[height<=?1080]/bv*+ba/b/ba",
    );
    expect(buildYtdlFormatSelector("1440p")).toBe(
      "bv*[height<=?1440]+ba/bv*[height<=?1440]/bv*+ba/b/ba",
    );
    expect(buildYtdlFormatSelector("4K")).toBe(
      "bv*[height<=?2160]+ba/bv*[height<=?2160]/bv*+ba/b/ba",
    );
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
