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

/**
 * Signed-CDN query strings are the shape that actually reaches diagnostics, and
 * a name denylist alone never covered them: the token rides in whatever key the
 * CDN picked (`q`, `md5`, `hash`), and `ip` carries the viewer's address. These
 * land in the debug log, the SQLite diagnostics store, the support bundle users
 * paste into GitHub issues, and the trace reporter — one chokepoint, four
 * surfaces — so the value has to be judged, not just the key.
 */
describe("opaque query values", () => {
  test("redacts a high-entropy token regardless of its parameter name", () => {
    const url =
      "https://cdn.example/video.m3u8?q=UDdMMzNubjBnVTJYNWRWMkllNy1xdzpfWXp1eHVUSWk3LUhkMGp1";
    expect(redactDiagnosticValue(url)).toBe("https://cdn.example/video.m3u8?q=[redacted]");
  });

  test("redacts signed-HLS hash and the viewer's IP", () => {
    const url = "https://cdn.example/hls/master.m3u8?md5=9f8e7d6c5b4a39281706&ip=203.0.113.7";
    expect(redactDiagnosticValue(url)).toBe(
      "https://cdn.example/hls/master.m3u8?md5=[redacted]&ip=[redacted]",
    );
  });

  test("keeps short human-meaningful values so diagnostics stay readable", () => {
    // The whole point of judging the value: a search query must survive the
    // same `q` key that carries a token above, or every trace loses its subject.
    expect(redactDiagnosticValue("https://api.example/search?q=Dune")).toBe(
      "https://api.example/search?q=Dune",
    );
    expect(redactDiagnosticValue("https://cdn.example/s.m3u8?quality=1080p")).toBe(
      "https://cdn.example/s.m3u8?quality=1080p",
    );
    expect(redactDiagnosticValue("https://api.example/t?season=2&episode=11")).toBe(
      "https://api.example/t?season=2&episode=11",
    );
  });
});
