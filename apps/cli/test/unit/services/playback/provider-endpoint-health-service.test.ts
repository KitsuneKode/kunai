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

  test("server-error quarantines only after two distinct titles", () => {
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
});
