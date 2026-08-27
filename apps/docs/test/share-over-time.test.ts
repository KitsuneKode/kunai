import { describe, expect, test } from "bun:test";

import { seriesKey } from "../components/analytics/share-over-time";

/**
 * `ChartStyle` emits one `--color-<key>` custom property per config key, and a
 * custom-property name is a CSS identifier. A raw version string like `0.3.0`
 * produces `--color-0.3.0`, which the parser rejects — the declaration is
 * dropped and the band renders unpainted with no error anywhere. These lock the
 * sanitiser that stops that happening.
 */
describe("seriesKey", () => {
  test("produces a valid CSS identifier for a semver bucket", () => {
    // Each non-alphanumeric is encoded as its code point, so "." becomes _2e_.
    expect(seriesKey("0.3.0")).toBe("v0_2e_3_2e_0");
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

  test("is injective — distinct buckets never share a key", () => {
    // The previous encoding collapsed every separator to "_", so `1.0.0-alpha`
    // and `1.0.0+alpha` produced the same key. Two buckets sharing a key
    // overwrite each other in chartConfig and in every data row, and the chart
    // silently drops part of the reported share. These are the pairs that
    // actually collided, plus a literal underscore, which must not alias a
    // separator it encodes to.
    const buckets = [
      "1.0.0-alpha",
      "1.0.0+alpha",
      "0.3.0",
      "0-3-0",
      "1.0.0-rc.1",
      "1.0.0.rc-1",
      "a_b",
      "a.b",
      "other",
    ];
    const keys = buckets.map(seriesKey);
    expect(new Set(keys).size).toBe(buckets.length);
  });

  test("every key stays a valid CSS identifier after encoding", () => {
    for (const bucket of ["1.0.0-alpha", "1.0.0+alpha", "a_b", "0.3.0", "x86_64"]) {
      expect(seriesKey(bucket)).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
    }
  });
});
