import { describe, expect, test } from "bun:test";

import type { YtDlpProcess } from "../../src/youtube/spawn-ytdlp";
import {
  buildYtdlFormatSelector,
  extractYtDlpVideoInfo,
  mapYtDlpFormatsToQualityLabels,
} from "../../src/youtube/yt-dlp-metadata";

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
  test("maps valid video formats to unique ranked qualities", () => {
    const formats = [
      { format_id: "1", height: 1080, vcodec: "avc1" },
      { format_id: "2", height: 720, vcodec: "vp9" },
      { format_id: "3", height: 1080, vcodec: "vp9" }, // Duplicate height
      { format_id: "4", height: 0, vcodec: "avc1" }, // Invalid height
      { format_id: "5", height: 480, vcodec: "none" }, // Audio only
    ];

    const mapped = mapYtDlpFormatsToQualityLabels(formats);

    expect(mapped).toEqual([
      { label: "1080p", rank: 1080, formatId: "1" },
      { label: "720p", rank: 720, formatId: "2" },
    ]);
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
