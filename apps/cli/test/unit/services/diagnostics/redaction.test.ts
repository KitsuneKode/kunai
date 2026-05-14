import { describe, expect, test } from "bun:test";

import { redactDiagnosticValue } from "@/services/diagnostics/redaction";

describe("diagnostics redaction", () => {
  test("redacts urls and sensitive headers recursively", () => {
    const redacted = redactDiagnosticValue({
      url: "https://cdn.example/stream.m3u8?token=secret",
      headers: {
        Referer: "https://provider.example/watch/123",
        Authorization: "Bearer secret",
        Cookie: "session=secret",
        "User-Agent": "KunaiTest",
      },
      nested: {
        subtitleUrl: "https://subs.example/sub.vtt?sig=abc",
      },
    });

    expect(redacted).toEqual({
      url: "[redacted-url]",
      headers: {
        Referer: "[redacted-url]",
        Authorization: "[redacted]",
        Cookie: "[redacted]",
        "User-Agent": "KunaiTest",
      },
      nested: {
        subtitleUrl: "[redacted-url]",
      },
    });
  });

  test("redacts the home directory from local paths", () => {
    const redacted = redactDiagnosticValue(
      {
        outputPath: `${process.env.HOME}/Videos/Kunai/Show/S01E01.mp4`,
      },
      { homeDir: process.env.HOME },
    );

    expect(redacted).toEqual({
      outputPath: "~/Videos/Kunai/Show/S01E01.mp4",
    });
  });
});
