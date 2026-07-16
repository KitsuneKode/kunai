import { describe, expect, test } from "bun:test";

import type { MpvIpcSession } from "@/infra/player/mpv-ipc";
import { isAllowedMpvUrl } from "@/infra/player/mpv-playback-url";
import { attachLateSubtitles, buildMpvArgs } from "@/mpv";

function createIpcSession(commands: unknown[][]): MpvIpcSession {
  return {
    async send(command) {
      commands.push([...command]);
      return { ok: true, command, requestId: commands.length, response: {} };
    },
    sendUnchecked() {},
    async close() {},
  };
}

describe("mpv URL safety", () => {
  test("allows remote HTTP targets and only permits files on trusted local surfaces", () => {
    expect(isAllowedMpvUrl("http://cdn.example/video.mp4", "remote")).toBe(true);
    expect(isAllowedMpvUrl("https://cdn.example/video.m3u8", "remote")).toBe(true);
    expect(isAllowedMpvUrl("--script=evil.lua", "remote")).toBe(false);
    expect(isAllowedMpvUrl("file:///etc/passwd", "remote")).toBe(false);
    expect(isAllowedMpvUrl("file:///tmp/movie.mp4", "local")).toBe(true);
    expect(isAllowedMpvUrl("/tmp/movie.mp4", "remote")).toBe(false);
    expect(isAllowedMpvUrl("/tmp/movie.mp4", "local")).toBe(true);
  });

  test("rejects unsafe media argv and terminates options before the URL", () => {
    expect(() =>
      buildMpvArgs(
        {
          url: "--script=evil.lua",
          headers: {},
          subtitle: null,
          displayTitle: "Unsafe",
        },
        null,
      ),
    ).toThrow("unsafe stream URL");

    const url = "https://cdn.example/video.mp4";
    const args = buildMpvArgs({ url, headers: {}, subtitle: null, displayTitle: "Safe" }, null);
    expect(args.at(-2)).toBe("--");
    expect(args.at(-1)).toBe(url);
  });

  test("removes header control characters and origin field separators", () => {
    const args = buildMpvArgs(
      {
        url: "https://cdn.example/video.mp4",
        headers: {
          referer: "https://watch.example/\r\n--script=evil",
          "user-agent": "kunai\n--config=yes",
          origin: "https://watch.example,Authorization: secret\r\nX-Test: yes",
        },
        subtitle: null,
        displayTitle: "Safe headers",
      },
      null,
    );

    expect(args).toContain("--referrer=https://watch.example/--script=evil");
    expect(args).toContain("--user-agent=kunai--config=yes");
    expect(args).toContain(
      "--http-header-fields=Origin: https://watch.exampleAuthorization: secretX-Test: yes",
    );
    expect(args.some((arg) => /[\r\n]/.test(arg))).toBe(false);
  });

  test("skips local subtitle targets on remote playback", () => {
    const args = buildMpvArgs(
      {
        url: "https://cdn.example/video.mp4",
        headers: {},
        subtitle: "file:///etc/passwd",
        displayTitle: "Unsafe subtitle",
      },
      null,
    );
    expect(args.some((arg) => arg.startsWith("--sub-file="))).toBe(false);
  });

  test("allows local media and subtitle targets only when each trust kind is explicit", () => {
    const args = buildMpvArgs(
      {
        url: "/tmp/movie.mp4",
        urlKind: "local",
        headers: {},
        subtitle: "/tmp/movie.en.srt",
        subtitleUrlKind: "local",
        displayTitle: "Offline movie",
      },
      null,
    );
    expect(args).toContain("--sub-file=/tmp/movie.en.srt");
    expect(args.at(-1)).toBe("/tmp/movie.mp4");
  });

  test("late subtitle IPC ignores local paths but attaches allowed remote tracks", async () => {
    const commands: unknown[][] = [];
    const attached = await attachLateSubtitles(createIpcSession(commands), {
      primarySubtitle: "file:///etc/passwd",
      subtitleTracks: [
        { url: "file:///etc/shadow", language: "bad" },
        { url: "https://sub.example/en.vtt", language: "en" },
      ],
    });

    expect(attached).toBe(1);
    expect(commands).toEqual([["sub-add", "https://sub.example/en.vtt", "auto", "", "en"]]);
  });
});
