import { describe, expect, test } from "bun:test";

import { isAcceptedInstallId, parseAnalyticsPayload } from "../src/ingest";
import {
  ALLOWED_ARCH,
  ALLOWED_OS,
  isAllowedArch,
  isAllowedOs,
  isValidVersion,
} from "../src/payload-validation";

describe("version validation", () => {
  test("accepts plain semver", () => {
    expect(isValidVersion("0.3.0")).toBe(true);
    expect(isValidVersion("1.0.0")).toBe(true);
    expect(isValidVersion("10.20.30")).toBe(true);
  });

  test("accepts prerelease and build metadata", () => {
    expect(isValidVersion("0.4.0-beta.1")).toBe(true);
    expect(isValidVersion("0.4.0-rc.1+build.5")).toBe(true);
  });

  test("rejects non-semver pollution", () => {
    expect(isValidVersion("")).toBe(false);
    expect(isValidVersion("v0.3.0")).toBe(false);
    expect(isValidVersion("0.3")).toBe(false);
    expect(isValidVersion("latest")).toBe(false);
    expect(isValidVersion("0.3.0; DROP TABLE")).toBe(false);
    expect(isValidVersion("<script>alert(1)</script>")).toBe(false);
    expect(isValidVersion("01.3.0")).toBe(false);
  });

  test("rejects oversized input without catastrophic backtracking", () => {
    const started = Date.now();
    expect(isValidVersion(`${"9".repeat(5000)}.0.0`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
  });
});

describe("os and arch allowlists", () => {
  test("accepts every documented platform", () => {
    for (const os of ALLOWED_OS) expect(isAllowedOs(os)).toBe(true);
    for (const arch of ALLOWED_ARCH) expect(isAllowedArch(arch)).toBe(true);
  });

  test("covers the platforms Kunai actually ships to", () => {
    expect(isAllowedOs("linux")).toBe(true);
    expect(isAllowedOs("darwin")).toBe(true);
    expect(isAllowedOs("win32")).toBe(true);
    expect(isAllowedArch("x64")).toBe(true);
    expect(isAllowedArch("arm64")).toBe(true);
  });

  test("rejects unknown or spoofed values", () => {
    expect(isAllowedOs("")).toBe(false);
    expect(isAllowedOs("Linux")).toBe(false);
    expect(isAllowedOs("beos")).toBe(false);
    expect(isAllowedArch("")).toBe(false);
    expect(isAllowedArch("X64")).toBe(false);
    expect(isAllowedArch("sparc")).toBe(false);
  });
});

/**
 * Clients from 0.3.0 on send `sha256(installId)`; every published binary older
 * than that sends the raw UUID and can never be changed. Both have to be
 * accepted for as long as those installs ping.
 */
describe("accepted install id shapes", () => {
  const UUID = "11111111-2222-4333-8444-555555555555";
  const DIGEST = "a".repeat(64);

  test("accepts a UUID from a pre-0.3.0 install", () => {
    expect(isAcceptedInstallId(UUID)).toBe(true);
  });

  test("accepts a 64-hex client-side digest", () => {
    expect(isAcceptedInstallId(DIGEST)).toBe(true);
    expect(isAcceptedInstallId(DIGEST.toUpperCase())).toBe(true);
  });

  test("still rejects anything that is neither", () => {
    expect(isAcceptedInstallId("")).toBe(false);
    expect(isAcceptedInstallId("kitsunekode")).toBe(false);
    // A hostname, a MAC, or a truncated/overlong hash are all identity leaks.
    expect(isAcceptedInstallId("a1:b2:c3:d4:e5:f6")).toBe(false);
    expect(isAcceptedInstallId("a".repeat(63))).toBe(false);
    expect(isAcceptedInstallId("a".repeat(65))).toBe(false);
    expect(isAcceptedInstallId(`${"a".repeat(63)}z`)).toBe(false);
  });

  test("a full payload carrying a digest parses", () => {
    expect(
      parseAnalyticsPayload({
        installId: DIGEST,
        version: "0.3.0",
        os: "linux",
        arch: "x64",
        ts: 1,
      }),
    ).not.toBeNull();
  });
});
