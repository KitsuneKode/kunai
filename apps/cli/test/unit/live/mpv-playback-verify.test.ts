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

  test("redacts every credential-bearing header, not just Cookie", () => {
    // Cookie was the only name handled, so an Authorization or API-key header
    // rode into the report in the clear.
    const args = buildMpvPlaybackVerifyArgs({
      url: "https://cdn.example/master.m3u8",
      headers: {
        Origin: "https://player.example",
        Authorization: "Bearer super-secret-token",
        "X-Api-Key": "k-9f3c2211",
      },
    });

    const joined = redactMpvArgsForLog(args).join(" ");

    expect(joined).not.toContain("super-secret-token");
    expect(joined).not.toContain("k-9f3c2211");
  });

  test("leaves an unsigned value byte-identical to what was sent", () => {
    // The report is read as a record of the actual request; URL normalisation
    // (an empty path becoming "/") would make it disagree with the wire.
    const args = buildMpvPlaybackVerifyArgs({
      url: "https://cdn.example/master.m3u8",
      headers: { Origin: "https://www.vidking.net" },
    });

    expect(redactMpvArgsForLog(args).join(" ")).toContain("Origin: https://www.vidking.net");
    expect(redactMpvArgsForLog(args).join(" ")).not.toContain("vidking.net/");
  });

  test("keeps non-credential header values readable", () => {
    // The report is a review artifact: `Origin: …` is what proved the Videasy
    // CDN fix, so blanket redaction would remove the evidence it exists for.
    const args = buildMpvPlaybackVerifyArgs({
      url: "https://cdn.example/master.m3u8",
      headers: { Origin: "https://player.example" },
    });

    expect(redactMpvArgsForLog(args).join(" ")).toContain("Origin: https://player.example");
  });

  test("redacts a signed referer without losing which site it names", () => {
    const args = buildMpvPlaybackVerifyArgs({
      url: "https://cdn.example/master.m3u8",
      headers: { referer: "https://site.example/watch?token=abcdef123456&sig=zzz" },
    });

    const joined = redactMpvArgsForLog(args).join(" ");

    expect(joined).not.toContain("abcdef123456");
    expect(joined).toContain("site.example");
  });
});
