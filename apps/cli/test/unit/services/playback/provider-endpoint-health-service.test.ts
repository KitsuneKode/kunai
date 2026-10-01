import { describe, expect, test } from "bun:test";

import { ProviderEndpointHealthService } from "@/services/playback/ProviderEndpointHealthService";
import type { ProviderEndpointHealthRecord } from "@kunai/types";

class MemoryEndpointHealthRepo {
  readonly rows = new Map<string, ProviderEndpointHealthRecord>();

  private key(providerId: string, endpoint: string): string {
    return `${providerId}:${endpoint}`;
  }

  get(providerId: string, endpoint: string): ProviderEndpointHealthRecord | undefined {
    return this.rows.get(this.key(providerId, endpoint));
  }

  set(record: ProviderEndpointHealthRecord): void {
    this.rows.set(this.key(record.providerId, record.endpoint), record);
  }

  isQuarantined(providerId: string, endpoint: string, nowIso: string): boolean {
    const record = this.get(providerId, endpoint);
    if (!record?.quarantinedUntil) return false;
    return Date.parse(record.quarantinedUntil) > Date.parse(nowIso);
  }

  delete(providerId: string, endpoint: string): number {
    return this.rows.delete(this.key(providerId, endpoint)) ? 1 : 0;
  }

  deleteByProvider(providerId: string): number {
    let cleared = 0;
    for (const key of this.rows.keys()) {
      if (key.startsWith(`${providerId}:`)) {
        this.rows.delete(key);
        cleared += 1;
      }
    }
    return cleared;
  }

  clearAll(): number {
    const cleared = this.rows.size;
    this.rows.clear();
    return cleared;
  }

  list(): ProviderEndpointHealthRecord[] {
    return [...this.rows.values()];
  }
}

describe("ProviderEndpointHealthService", () => {
  test("curated route-dead seed blocks endpoint until quarantine expires", () => {
    const repo = new MemoryEndpointHealthRepo();
    const now = new Date("2026-06-23T12:00:00.000Z");
    const service = new ProviderEndpointHealthService(repo, () => now, [
      { providerId: "videasy", endpoint: "1movies", failureClass: "route-dead" },
    ]);

    expect(service.shouldTry("videasy", "1movies")).toBe(false);
    expect(service.shouldTry("videasy", "mb-flix")).toBe(true);
  });

  test("server-error on a second distinct title quarantines before the streak rule", () => {
    const repo = new MemoryEndpointHealthRepo();
    let now = new Date("2026-06-23T12:00:00.000Z");
    const service = new ProviderEndpointHealthService(repo, () => now);

    service.recordFailure("videasy", "broken", {
      class: "server-error",
      titleId: "tmdb:1",
      at: now.toISOString(),
    });
    expect(service.shouldTry("videasy", "broken")).toBe(true);

    now = new Date("2026-06-23T12:05:00.000Z");
    service.recordFailure("videasy", "broken", {
      class: "server-error",
      titleId: "tmdb:2",
      at: now.toISOString(),
    });
    expect(service.shouldTry("videasy", "broken")).toBe(false);
  });

  test("transient failures use in-memory cooldown only", () => {
    const repo = new MemoryEndpointHealthRepo();
    const service = new ProviderEndpointHealthService(repo);

    service.recordFailure("videasy", "slow", {
      class: "transient",
      at: new Date().toISOString(),
    });
    service.recordFailure("videasy", "slow", {
      class: "transient",
      at: new Date().toISOString(),
    });

    expect(service.shouldTry("videasy", "slow")).toBe(false);
    expect(repo.get("videasy", "slow")).toBeUndefined();
  });

  test("recordSuccess clears persisted quarantine", () => {
    const repo = new MemoryEndpointHealthRepo();
    const service = new ProviderEndpointHealthService(repo);

    service.recordFailure("videasy", "broken", {
      class: "route-dead",
      at: new Date().toISOString(),
    });
    expect(service.shouldTry("videasy", "broken")).toBe(false);

    service.recordSuccess("videasy", "broken");
    expect(service.shouldTry("videasy", "broken")).toBe(true);
  });

  test("deleteByProvider lifts one provider without touching the other", () => {
    const repo = new MemoryEndpointHealthRepo();
    const service = new ProviderEndpointHealthService(repo);

    for (const [providerId, endpoint] of [
      ["videasy", "broken"],
      ["rivestream", "primevids"],
    ] as const) {
      service.recordFailure(providerId, endpoint, {
        class: "route-dead",
        at: new Date().toISOString(),
      });
    }
    expect(service.shouldTry("videasy", "broken")).toBe(false);

    expect(service.deleteByProvider("videasy")).toBe(1);
    expect(service.shouldTry("videasy", "broken")).toBe(true);
    expect(service.shouldTry("rivestream", "primevids")).toBe(false);
  });

  test("deleteByProvider clears sub-threshold transient failure counts", () => {
    const repo = new MemoryEndpointHealthRepo();
    const service = new ProviderEndpointHealthService(repo);

    // 1 transient failure (below threshold 2, so no cooldown yet)
    service.recordFailure("videasy", "slow", {
      class: "transient",
      at: new Date().toISOString(),
    });
    expect(service.shouldTry("videasy", "slow")).toBe(true);

    // Resetting videasy must forget that single count
    expect(service.deleteByProvider("videasy")).toBe(0);

    // The next single transient failure should NOT trigger cooldown because count was reset
    service.recordFailure("videasy", "slow", {
      class: "transient",
      at: new Date().toISOString(),
    });
    expect(service.shouldTry("videasy", "slow")).toBe(true);
  });

  test("clearTitle lifts only rows the title contributed to", () => {
    const repo = new MemoryEndpointHealthRepo();
    const now = new Date("2026-06-23T12:00:00.000Z");
    const service = new ProviderEndpointHealthService(repo, () => now);

    service.recordFailure("videasy", "with-title", {
      class: "route-dead",
      titleId: "tmdb:1",
      at: now.toISOString(),
    });
    service.recordFailure("videasy", "without-title", {
      class: "route-dead",
      at: now.toISOString(),
    });

    expect(service.clearTitle("tmdb:1")).toBe(1);
    expect(service.shouldTry("videasy", "with-title")).toBe(true);
    // No title evidence: a per-show reset must not lift it.
    expect(service.shouldTry("videasy", "without-title")).toBe(false);
  });

  test("clearAll lifts every quarantine including transient cooldowns", () => {
    const repo = new MemoryEndpointHealthRepo();
    const service = new ProviderEndpointHealthService(repo);

    service.recordFailure("videasy", "broken", {
      class: "route-dead",
      at: new Date().toISOString(),
    });
    service.recordFailure("videasy", "slow", { class: "transient", at: new Date().toISOString() });
    service.recordFailure("videasy", "slow", { class: "transient", at: new Date().toISOString() });
    expect(service.shouldTry("videasy", "slow")).toBe(false);

    expect(service.clearAll()).toBe(1);
    expect(service.shouldTry("videasy", "broken")).toBe(true);
    expect(service.shouldTry("videasy", "slow")).toBe(true);
  });
});

