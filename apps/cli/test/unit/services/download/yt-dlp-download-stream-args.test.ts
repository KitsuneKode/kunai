import { describe, expect, test } from "bun:test";

import { buildYtDlpDownloadStreamArgs } from "@/services/download/DownloadService";

describe("buildYtDlpDownloadStreamArgs", () => {
  test("rejects stream URLs that begin with a dash", () => {
    expect(() =>
      buildYtDlpDownloadStreamArgs("--exec=touch /tmp/pwned", "/tmp/out.mp4", {}),
    ).toThrow("Refusing to download unsafe stream URL");
  });

  test("places -- immediately before a valid https stream URL", () => {
    const streamUrl = "https://example.com/master.m3u8";
    const args = buildYtDlpDownloadStreamArgs(streamUrl, "/tmp/out.mp4", {});
    const terminatorIndex = args.indexOf("--");
    expect(terminatorIndex).toBeGreaterThanOrEqual(0);
    expect(args[terminatorIndex + 1]).toBe(streamUrl);
    expect(args.slice(terminatorIndex + 2)).toEqual([]);
  });

  test("strips CRLF from header keys and values before --add-header", () => {
    const args = buildYtDlpDownloadStreamArgs("https://example.com/v.mp4", "/tmp/out.mp4", {
      Referer: "https://example.com\r\nX-Injected: evil",
    });
    const headerIndex = args.indexOf("--add-header");
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    expect(args[headerIndex + 1]).toBe("Referer: https://example.comX-Injected: evil");
    expect(args[headerIndex + 1]).not.toMatch(/[\r\n]/);
  });

  test("skips headers whose key or value is empty after sanitization", () => {
    const args = buildYtDlpDownloadStreamArgs("https://example.com/v.mp4", "/tmp/out.mp4", {
      "": "value",
      Referer: "\r\n",
      "User-Agent": "kunai",
    });
    expect(args.filter((arg) => arg === "--add-header")).toHaveLength(1);
    const headerIndex = args.indexOf("--add-header");
    expect(args[headerIndex + 1]).toBe("User-Agent: kunai");
  });
});
