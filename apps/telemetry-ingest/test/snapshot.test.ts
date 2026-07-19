import { describe, expect, test } from "bun:test";

import { createMemoryDailyDistinctStore, createMemoryLifetimeStore } from "../src/ingest";
import {
  buildPublicMetricsSnapshot,
  collectPublicMetrics,
  parsePublicMetricsSnapshot,
  snapshotDayKey,
} from "../src/snapshot";

describe("public metrics snapshot", () => {
  test("schema rejects extra identity fields and wrong version", () => {
    const good = buildPublicMetricsSnapshot({
      day: "2026-07-19",
      activeInstalls: 12,
      lifetimeInstallsApprox: 100,
      updatedAt: "2026-07-20T00:05:00.000Z",
    });
    expect(parsePublicMetricsSnapshot(good)).toEqual(good);
    expect(
      parsePublicMetricsSnapshot({
        ...good,
        installIds: ["nope"],
      }),
    ).toBeNull();
    expect(parsePublicMetricsSnapshot({ ...good, schemaVersion: 99 })).toBeNull();
  });

  test("collectPublicMetrics uses yesterday's day count + lifetime approx", async () => {
    const daily = createMemoryDailyDistinctStore();
    const lifetime = createMemoryLifetimeStore();
    const now = Date.UTC(2026, 6, 20, 12, 0, 0);
    const yesterday = snapshotDayKey(now);
    expect(yesterday).toBe("2026-07-19");

    daily.record(yesterday, "hash-a");
    daily.record(yesterday, "hash-b");
    lifetime.add("hash-a");
    lifetime.add("hash-b");
    lifetime.add("hash-c");

    const metrics = await collectPublicMetrics({ daily, lifetime, now });
    expect(metrics).toMatchObject({
      schemaVersion: 1,
      day: "2026-07-19",
      activeInstalls: 2,
      lifetimeInstallsApprox: 3,
      lifetimeMethod: "hyperloglog",
    });
    expect(JSON.stringify(metrics)).not.toContain("hash-");
  });
});
