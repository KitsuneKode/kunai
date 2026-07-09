import { describe, expect, test } from "bun:test";

import {
  CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS,
  formatCrossProviderCachedInventoryDetail,
} from "@/app-shell/tracks-panel-data";

describe("formatCrossProviderCachedInventoryDetail", () => {
  const nowMs = Date.parse("2026-07-09T12:00:00.000Z");

  test("keeps bare cached when validation age is unknown", () => {
    expect(formatCrossProviderCachedInventoryDetail("Miruro", undefined, nowMs)).toBe(
      "Miruro · cached",
    );
  });

  test("shows validation age for fresh inventory", () => {
    expect(
      formatCrossProviderCachedInventoryDetail(
        "Miruro",
        new Date(nowMs - 30_000).toISOString(),
        nowMs,
      ),
    ).toBe("Miruro · cached just now");
    expect(
      formatCrossProviderCachedInventoryDetail(
        "Miruro",
        new Date(nowMs - 90_000).toISOString(),
        nowMs,
      ),
    ).toBe("Miruro · cached 1m ago");
  });

  test("labels aged inventory as stale instead of bare cached", () => {
    expect(
      formatCrossProviderCachedInventoryDetail(
        "AllManga",
        new Date(nowMs - CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS).toISOString(),
        nowMs,
      ),
    ).toBe("AllManga · stale inventory · 2m ago");
    expect(
      formatCrossProviderCachedInventoryDetail(
        "AllManga",
        new Date(nowMs - 3 * 60 * 60 * 1000).toISOString(),
        nowMs,
      ),
    ).toBe("AllManga · stale inventory · 3h ago");
  });
});
