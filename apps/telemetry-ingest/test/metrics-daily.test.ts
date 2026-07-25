import { describe, expect, test } from "bun:test";

import { PUBLIC_METRICS_CACHE_CONTROL } from "../src/snapshot";

describe("public metrics cache policy", () => {
  test("serves stale content for a day while revalidating", () => {
    expect(PUBLIC_METRICS_CACHE_CONTROL).toBe(
      "public, s-maxage=3600, max-age=300, stale-while-revalidate=86400",
    );
  });

  test("stale window is not shorter than the shared cache window", () => {
    const read = (directive: string): number => {
      const match = new RegExp(`${directive}=(\\d+)`).exec(PUBLIC_METRICS_CACHE_CONTROL);
      if (!match?.[1]) throw new Error(`missing directive: ${directive}`);
      return Number(match[1]);
    };
    expect(read("stale-while-revalidate")).toBeGreaterThanOrEqual(read("s-maxage"));
  });
});
