import { describe, expect, test } from "bun:test";

import {
  CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS,
  crossProviderInventoryStaleAfterMs,
  formatCrossProviderCachedInventoryDetail,
} from "@/app-shell/tracks-panel-data";

describe("crossProviderInventoryStaleAfterMs", () => {
  const nowMs = Date.parse("2026-07-09T12:00:00.000Z");

  test("defaults to the 2-minute floor without expiresAt", () => {
    expect(crossProviderInventoryStaleAfterMs(undefined, nowMs)).toBe(
      CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS,
    );
    expect(crossProviderInventoryStaleAfterMs("not-a-date", nowMs)).toBe(
      CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS,
    );
  });

  test("uses half remaining TTL when longer than the floor", () => {
    const expiresAt = new Date(nowMs + 20 * 60_000).toISOString();
    expect(crossProviderInventoryStaleAfterMs(expiresAt, nowMs)).toBe(10 * 60_000);
  });

  test("floors short remaining TTL to the 2-minute minimum", () => {
    const expiresAt = new Date(nowMs + 3 * 60_000).toISOString();
    expect(crossProviderInventoryStaleAfterMs(expiresAt, nowMs)).toBe(
      CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS,
    );
  });
});

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

  test("keeps longer-TTL inventory fresh past the default 2-minute floor", () => {
    const createdAt = new Date(nowMs - 5 * 60_000).toISOString();
    const expiresAt = new Date(nowMs + 15 * 60_000).toISOString();
    // Remaining TTL 15m → half = 7.5m; age 5m is still fresh.
    expect(formatCrossProviderCachedInventoryDetail("Miruro", createdAt, nowMs, expiresAt)).toBe(
      "Miruro · cached 5m ago",
    );
    expect(
      formatCrossProviderCachedInventoryDetail(
        "Miruro",
        new Date(nowMs - 8 * 60_000).toISOString(),
        nowMs,
        expiresAt,
      ),
    ).toBe("Miruro · stale inventory · 8m ago");
  });
});
