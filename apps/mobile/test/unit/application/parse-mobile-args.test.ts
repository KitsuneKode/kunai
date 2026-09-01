import { describe, expect, test } from "bun:test";

import { parseMobileArgs } from "../../../src/application/parse-mobile-args";

describe("parseMobileArgs", () => {
  test("parses help and version without runtime work", () => {
    expect(parseMobileArgs([])).toEqual({ kind: "help" });
    expect(parseMobileArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseMobileArgs(["--version"])).toEqual({ kind: "version" });
  });

  test("parses a complete host proof without rewriting query values", () => {
    expect(
      parseMobileArgs([
        "--host-proof",
        "--probe-url",
        "https://probe.example/status?token=secret",
        "--media-url",
        "https://media.example/video.m3u8?token=secret",
      ]),
    ).toEqual({
      kind: "host-proof",
      probeUrl: "https://probe.example/status?token=secret",
      mediaUrl: "https://media.example/video.m3u8?token=secret",
    });
  });

  test("rejects incomplete, duplicate, and unknown flags", () => {
    expect(() => parseMobileArgs(["--host-proof"])).toThrow("--probe-url");
    expect(() =>
      parseMobileArgs([
        "--host-proof",
        "--probe-url",
        "https://probe.example",
        "--probe-url",
        "https://other.example",
        "--media-url",
        "https://media.example/video.m3u8",
      ]),
    ).toThrow("Duplicate --probe-url");
    expect(() => parseMobileArgs(["--unknown"])).toThrow("Unknown option");
  });

  test("accepts only absolute credential-free HTTPS URLs without fragments", () => {
    for (const url of [
      "http://probe.example/status",
      "file:///tmp/probe",
      "/relative/probe",
      "https://user:password@probe.example/status",
      "https://probe.example/status#fragment",
      "https://probe.example/status\r\noutput=/tmp/pwn",
      "https://probe.example/status\0ignored",
    ]) {
      expect(() =>
        parseMobileArgs([
          "--host-proof",
          "--probe-url",
          url,
          "--media-url",
          "https://media.example/video.m3u8",
        ]),
      ).toThrow("absolute credential-free HTTPS");
    }
  });
});
