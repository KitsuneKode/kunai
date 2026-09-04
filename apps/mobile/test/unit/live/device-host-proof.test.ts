import { describe, expect, test } from "bun:test";

import type { MobileBuildMetadata } from "../../../scripts/build-contract";
import {
  formatMobileDeviceEvidenceRow,
  mobileDeviceEvidencePassed,
  validateMobileDeviceEvidence,
  validateMobileEvidenceMatrix,
  type MobileDeviceEvidence,
} from "../../live/device-host-proof";

const SHA256 = "a".repeat(64);
const IOS_SHA256 = "b".repeat(64);

const BUILD_METADATA: MobileBuildMetadata = {
  schemaVersion: 2,
  version: "0.3.0",
  targets: [
    {
      id: "android-termux-node",
      runtime: "android",
      output: "android/kunai-mobile-android.mjs",
    },
    { id: "ios-ashell", runtime: "ashell", output: "ios/kunai-mobile-ios.js" },
  ],
  artifacts: [],
  artifactSets: [
    {
      target: "android-termux-node",
      artifacts: ["android/kunai-mobile-android.mjs"],
      sha256: SHA256,
    },
    {
      target: "ios-ashell",
      artifacts: ["ios/kunai-mobile", "ios/kunai-mobile-ios.js"],
      sha256: IOS_SHA256,
    },
  ],
};

function androidEvidence(overrides: Partial<MobileDeviceEvidence> = {}): MobileDeviceEvidence {
  return {
    schemaVersion: 2,
    kunaiVersion: "0.3.0",
    platform: "android",
    osVersion: "15",
    terminal: "termux",
    terminalVersion: "0.119.0-beta.3",
    architecture: "arm64",
    player: "vlc",
    playerVersion: "3.7.0",
    deviceClass: "physical",
    artifactTarget: "android-termux-node",
    artifactSetSha256: SHA256,
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

function iosEvidence(overrides: Partial<MobileDeviceEvidence> = {}): MobileDeviceEvidence {
  return androidEvidence({
    platform: "ios",
    osVersion: "19.6.2",
    terminal: "a-shell-mini",
    terminalVersion: "1.15.11",
    artifactTarget: "ios-ashell",
    artifactSetSha256: IOS_SHA256,
    ...overrides,
  });
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
          artifactTarget: "ios-ashell",
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
    expect(() => validateMobileDeviceEvidence({ ...androidEvidence(), schemaVersion: 3 })).toThrow(
      "schemaVersion",
    );
    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), artifactSetSha256: "not-a-hash" }),
    ).toThrow("artifactSetSha256");
    expect(() =>
      validateMobileDeviceEvidence({ ...androidEvidence(), artifactSetSha256: "A".repeat(64) }),
    ).toThrow("artifactSetSha256");
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
      validateMobileDeviceEvidence({ ...androidEvidence(), deviceClass: "emulator" }),
    ).toThrow("deviceClass");
    expect(() =>
      validateMobileDeviceEvidence({
        ...androidEvidence(),
        platform: "ios",
        terminal: "a-shell-mini",
        architecture: "x64",
        artifactTarget: "ios-ashell",
      }),
    ).toThrow("iOS physical evidence");
  });

  test("fails closed on any failed observation and formats only a redacted matrix row", () => {
    const passed = validateMobileDeviceEvidence(androidEvidence());
    const failed = validateMobileDeviceEvidence(androidEvidence({ playbackBegan: false }));

    expect(mobileDeviceEvidencePassed(passed)).toBe(true);
    expect(mobileDeviceEvidencePassed(failed)).toBe(false);

    const row = formatMobileDeviceEvidenceRow(passed);
    expect(row).toContain("android | 15 | termux 0.119.0-beta.3 | arm64 | vlc 3.7.0");
    expect(row).toContain("target=android-termux-node");
    expect(row).toContain("playback=passed");
    expect(row).toContain(SHA256.slice(0, 12));
    expect(row).not.toContain(SHA256);
    expect(row).not.toContain("http://");
    expect(row).not.toContain("https://");
  });

  test("accepts exactly one passing physical ARM64 row per platform bound to metadata", () => {
    expect(
      validateMobileEvidenceMatrix(BUILD_METADATA, [iosEvidence(), androidEvidence()]),
    ).toEqual([androidEvidence(), iosEvidence()]);
  });

  test("rejects incomplete, duplicate, failing, stale, and unbound qualification matrices", () => {
    expect(() => validateMobileEvidenceMatrix(BUILD_METADATA, [androidEvidence()])).toThrow(
      "exactly one Android and one iOS",
    );
    expect(() =>
      validateMobileEvidenceMatrix(BUILD_METADATA, [androidEvidence(), androidEvidence()]),
    ).toThrow("exactly one Android and one iOS");
    expect(() =>
      validateMobileEvidenceMatrix(BUILD_METADATA, [
        androidEvidence({ playbackBegan: false }),
        iosEvidence(),
      ]),
    ).toThrow("did not pass");
    expect(() =>
      validateMobileEvidenceMatrix(BUILD_METADATA, [
        androidEvidence({ architecture: "x64" }),
        iosEvidence(),
      ]),
    ).toThrow("physical Android ARM64");
    expect(() =>
      validateMobileEvidenceMatrix(BUILD_METADATA, [
        androidEvidence({ kunaiVersion: "0.2.0" }),
        iosEvidence(),
      ]),
    ).toThrow("Kunai version");
    expect(() =>
      validateMobileEvidenceMatrix(BUILD_METADATA, [
        androidEvidence({ artifactSetSha256: "c".repeat(64) }),
        iosEvidence(),
      ]),
    ).toThrow("artifact set");
  });
});
