/**
 * The published `lifetimeInstalls` is cumulative observations, not a
 * unique-install count — the product decision behind R07.3. Retiring a
 * long-silent install folds it into `lifetime_retired` and discards its
 * identity; one that returns writes a fresh `install_lifetime` row and counts
 * a second time. These tests pin that definition so it is chosen, not merely
 * observed.
 */

import { describe, expect, test } from "bun:test";

import { createMemoryAnalyticsStore } from "../src/memory-store";
import type { RecordPingInput } from "../src/store";

const ping = (installHash: string, day: string): RecordPingInput => ({
  day,
  installHash,
  version: "0.4.0",
  os: "linux",
  arch: "x64",
});

describe("lifetimeInstalls is cumulative observations", () => {
  test("a return after retirement counts the install again", async () => {
    const store = createMemoryAnalyticsStore();

    await store.recordPing(ping("aa".repeat(32), "2026-09-20"));
    expect((await store.rollUpDay("2026-09-20")).lifetimeInstalls).toBe(1);

    // 400+ days silent: the row folds into the retired counter.
    expect((await store.pruneLifetimeBefore("2027-11-01")).retired).toBe(1);
    expect(store.lifetimeCount()).toBe(0);

    // The return writes a fresh row while the retired count still stands.
    await store.recordPing(ping("aa".repeat(32), "2027-11-02"));
    expect(store.lifetimeCount()).toBe(1);
    expect((await store.rollUpDay("2027-11-02")).lifetimeInstalls).toBe(2);
  });

  test("two retire-and-return cycles compound the same way", async () => {
    const store = createMemoryAnalyticsStore();
    const hash = "bb".repeat(32);

    await store.recordPing(ping(hash, "2026-09-20"));
    await store.pruneLifetimeBefore("2027-11-01");
    await store.recordPing(ping(hash, "2027-11-02"));
    await store.pruneLifetimeBefore("2028-12-15");
    await store.recordPing(ping(hash, "2028-12-16"));

    // One install, observed three times across two retirements.
    expect((await store.rollUpDay("2028-12-16")).lifetimeInstalls).toBe(3);
  });

  test("a recomputed day still prices a retired install at one", async () => {
    const store = createMemoryAnalyticsStore();
    const hash = "cc".repeat(32);

    await store.recordPing(ping(hash, "2026-09-20"));
    await store.pruneLifetimeBefore("2027-11-01");
    await store.recordPing(ping(hash, "2027-11-02"));

    // Re-rolling the original day after the return: the returnee's live row
    // first-seen is newer than the day, so only the retired counter applies.
    // The install was observed exactly once by then — history stays truthful.
    expect((await store.rollUpDay("2026-09-20")).lifetimeInstalls).toBe(1);
  });

  test("a retiring install that never returns keeps the total flat", async () => {
    const store = createMemoryAnalyticsStore();

    await store.recordPing(ping("dd".repeat(32), "2026-09-20"));
    await store.recordPing(ping("ee".repeat(32), "2026-09-20"));
    await store.pruneLifetimeBefore("2027-11-01");

    expect((await store.rollUpDay("2027-11-03")).lifetimeInstalls).toBe(2);
  });
});
