import { describe, expect, test } from "bun:test";

import {
  formatMobileDeviceEvidenceRow,
  mobileDeviceEvidencePassed,
  validateMobileDeviceEvidence,
  type MobileDeviceEvidence,
} from "../../live/device-host-proof";

const SHA256 = "a".repeat(64);

function androidEvidence(overrides: Partial<MobileDeviceEvidence> = {}): MobileDeviceEvidence {
  return {
    schemaVersion: 1,
    platform: "android",
    osVersion: "15",
    terminal: "termux",
    architecture: "arm64",
    player: "vlc",
    artifactSha256: SHA256,
    terminalInput: "passed",
    http: "passed",
    stateRecovery: "passed",
    cancellation: "passed",
    handoffAccepted: true,
    playbackBegan: true,
    recordedAt: "2026-08-31T12:00:00.000Z",
    ...overrides,
  };
}

describe("mobile physical-device evidence", () => {
  test("accepts the exact Android and iPhone physical-device shapes", () => {
    expect(validateMobileDeviceEvidence(androidEvidence())).toEqual(androidEvidence());
    expect(
      validateMobileDeviceEvidence(
        androidEvidence({
          platform: "ios",
          osVersion: "19.6.2",
          terminal: "a-shell-mini",
        }),
      ),
    ).toMatchObject({ platform: "ios", terminal: "a-shell-mini", architecture: "arm64" });
  });

  test("rejects missing, unknown, secret-shaped, URL-shaped, and query-shaped data", () => {
    const missing: Record<string, unknown> = { ...androidEvidence() };
    delete missing.http;
    expect(() => validateMobileDeviceEvidence(missing)).toThrow("exact fields");

    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), notes: "tested manually" }),
    ).toThrow("exact fields");
    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), authorization: "Bearer secret" }),
    ).toThrow("sensitive field");
    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), cookie: "session=secret" }),
    ).toThrow("sensitive field");
    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), osVersion: "https://device.invalid" }),
    ).toThrow("redacted strings");
    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), osVersion: "15?token=secret" }),
    ).toThrow("redacted strings");
  });

  test("rejects future schemas, invalid hashes, invalid values, and unsupported host pairs", () => {
    expect(() => validateMobileDeviceEvidence({ ...androidEvidence(), schemaVersion: 2 })).toThrow(
      "schemaVersion",
    );
    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), artifactSha256: "not-a-hash" }),
    ).toThrow("artifactSha256");
    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), artifactSha256: "A".repeat(64) }),
    ).toThrow("artifactSha256");
    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), terminalInput: "maybe" }),
    ).toThrow("terminalInput");
    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), playbackBegan: "yes" }),
    ).toThrow("playbackBegan");
    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), recordedAt: "yesterday" }),
    ).toThrow("recordedAt");
    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), terminal: "a-shell-mini" }),
    ).toThrow("platform/terminal");
    expect(() =>
      validateMobileDeviceEvidence({
        ...androidEvidence(),
        platform: "ios",
        terminal: "a-shell-mini",
        architecture: "x64",
      }),
    ).toThrow("iOS physical evidence");
  });

  test("fails closed on any failed observation and formats only a redacted matrix row", () => {
    const passed = validateMobileDeviceEvidence(androidEvidence());
    const failed = validateMobileDeviceEvidence(androidEvidence({ playbackBegan: false }));

    expect(mobileDeviceEvidencePassed(passed)).toBe(true);
    expect(mobileDeviceEvidencePassed(failed)).toBe(false);

    const row = formatMobileDeviceEvidenceRow(passed);
    expect(row).toContain("android | 15 | termux | arm64 | vlc");
    expect(row).toContain("playback=passed");
    expect(row).toContain(SHA256.slice(0, 12));
    expect(row).not.toContain(SHA256);
    expect(row).not.toContain("http://");
    expect(row).not.toContain("https://");
  });
});
