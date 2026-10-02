import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MpvIpcSession } from "@/infra/player/mpv-ipc";
import { isAllowedMpvUrl, isAllowedSubtitleTarget } from "@/infra/player/mpv-playback-url";
import { attachLateSubtitles, buildMpvArgs, writeMpvSensitiveConf } from "@/mpv";

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
    // "local" widens the scheme set to files; it is not a network-target
    // exemption — an http(s) URL on a private literal stays blocked either way.
    expect(isAllowedMpvUrl("https://169.254.169.254/latest/meta-data", "local")).toBe(false);
    expect(isAllowedMpvUrl("http://127.0.0.1:8080/admin", "local")).toBe(false);
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

  test("sensitive options leave argv for an owner-only include file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-mpv-conf-test-"));
    const endpoint = {
      kind: "unix_socket" as const,
      path: join(dir, "kunai-mpv-test.sock"),
    };
    const opts = {
      url: "https://cdn.example/video.mp4",
      headers: { Cookie: "CloudFront-Key-Pair-Id=K; CloudFront-Signature=S" },
      subtitle: null,
      displayTitle: "Credentialed stream",
    };

    const conf = await writeMpvSensitiveConf(opts, endpoint);
    try {
      expect(conf).not.toBeNull();
      const args = buildMpvArgs(opts, null, {
        sensitiveOptionsPath: conf?.path,
      });

      // argv carries only the include pointer — never the cookie.
      expect(args).toContain(`--include=${conf?.path}`);
      expect(args.some((arg) => arg.includes("CloudFront"))).toBe(false);
      expect(args.some((arg) => arg.startsWith("--http-header-fields"))).toBe(false);

      const body = readFileSync(conf?.path ?? "", "utf8");
      expect(body).toContain("http-header-fields=");
      expect(body).toContain("Cookie: CloudFront-Key-Pair-Id=K");
      if (process.platform !== "win32") {
        expect(statSync(conf?.path ?? "").mode & 0o777).toBe(0o600);
      }
    } finally {
      await conf?.cleanup();
    }
    // Cleanup removed the file — the window where credentials exist on disk
    // is bounded by mpv's startup parse, not by the whole playback session.
    expect(() => statSync(join(dir, "kunai-mpv-test.sock.conf"))).toThrow();
  });

  test("sensitive options still ride argv when no conf path exists", () => {
    const args = buildMpvArgs(
      {
        url: "https://cdn.example/video.mp4",
        headers: { Cookie: "session=abc" },
        subtitle: null,
        displayTitle: "No conf",
      },
      null,
    );
    expect(args.some((arg) => arg.startsWith("--http-header-fields="))).toBe(true);
    expect(args.some((arg) => arg.startsWith("--include="))).toBe(false);
  });

  test("disables tls-verify only for an mp4upload stream host (ani-cli parity)", () => {
    const args = buildMpvArgs(
      {
        url: "https://www6.mp4upload.com/d/file.mp4",
        headers: { Referer: "https://www.mp4upload.com", "User-Agent": "kunai" },
        subtitle: null,
        displayTitle: "Mp4Upload",
      },
      null,
    );
    expect(args).toContain("--tls-verify=no");
    expect(args).toContain("--referrer=https://www.mp4upload.com");
  });

  test("does not let an mp4upload Referer disable TLS for another stream host", () => {
    const args = buildMpvArgs(
      {
        url: "https://cdn.example/d/file.mp4",
        headers: { Referer: "https://www.mp4upload.com", "User-Agent": "kunai" },
        subtitle: null,
        displayTitle: "Unrelated CDN",
      },
      null,
    );
    expect(args).not.toContain("--tls-verify=no");
    expect(args).toContain("--referrer=https://www.mp4upload.com");
  });

  test("keeps TLS verification and HTTP headers for malformed mp4upload-like hosts", () => {
    const args = buildMpvArgs(
      {
        url: "https://.mp4upload.com/d/file.mp4",
        headers: { Referer: "https://www.mp4upload.com", "User-Agent": "kunai" },
        subtitle: null,
        displayTitle: "Malformed Mp4Upload host",
      },
      null,
    );
    expect(args).not.toContain("--tls-verify=no");
    expect(args).toContain("--referrer=https://www.mp4upload.com");
    expect(args).toContain("--user-agent=kunai");
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

describe("subtitle target gating", () => {
  const stream = { url: "https://cdn.example/master.m3u8", headers: {} };

  test("remote subtitles on private literals are refused before mpv ever sees them", () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data",
      "https://127.0.0.1/subs.vtt",
      "http://10.0.0.4/en.srt",
      "http://[fd00::5]/en.srt",
      "https://localhost/subs.vtt",
    ]) {
      expect(isAllowedSubtitleTarget(url, "remote", stream)).toBe(false);
    }
    expect(isAllowedSubtitleTarget("https://subs.example/en.vtt", "remote", stream)).toBe(true);
  });

  test("credential-bearing headers pin subtitles to the stream origin", () => {
    const credentialed = {
      url: "https://cdn.example/master.m3u8",
      headers: { cookie: "signed=abc", referer: "https://watch.example/" },
    };

    // Same-origin subs may ride the signed header set; a different host would
    // exfiltrate the stream's credentials the moment mpv fetches them.
    expect(isAllowedSubtitleTarget("https://cdn.example/en.vtt", "remote", credentialed)).toBe(
      true,
    );
    expect(isAllowedSubtitleTarget("https://evil.example/en.vtt", "remote", credentialed)).toBe(
      false,
    );

    // Authorization counts as credentials; a bare referer alone does not.
    expect(
      isAllowedSubtitleTarget("https://evil.example/en.vtt", "remote", {
        url: "https://cdn.example/x.m3u8",
        headers: { authorization: "Bearer t" },
      }),
    ).toBe(false);
    expect(
      isAllowedSubtitleTarget("https://evil.example/en.vtt", "remote", {
        url: "https://cdn.example/x.m3u8",
        headers: { referer: "https://watch.example/" },
      }),
    ).toBe(true);
  });

  test("uncredentialed streams may attach cross-origin subtitles", () => {
    expect(isAllowedSubtitleTarget("https://subs.example/en.vtt", "remote", stream)).toBe(true);
    expect(isAllowedSubtitleTarget("https://subs.example/en.vtt", "remote")).toBe(true);
  });

  test("local subtitles on a local playback surface stay allowed", () => {
    expect(
      isAllowedSubtitleTarget("/tmp/movie.en.srt", "local", {
        url: "/tmp/movie.mp4",
        headers: {},
      }),
    ).toBe(true);
    expect(isAllowedSubtitleTarget("/tmp/movie.en.srt", "remote", stream)).toBe(false);
  });
});
