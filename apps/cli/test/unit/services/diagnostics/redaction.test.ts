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

  test("redacts a standalone opaque token carried under an unrecognized field", () => {
    const token = "UDdMMzNubjBnVTJYNWRWMkllNy1xdzpfWXp1eHVUSWk3LUhkMGp1";

    expect(redactDiagnosticValue({ providerDetail: token })).toEqual({
      providerDetail: "[redacted]",
    });
    expect(redactDiagnosticValue(token)).toBe("[redacted]");
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

describe("Kunai's own identifiers survive redaction", () => {
  test("a job UUID stays readable in a diagnostic context", () => {
    // Regression: the opaque-value heuristic redacted every canonical UUID.
    // A v4 uuid is 36 chars of hex, mixes letters and digits, and its last
    // group is always exactly OPAQUE_MIN_UNBROKEN_RUN long — so it cleared
    // every gate by a single character and `jobId` came back "[redacted]",
    // removing the one field that answers "which job failed?".
    expect(
      redactDiagnosticValue({
        source: "download-manager",
        jobId: "b3c1d4a1-4d8b-4b66-ad78-7d5adc2a0e8d",
      }),
    ).toEqual({
      source: "download-manager",
      jobId: "b3c1d4a1-4d8b-4b66-ad78-7d5adc2a0e8d",
    });
  });

  test("every uuid version Kunai can generate is preserved", () => {
    for (const id of [
      crypto.randomUUID(),
      crypto.randomUUID(),
      "00000000-0000-4000-8000-000000000000",
      "FFFFFFFF-FFFF-4FFF-BFFF-FFFFFFFFFFFF",
    ]) {
      expect(redactDiagnosticValue({ id })).toEqual({ id });
    }
  });

  test("the exemption is shape-bound and still redacts real secrets", () => {
    // The point of the carve-out is that a bearer token cannot wear a uuid's
    // shape: its entropy arrives as one unbroken run. If this ever passes
    // through, the exemption has been widened too far.
    for (const secret of [
      "dQw4w9WgXcQ1a2b3c4d5e6f7g8h9i0jK",
      "b3c1d4a14d8b4b66ad787d5adc2a0e8d",
      "b3c1d4a1-4d8b-4b66-ad78-7d5adc2a0e8dEXTRA",
    ]) {
      expect(redactDiagnosticValue({ token: secret })).toEqual({ token: "[redacted]" });
    }
  });
});
