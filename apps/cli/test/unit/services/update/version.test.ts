import { describe, expect, test } from "bun:test";

import {
  compareCanonicalVersions,
  normalizeRequestedVersion,
  parseCanonicalVersion,
  parsePublishedVersionTag,
  type CanonicalVersion,
} from "@/services/update/version";

describe("parseCanonicalVersion", () => {
  test.each(["0.3.0", "1.0.0", "10.20.300"])("accepts %s", (value) => {
    expect(parseCanonicalVersion(value)).toBe(value);
  });

  test.each(["01.2.3", "1.2.3-beta", "1.2.3+build", "../1.2.3", "1.2"])("rejects %s", (value) =>
    expect(parseCanonicalVersion(value)).toBeNull(),
  );
});

describe("normalizeRequestedVersion", () => {
  test("strips a leading v", () => {
    expect(normalizeRequestedVersion("v1.2.3")).toBe("1.2.3");
    expect(normalizeRequestedVersion("V0.3.0")).toBe("0.3.0");
  });

  test("rejects prerelease and path-like input", () => {
    expect(normalizeRequestedVersion("v1.2.3-beta")).toBeNull();
    expect(normalizeRequestedVersion("../1.2.3")).toBeNull();
  });
});

describe("parsePublishedVersionTag", () => {
  test("extracts strict versions from release tags", () => {
    expect(parsePublishedVersionTag("v1.2.3")).toBe("1.2.3");
    expect(parsePublishedVersionTag("@kitsunekode/kunai@0.3.0")).toBe("0.3.0");
    expect(parsePublishedVersionTag("kunai-0.4.1")).toBe("0.4.1");
  });

  test("rejects undefined, non-version, and non-strict tags", () => {
    expect(parsePublishedVersionTag(undefined)).toBeNull();
    expect(parsePublishedVersionTag("nightly")).toBeNull();
    expect(parsePublishedVersionTag("v01.2.3")).toBeNull();
    expect(parsePublishedVersionTag("v1.2.3-beta")).toBeNull();
  });
});

describe("compareCanonicalVersions", () => {
  test("orders major.minor.patch", () => {
    const a = parseCanonicalVersion("1.2.3") as CanonicalVersion;
    const b = parseCanonicalVersion("1.2.4") as CanonicalVersion;
    const c = parseCanonicalVersion("2.0.0") as CanonicalVersion;
    expect(compareCanonicalVersions(a, a)).toBe(0);
    expect(compareCanonicalVersions(a, b)).toBeLessThan(0);
    expect(compareCanonicalVersions(b, a)).toBeGreaterThan(0);
    expect(compareCanonicalVersions(c, a)).toBeGreaterThan(0);
  });
});
