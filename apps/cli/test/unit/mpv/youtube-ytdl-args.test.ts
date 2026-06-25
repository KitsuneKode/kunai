import { describe, expect, test } from "bun:test";

import { buildMpvArgs } from "@/mpv";

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
  });
});
