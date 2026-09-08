import { describe, expect, test } from "bun:test";

import { buildMpvPlaybackVerifyArgs, redactMpvArgsForLog } from "../../live/mpv-playback-verify";

describe("mpv playback verify args", () => {
  test("splits referer/user-agent to dedicated options and the rest to header fields", () => {
    const args = buildMpvPlaybackVerifyArgs({
      url: "https://cdn.example/watch/master.m3u8",
      headers: {
        referer: "https://provider.example/title",
        "user-agent": "kunai-test/1.0",
        Origin: "https://provider.example",
        Cookie: "session=abc",
      },
      frames: 30,
    });
    expect(args).toContain("--referrer=https://provider.example/title");
    expect(args).toContain("--user-agent=kunai-test/1.0");
    expect(args).toContain(
      "--http-header-fields=Origin: https://provider.example,Cookie: session=abc",
    );
    expect(args.slice(-2)).toEqual(["--", "https://cdn.example/watch/master.m3u8"]);
  });

  test("drops comma-bearing values mpv cannot represent", () => {
    const args = buildMpvPlaybackVerifyArgs({
      url: "https://cdn.example/v.m3u8",
      headers: { Cookie: "a=1, b=2", referer: "https://provider.example" },
    });
    expect(args.some((arg) => arg.includes("a=1"))).toBe(false);
    expect(args).toContain("--referrer=https://provider.example");
  });

  test("headless decode flags come first and URL is last", () => {
    const args = buildMpvPlaybackVerifyArgs({ url: "https://cdn.example/v.m3u8" });
    expect(args.slice(0, 5)).toEqual([
      "--no-config",
      "--force-window=no",
      "--vo=null",
      "--ao=null",
      "--really-quiet",
    ]);
    expect(args.at(-1)).toBe("https://cdn.example/v.m3u8");
  });

  test("mp4upload keeps its tls-verify exception", () => {
    const args = buildMpvPlaybackVerifyArgs({ url: "https://s1.mp4upload.com/file.mp4" });
    expect(args).toContain("--tls-verify=no");
  });

  test("log redaction keeps cookie values out of reports", () => {
    const args = buildMpvPlaybackVerifyArgs({
      url: "https://cdn.example/v.m3u8",
      headers: { Cookie: "CloudFront-Signature=secret" },
    });
    expect(args.some((arg) => arg.includes("secret"))).toBe(true);
    const redacted = redactMpvArgsForLog(args);
    expect(redacted.some((arg) => arg.includes("secret"))).toBe(false);
    expect(redacted.some((arg) => arg.includes("Cookie: REDACTED"))).toBe(true);
  });
});
