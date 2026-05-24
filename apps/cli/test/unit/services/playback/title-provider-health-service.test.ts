import { describe, expect, test } from "bun:test";

import { TitleProviderHealthService } from "@/services/playback/TitleProviderHealthService";
import type { TitleProviderHealthRecord } from "@kunai/storage";

class MemoryRepo {
  readonly rows = new Map<string, TitleProviderHealthRecord>();
  get(titleId: string, providerId: string): TitleProviderHealthRecord | undefined {
    return this.rows.get(`${titleId}:${providerId}`);
  }
  set(record: TitleProviderHealthRecord): void {
    this.rows.set(`${record.titleId}:${record.providerId}`, record);
  }
  delete(titleId: string, providerId: string): void {
    this.rows.delete(`${titleId}:${providerId}`);
  }
}

describe("TitleProviderHealthService", () => {
  test("suggests a working fallback only after two local failures", () => {
    const service = new TitleProviderHealthService(
      new MemoryRepo(),
      () => new Date("2026-05-23T12:00:00.000Z"),
    );
    service.recordFailure("tmdb:1", "vidking", "rivestream", "timeout");
    expect(service.getSwitchSuggestion("tmdb:1", "vidking")).toBeNull();
    service.recordFailure("tmdb:1", "vidking", "rivestream", "no-streams");
    expect(service.getSwitchSuggestion("tmdb:1", "vidking")).toEqual({
      providerId: "vidking",
      suggestedProviderId: "rivestream",
    });
  });

  test("two clean title/provider successes heal a warning", () => {
    const service = new TitleProviderHealthService(
      new MemoryRepo(),
      () => new Date("2026-05-23T12:00:00.000Z"),
    );
    service.recordFailure("tmdb:1", "vidking", "rivestream", "parse");
    service.recordFailure("tmdb:1", "vidking", "rivestream", "parse");
    service.recordCleanSuccess("tmdb:1", "vidking");
    expect(service.getSwitchSuggestion("tmdb:1", "vidking")).not.toBeNull();
    service.recordCleanSuccess("tmdb:1", "vidking");
    expect(service.getSwitchSuggestion("tmdb:1", "vidking")).toBeNull();
  });

  test("stores scoped failure evidence while ignoring offline network failures", () => {
    const repository = new MemoryRepo();
    const service = new TitleProviderHealthService(
      repository,
      () => new Date("2026-05-23T12:00:00.000Z"),
    );

    service.recordFailure("tmdb:1", "vidking", undefined, {
      errorClass: "network-offline",
      networkConfidence: "offline",
    });
    expect(repository.rows.size).toBe(0);

    service.recordFailure("tmdb:1", "vidking", undefined, {
      errorClass: "dead-stream",
      sourceId: "source:kiwi",
      serverId: "kiwi",
      networkConfidence: "healthy",
    });
    expect(repository.rows.get("tmdb:1:vidking")).toMatchObject({
      errorClass: "dead-stream",
      sourceId: "source:kiwi",
      serverId: "kiwi",
      networkConfidence: "healthy",
    });
  });
});
