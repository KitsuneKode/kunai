import { describe, expect, test } from "bun:test";

import { seriesKey } from "../components/analytics/version-adoption";

/**
 * `ChartStyle` emits one `--color-<key>` custom property per config key, and a
 * custom-property name is a CSS identifier. A raw version string like `0.3.0`
 * produces `--color-0.3.0`, which the parser rejects — the declaration is
 * dropped and the band renders unpainted with no error anywhere. These lock the
 * sanitiser that stops that happening.
 */
describe("seriesKey", () => {
  test("produces a valid CSS identifier for a semver bucket", () => {
    expect(seriesKey("0.3.0")).toBe("v0_3_0");
    // A custom property name may not start with a digit and may not contain a dot.
    expect(seriesKey("0.3.0")).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
  });

  test("survives prerelease and build metadata", () => {
    for (const version of ["1.0.0-rc.1", "0.3.0+build.5", "2.0.0-beta"]) {
      expect(seriesKey(version)).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
    }
  });

  test("keeps the residual bucket addressable", () => {
    expect(seriesKey("other")).toBe("vother");
  });

  test("distinct versions never collide on one key", () => {
    // A sloppy sanitiser that stripped separators would map both to "v030".
    expect(seriesKey("0.3.0")).not.toBe(seriesKey("03.0"));
  });
});