describe("endpoint quarantine under single-title viewing", () => {
  const NOW = new Date("2026-07-28T12:00:00.000Z");

  test("repeated failures on one title eventually quarantine", () => {
    const repo = new MemoryEndpointHealthRepo();
    const service = new ProviderEndpointHealthService(repo, () => NOW);

    for (let i = 0; i < 3; i++) {
      service.recordFailure("videasy", "wings-meine", {
        class: "server-error",
        titleId: "125988",
        at: NOW.toISOString(),
      });
    }

    const record = repo.get("videasy", "wings-meine");
    expect(record?.consecutiveFailures).toBe(3);
    expect(record?.distinctTitleIds).toEqual(["125988"]);
    // Normal viewing stays on one title, so this is the case that never fired
    // before and left every videasy endpoint row unquarantined.
    expect(record?.quarantinedUntil).toBeTruthy();
    expect(service.shouldTry("videasy", "wings-meine")).toBe(false);
  });

  test("one failure on one title does not quarantine", () => {
    const repo = new MemoryEndpointHealthRepo();
    const service = new ProviderEndpointHealthService(repo, () => NOW);

    service.recordFailure("videasy", "wings-cdn", {
      class: "server-error",
      titleId: "69740",
      at: NOW.toISOString(),
    });

    expect(repo.get("videasy", "wings-cdn")?.quarantinedUntil).toBeUndefined();
    expect(service.shouldTry("videasy", "wings-cdn")).toBe(true);
  });

  test("a success between failures resets the streak", () => {
    const repo = new MemoryEndpointHealthRepo();
    const service = new ProviderEndpointHealthService(repo, () => NOW);
    const fail = () =>
      service.recordFailure("videasy", "flaky", {
        class: "server-error",
        titleId: "125988",
        at: NOW.toISOString(),
      });

    fail();
    fail();
    service.recordSuccess("videasy", "flaky");
    fail();
    fail();

    // Two failures since the last success is not yet sustained evidence.
    expect(repo.get("videasy", "flaky")?.quarantinedUntil).toBeUndefined();
  });

  test("transient failures never persist a quarantine", () => {
    const repo = new MemoryEndpointHealthRepo();
    const service = new ProviderEndpointHealthService(repo, () => NOW);

    for (let i = 0; i < 5; i++) {
      service.recordFailure("videasy", "cdn", {
        class: "transient",
        titleId: "x",
        at: NOW.toISOString(),
      });
    }

    expect(repo.get("videasy", "cdn")).toBeUndefined();
  });

  test("a Retry-After hint on a transient failure parks the endpoint at once", () => {
    const repo = new MemoryEndpointHealthRepo();
    let now = NOW;
    const service = new ProviderEndpointHealthService(repo, () => now);

    // One transient record would normally not cool anything — the upstream's
    // explicit window is worth more than the local strike count.
    service.recordFailure("videasy", "cdn", {
      class: "transient",
      titleId: "x",
      at: NOW.toISOString(),
      retryAfterMs: 120_000,
    });

    expect(service.shouldTry("videasy", "cdn")).toBe(false);

    // The hint outlasts the default 60s transient cooldown.
    now = new Date(NOW.getTime() + 61_000);
    expect(service.shouldTry("videasy", "cdn")).toBe(false);

    now = new Date(NOW.getTime() + 120_000);
    expect(service.shouldTry("videasy", "cdn")).toBe(true);
  });

  test("a short hint never shrinks the default transient cooldown", () => {
    const repo = new MemoryEndpointHealthRepo();
    let now = NOW;
    const service = new ProviderEndpointHealthService(repo, () => now);

    service.recordFailure("videasy", "cdn", {
      class: "transient",
      titleId: "x",
      at: NOW.toISOString(),
      retryAfterMs: 5_000,
    });

    now = new Date(NOW.getTime() + 5_000);
    expect(service.shouldTry("videasy", "cdn")).toBe(false);
    now = new Date(NOW.getTime() + 60_000);
    expect(service.shouldTry("videasy", "cdn")).toBe(true);
  });

  test("a sub-threshold server-error with a hint parks in memory, not the row", () => {
    const repo = new MemoryEndpointHealthRepo();
    let now = NOW;
    const service = new ProviderEndpointHealthService(repo, () => now);

    // One title's server-error earns no quarantine — but the upstream's own
    // hint still parks the endpoint for the hinted window.
    service.recordFailure("videasy", "flaky", {
      class: "server-error",
      titleId: "125988",
      at: NOW.toISOString(),
      retryAfterMs: 90_000,
    });

    expect(repo.get("videasy", "flaky")?.quarantinedUntil).toBeUndefined();
    expect(service.shouldTry("videasy", "flaky")).toBe(false);

    now = new Date(NOW.getTime() + 90_000);
    expect(service.shouldTry("videasy", "flaky")).toBe(true);
  });

  test("an earned quarantine takes the max of its window and the hint", () => {
    const repo = new MemoryEndpointHealthRepo();
    const service = new ProviderEndpointHealthService(repo, () => NOW);

    // Route-dead quarantines for 24h — a 2h hint must not shorten it.
    service.recordFailure("videasy", "dead-route", {
      class: "route-dead",
      titleId: "x",
      at: NOW.toISOString(),
      retryAfterMs: 2 * 60 * 60 * 1000,
    });
    const until = repo.get("videasy", "dead-route")?.quarantinedUntil;
    expect(Date.parse(until ?? "")).toBeGreaterThan(NOW.getTime() + 23 * 60 * 60 * 1000);
  });

  test("a hint longer than the earned quarantine extends it", () => {
    const repo = new MemoryEndpointHealthRepo();
    const service = new ProviderEndpointHealthService(repo, () => NOW);

    // Two distinct titles quarantine for 1h; a 3h hint is the longer window.
    service.recordFailure("videasy", "limited", {
      class: "server-error",
      titleId: "a",
      at: NOW.toISOString(),
    });
    service.recordFailure("videasy", "limited", {
      class: "server-error",
      titleId: "b",
      at: NOW.toISOString(),
      retryAfterMs: 3 * 60 * 60 * 1000,
    });
    const until = repo.get("videasy", "limited")?.quarantinedUntil;
    expect(Date.parse(until ?? "")).toBe(NOW.getTime() + 3 * 60 * 60 * 1000);
  });
});
