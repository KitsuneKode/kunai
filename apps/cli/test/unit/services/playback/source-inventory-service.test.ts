import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DiagnosticsStoreImpl } from "@/services/diagnostics/DiagnosticsStoreImpl";
import {
  buildSourceInventoryCacheKey,
  SourceInventoryService,
} from "@/services/playback/SourceInventoryService";
import { openKunaiDatabase, runMigrations, SourceInventoryRepository } from "@kunai/storage";
import type { ProviderResolveResult } from "@kunai/types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SourceInventoryService", () => {
  test("separates provider audio subtitle and episode dimensions in cache keys", () => {
    const base = {
      providerId: "vidking",
      mediaKind: "series" as const,
      titleId: "127529",
      season: 1,
      episode: 2,
      audioMode: "sub",
      subtitleLanguage: "en",
      runtime: "direct-http" as const,
    };

    const keys = new Set([
      buildSourceInventoryCacheKey(base),
      buildSourceInventoryCacheKey({ ...base, providerId: "rivestream" }),
      buildSourceInventoryCacheKey({ ...base, audioMode: "dub" }),
      buildSourceInventoryCacheKey({ ...base, subtitleLanguage: "none" }),
      buildSourceInventoryCacheKey({ ...base, episode: 3 }),
    ]);

    expect(keys.size).toBe(5);
  });

  test("does not include selected quality in the inventory key", () => {
    const key = buildSourceInventoryCacheKey({
      providerId: "vidking",
      mediaKind: "series",
      titleId: "127529",
      season: 1,
      episode: 2,
      audioMode: "sub",
      subtitleLanguage: "en",
      runtime: "direct-http" as const,
    });

    expect(key).toBe(
      buildSourceInventoryCacheKey({
        providerId: "vidking",
        mediaKind: "series",
        titleId: "127529",
        season: 1,
        episode: 2,
        audioMode: "sub",
        subtitleLanguage: "en",
        runtime: "direct-http",
      }),
    );
  });

  test("round trips full provider resolve inventory", async () => {
    const service = new SourceInventoryService(new SourceInventoryRepository(migratedCacheDb()));
    const input = {
      providerId: "vidking",
      mediaKind: "series" as const,
      titleId: "127529",
      season: 1,
      episode: 2,
      audioMode: "sub",
      subtitleLanguage: "en",
      runtime: "direct-http" as const,
    };
    const inventory = makeResolveResult();

    await service.set(input, inventory, new Date("2026-05-07T00:00:00.000Z"));

    const hit = await service.get(input, new Date("2026-05-07T00:01:00.000Z"));
    expect(hit?.providerId).toBe("vidking");
    expect(hit?.sources?.[0]?.id).toBe("source:vidking:cdn");
    expect(hit?.streams).toHaveLength(2);
    expect(hit?.subtitles[0]?.language).toBe("en");
  });

  test("records recoverable diagnostics when inventory persistence fails", async () => {
    const diagnosticsStore = new DiagnosticsStoreImpl();
    const service = new SourceInventoryService(
      {
        get() {
          throw new Error("database is locked");
        },
        set() {
          throw new Error("database is locked");
        },
        delete() {
          throw new Error("database is locked");
        },
      } as never,
      { diagnosticsStore },
    );
    const input = {
      providerId: "vidking",
      mediaKind: "series" as const,
      titleId: "127529",
      season: 1,
      episode: 2,
    };

    await expect(service.get(input)).resolves.toBeNull();
    await expect(service.set(input, makeResolveResult())).resolves.toBeUndefined();
    await expect(service.delete(input)).resolves.toBeUndefined();

    expect(diagnosticsStore.getSnapshot()).toEqual([
      expect.objectContaining({
        level: "warn",
        category: "cache",
        operation: "source-inventory.get",
        providerId: "vidking",
        titleId: "127529",
      }),
      expect.objectContaining({
        level: "warn",
        category: "cache",
        operation: "source-inventory.set",
        providerId: "vidking",
        titleId: "127529",
      }),
      expect.objectContaining({
        level: "warn",
        category: "cache",
        operation: "source-inventory.delete",
        providerId: "vidking",
        titleId: "127529",
      }),
    ]);
  });
});

function migratedCacheDb() {
  const dir = mkdtempSync(join(tmpdir(), "kunai-source-inventory-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "cache.sqlite"));
  runMigrations(db, "cache");
  return db;
}

function makeResolveResult(): ProviderResolveResult {
  return {
    status: "resolved",
    providerId: "vidking",
    selectedStreamId: "stream:vidking:1080",
    sources: [
      {
        id: "source:vidking:cdn",
        providerId: "vidking",
        kind: "provider-api",
        label: "cdn",
        status: "selected",
        confidence: 0.9,
      },
    ],
    variants: [
      {
        id: "variant:vidking:1080",
        providerId: "vidking",
        sourceId: "source:vidking:cdn",
        qualityLabel: "1080p",
        streamIds: ["stream:vidking:1080"],
        confidence: 0.9,
      },
    ],
    streams: [
      {
        id: "stream:vidking:1080",
        providerId: "vidking",
        sourceId: "source:vidking:cdn",
        variantId: "variant:vidking:1080",
        url: "https://example.com/1080.m3u8",
        protocol: "hls",
        container: "m3u8",
        qualityLabel: "1080p",
        qualityRank: 1080,
        confidence: 0.9,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: ["vidking", "127529"],
        },
      },
      {
        id: "stream:vidking:720",
        providerId: "vidking",
        sourceId: "source:vidking:cdn",
        url: "https://example.com/720.m3u8",
        protocol: "hls",
        container: "m3u8",
        qualityLabel: "720p",
        qualityRank: 720,
        confidence: 0.8,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: ["vidking", "127529"],
        },
      },
    ],
    subtitles: [
      {
        id: "subtitle:vidking:en",
        providerId: "vidking",
        sourceId: "source:vidking:cdn",
        url: "https://example.com/en.vtt",
        language: "en",
        source: "provider",
        confidence: 0.9,
        cachePolicy: {
          ttlClass: "subtitle-list",
          scope: "local",
          keyParts: ["vidking", "127529", "en"],
        },
      },
    ],
    cachePolicy: {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: ["vidking", "127529"],
    },
    trace: {
      id: "trace-1",
      startedAt: "2026-05-07T00:00:00.000Z",
      title: { id: "127529", kind: "series", title: "Bloodhounds" },
      episode: { season: 1, episode: 2 },
      selectedProviderId: "vidking",
      selectedStreamId: "stream:vidking:1080",
      cacheHit: false,
      steps: [],
      failures: [],
    },
    failures: [],
  };
}
