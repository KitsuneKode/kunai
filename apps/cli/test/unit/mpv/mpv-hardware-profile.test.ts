import { describe, expect, test } from "bun:test";

import {
  hardwareProfileFor,
  LOW_SPEC_HLS_BITRATE,
  LOW_SPEC_YTDL_FORMAT,
} from "@/infra/player/mpv-hardware-profile";
import { buildPersistentLoadfileOptions } from "@/infra/player/mpv-stream-http-headers";
import { buildMpvArgs } from "@/mpv";

describe("hardwareProfileFor", () => {
  test("flags hosts that cannot software-decode modern streams", () => {
    expect(hardwareProfileFor({ cpuCount: 2, totalMemoryBytes: 8 * 1024 ** 3, arch: "x64" })).toBe(
      "low-spec",
    );
    expect(hardwareProfileFor({ cpuCount: 8, totalMemoryBytes: 3 * 1024 ** 3, arch: "x64" })).toBe(
      "low-spec",
    );
    expect(hardwareProfileFor({ cpuCount: 8, totalMemoryBytes: 16 * 1024 ** 3, arch: "arm" })).toBe(
      "low-spec",
    );
  });

  test("leaves ordinary hosts on the standard profile", () => {
    expect(hardwareProfileFor({ cpuCount: 8, totalMemoryBytes: 16 * 1024 ** 3, arch: "x64" })).toBe(
      "standard",
    );
    expect(
      hardwareProfileFor({ cpuCount: 10, totalMemoryBytes: 8 * 1024 ** 3, arch: "arm64" }),
    ).toBe("standard");
  });

  test("a probe that could not read the host stays on standard", () => {
    expect(hardwareProfileFor({ cpuCount: 0, totalMemoryBytes: 0, arch: "x64" })).toBe("standard");
  });
});

describe("low-spec mpv ceilings", () => {
  const lowSpec = { mpv: { hardwareProfile: "low-spec" as const } };

  test("spawn args add hwdec and an HLS bitrate ceiling", () => {
    const args = buildMpvArgs(
      {
        url: "https://cdn.example/master.m3u8",
        headers: {},
        subtitle: null,
        displayTitle: "Episode 1",
      },
      null,
      lowSpec,
    );
    expect(args).toContain("--hwdec=auto-safe");
    expect(args).toContain(`--hls-bitrate=${LOW_SPEC_HLS_BITRATE}`);
  });

  test("spawn args keep the standard profile free of ceilings", () => {
    const args = buildMpvArgs(
      {
        url: "https://cdn.example/master.m3u8",
        headers: {},
        subtitle: null,
        displayTitle: "Episode 1",
      },
      null,
      { mpv: { hardwareProfile: "standard" } },
    );
    expect(args.some((arg) => arg.startsWith("--hwdec"))).toBe(false);
    expect(args.some((arg) => arg.startsWith("--hls-bitrate"))).toBe(false);
  });

  test("the ytdl default selector is height-capped but an explicit format wins", () => {
    const capped = buildMpvArgs(
      {
        url: "https://www.youtube.com/watch?v=abc123",
        headers: {},
        subtitle: null,
        displayTitle: "Video",
      },
      null,
      lowSpec,
    );
    expect(capped).toContain(`--ytdl-format=${LOW_SPEC_YTDL_FORMAT}`);

    const explicit = buildMpvArgs(
      {
        url: "https://www.youtube.com/watch?v=abc123",
        headers: {},
        subtitle: null,
        displayTitle: "Video",
        ytdlFormat: "bv*[height<=144]+ba/b",
      },
      null,
      lowSpec,
    );
    expect(explicit).toContain("--ytdl-format=bv*[height<=144]+ba/b");
    expect(explicit.some((arg) => arg.includes(LOW_SPEC_YTDL_FORMAT))).toBe(false);
  });

  test("persistent loadfile carries the same ceilings per file", () => {
    const options = buildPersistentLoadfileOptions(
      "https://cdn.example/master.m3u8",
      undefined,
      undefined,
      { hardwareProfile: "low-spec" },
    );
    expect(options.hwdec).toBe("auto-safe");
    expect(options["hls-bitrate"]).toBe(LOW_SPEC_HLS_BITRATE);
  });

  test("persistent loadfile leaves a standard profile untouched", () => {
    const options = buildPersistentLoadfileOptions(
      "https://cdn.example/master.m3u8",
      undefined,
      undefined,
      { hardwareProfile: "standard" },
    );
    expect(options.hwdec).toBeUndefined();
    expect(options["hls-bitrate"]).toBeUndefined();
  });
});
