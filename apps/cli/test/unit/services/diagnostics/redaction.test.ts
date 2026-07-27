import { describe, expect, test } from "bun:test";

import { redactDiagnosticValue, resolveRedactionHomeDir } from "@/services/diagnostics/redaction";

/**
 * Production resolves the home directory from the environment, so mirror that
 * rather than reading `HOME` directly: `HOME` is a Unix convention that Windows
 * does not set, which made these fixtures collapse to `undefined/Videos/...`
 * and the assertions vacuous on the one platform the redaction bug lived on.
 */
const TEST_HOME = resolveRedactionHomeDir() ?? "/home/kunai-test";

describe("resolveRedactionHomeDir", () => {
  test("prefers HOME and falls back to USERPROFILE on Windows", () => {
    expect(resolveRedactionHomeDir({ HOME: "/home/ada" })).toBe("/home/ada");
    expect(resolveRedactionHomeDir({ USERPROFILE: "C:\\Users\\ada" })).toBe("C:\\Users\\ada");
    expect(resolveRedactionHomeDir({ HOME: "/home/ada", USERPROFILE: "C:\\Users\\b" })).toBe(
      "/home/ada",
    );
  });

  test("ignores absent and one-character homes", () => {
    expect(resolveRedactionHomeDir({})).toBeUndefined();
    // Collapsing "/" to "~" would rewrite every separator in every path.
    expect(resolveRedactionHomeDir({ HOME: "/" })).toBeUndefined();
    expect(resolveRedactionHomeDir({ HOME: "" })).toBeUndefined();
  });
});

describe("diagnostics redaction", () => {
  test("keeps URL host and path shape while redacting sensitive values", () => {
    const redacted = redactDiagnosticValue({
      url: "https://cdn.example/stream.m3u8?token=secret&quality=1080p",
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
      url: "https://cdn.example/stream.m3u8?token=[redacted]&quality=1080p",
      headers: {
        Referer: "https://provider.example/watch/[redacted-id]",
        Authorization: "[redacted]",
        Cookie: "[redacted]",
        "User-Agent": "KunaiTest",
      },
      nested: {
        subtitleUrl: "https://subs.example/sub.vtt?sig=[redacted]",
      },
    });
  });

  test("redacts the home directory from local paths", () => {
    const redacted = redactDiagnosticValue(
      {
        outputPath: `${TEST_HOME}/Videos/Kunai/Show/S01E01.mp4`,
      },
      { homeDir: TEST_HOME },
    );

    expect(redacted).toEqual({
      outputPath: "~/Videos/Kunai/Show/S01E01.mp4",
    });
  });

  test("redacts CloudFront-style signed URL query parameters case-insensitively", () => {
    const redacted = redactDiagnosticValue({
      url: "https://cdn.example/stream.m3u8?X-Amz-Signature=secret&x-amz-credential=credential&X-AMZ-SECURITY-TOKEN=session&Policy=allow&quality=1080p",
    });

    expect(redacted).toEqual({
      url: "https://cdn.example/stream.m3u8?X-Amz-Signature=[redacted]&x-amz-credential=[redacted]&X-AMZ-SECURITY-TOKEN=[redacted]&Policy=[redacted]&quality=1080p",
    });
  });

  test("redacts Videasy session token fields and headers", () => {
    const redacted = redactDiagnosticValue({
      videasySessionToken: "session-secret",
      sessionToken: "session-secret",
      headers: {
        "x-session-token": "session-secret",
        "x-app-id": "bc-frontend",
      },
    });

    expect(redacted).toEqual({
      videasySessionToken: "[redacted]",
      sessionToken: "[redacted]",
      headers: {
        "x-session-token": "[redacted]",
        "x-app-id": "bc-frontend",
      },
    });
  });

  test("redacts the home directory when it is embedded in an error sentence", () => {
    const redacted = redactDiagnosticValue(
      {
        error: `Could not open ${TEST_HOME}/Videos/Kunai/Show/S01E01.mp4 after retry`,
      },
      { homeDir: TEST_HOME },
    );

    expect(redacted).toEqual({
      error: "Could not open ~/Videos/Kunai/Show/S01E01.mp4 after retry",
    });
  });

  test("truncates long strings to keep diagnostic bundles bounded", () => {
    const redacted = redactDiagnosticValue({ detail: "a".repeat(1200) });

    expect(redacted).toEqual({ detail: `${"a".repeat(997)}...` });
  });
});
