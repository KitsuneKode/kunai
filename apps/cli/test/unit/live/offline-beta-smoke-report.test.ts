import { describe, expect, test } from "bun:test";

import {
  buildOfflineBetaSmokeReport,
  OFFLINE_BETA_SMOKE_REQUIRED_CHECKS,
  redactVolatileText,
  type OfflineBetaSmokeCheck,
  type OfflineBetaSmokeCheckId,
} from "../../live/offline-beta-smoke-report";

const ALL_PASSING_CHECKS: readonly OfflineBetaSmokeCheck[] = OFFLINE_BETA_SMOKE_REQUIRED_CHECKS.map(
  (id) => ({ id, ok: true }),
);

const DUPLICATE_CHECKS: readonly OfflineBetaSmokeCheck[] = [
  ...ALL_PASSING_CHECKS,
  { id: "enqueue" as OfflineBetaSmokeCheckId, ok: true },
];

describe("offline beta smoke report", () => {
  test("report passes only with every required check exactly once", () => {
    expect(buildOfflineBetaSmokeReport(ALL_PASSING_CHECKS, "/tmp/profile").ok).toBe(true);
    expect(() => buildOfflineBetaSmokeReport(DUPLICATE_CHECKS, "/tmp/profile")).toThrow();
  });

  test("report fails when any required check fails", () => {
    const checks = ALL_PASSING_CHECKS.map((check) =>
      check.id === "clean-shutdown" ? { ...check, ok: false, detail: "temp residue" } : check,
    );
    const report = buildOfflineBetaSmokeReport(checks, "/tmp/profile");
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/https?:\/\//i);
  });

  test("report throws when a required check is missing", () => {
    expect(() =>
      buildOfflineBetaSmokeReport(ALL_PASSING_CHECKS.slice(0, -1), "/tmp/profile"),
    ).toThrow();
  });

  test("error-path redaction strips fixture URLs and temp paths", () => {
    const synthetic =
      "download failed for https://cdn.example/fixture.mp4 under /tmp/kunai-live-offline-beta-abc/downloads";
    const redacted = redactVolatileText(synthetic);
    expect(redacted).not.toMatch(/https?:\/\/cdn\.example/i);
    expect(redacted).toContain("https://REDACTED");
    expect(redacted).not.toContain("/tmp/kunai-live-offline-beta-abc");
    expect(redacted).toContain("/tmp/REDACTED");
  });
});
