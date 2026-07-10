import { createHash } from "node:crypto";

import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import { getDefaultTtlMs, SourceInventoryRepository } from "@kunai/storage";
import type {
  CacheTtlClass,
  MediaKind,
  ProviderResolveResult,
  ProviderRuntime,
  StartupPriority,
} from "@kunai/types";

export const SOURCE_INVENTORY_SCHEMA_VERSION = "v5";

export type SourceInventoryCacheInput = {
  readonly providerId: string;
  readonly mediaKind: MediaKind;
  readonly titleId: string;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly audioMode?: string;
  readonly subtitleLanguage?: string;
  readonly qualityPreference?: string;
  readonly startupPriority?: StartupPriority;
  readonly runtime?: ProviderRuntime;
  readonly schemaVersion?: string;
};

export type SourceInventoryCacheEntry = {
  readonly inventory: ProviderResolveResult;
  readonly createdAt: string;
  readonly expiresAt: string;
};

export class SourceInventoryService {
  constructor(
    private readonly repository: SourceInventoryRepository,
    private readonly options: { readonly diagnostics?: Pick<DiagnosticsService, "record"> } = {},
  ) {}

  async get(
    input: SourceInventoryCacheInput,
    now = new Date(),
  ): Promise<ProviderResolveResult | null> {
    const entry = await this.getEntry(input, now);
    return entry?.inventory ?? null;
  }

  async getEntry(
    input: SourceInventoryCacheInput,
    now = new Date(),
  ): Promise<SourceInventoryCacheEntry | null> {
    const key = buildSourceInventoryCacheKey(input);
    try {
      let hit = this.repository.get<ProviderResolveResult>(key, now);
      if (!hit && input.providerId === "videasy") {
        hit = this.repository.get<ProviderResolveResult>(
          buildSourceInventoryCacheKey({ ...input, providerId: "vidking" }),
          now,
        );
      }
      this.recordCacheDecision(
        hit ? "source-inventory.cache.hit" : "source-inventory.cache.miss",
        input,
        {
          keyHash: cacheKeyHash(key),
          reason: hit ? "fresh-entry" : "missing-or-expired",
        },
      );
      if (!hit) return null;
      return {
        inventory: hit.inventory,
        createdAt: hit.createdAt,
        expiresAt: hit.expiresAt,
      };
    } catch (error) {
      this.recordCacheFailure("source-inventory.get", input, error);
      return null;
    }
  }

  async set(
    input: SourceInventoryCacheInput,
    inventory: ProviderResolveResult,
    now = new Date(),
  ): Promise<void> {
    const ttlClass = inventory.cachePolicy?.ttlClass ?? "stream-manifest";
    if (ttlClass === "never-cache") {
      return;
    }

    const key = buildSourceInventoryCacheKey(input);
    try {
      this.repository.set(
        key,
        input.providerId,
        input.titleId,
        inventory,
        getInventoryExpiresAt(ttlClass, inventory.cachePolicy?.ttlMs, now),
        now.toISOString(),
      );
      this.recordCacheDecision("source-inventory.cache.set", input, {
        keyHash: cacheKeyHash(key),
        ttlClass,
        expiresAt: getInventoryExpiresAt(ttlClass, inventory.cachePolicy?.ttlMs, now),
      });
    } catch (error) {
      this.recordCacheFailure("source-inventory.set", input, error);
      // Inventory caching is a performance feature; playback must keep going.
    }
  }

  async delete(input: SourceInventoryCacheInput): Promise<void> {
    const key = buildSourceInventoryCacheKey(input);
    try {
      this.repository.delete(key);
      this.recordCacheDecision("source-inventory.cache.invalidated", input, {
        keyHash: cacheKeyHash(key),
        reason: "manual-delete",
      });
    } catch (error) {
      this.recordCacheFailure("source-inventory.delete", input, error);
    }
  }

  async deleteByProvider(providerId: string): Promise<number> {
    try {
      const removed = this.repository.deleteByProvider(providerId);
      this.options.diagnostics?.record({
        level: "info",
        category: "cache",
        operation: "source-inventory.cache.invalidated",
        message: "Source inventory rows purged by provider",
        providerId,
        context: { removed, reason: "provider-wide-delete" },
      });
      return removed;
    } catch (error) {
      this.recordCacheFailure(
        "source-inventory.delete-by-provider",
        {
          providerId,
          mediaKind: "series",
          titleId: "*",
        },
        error,
      );
      return 0;
    }
  }

  private recordCacheFailure(
    operation: string,
    input: SourceInventoryCacheInput,
    error: unknown,
  ): void {
    this.options.diagnostics?.record({
      level: "warn",
      category: "cache",
      operation,
      message: "Source inventory cache unavailable",
      providerId: input.providerId,
      titleId: input.titleId,
      season: input.season,
      episode: input.episode ?? input.absoluteEpisode,
      context: {
        mediaKind: input.mediaKind,
        runtime: input.runtime,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  private recordCacheDecision(
    operation: string,
    input: SourceInventoryCacheInput,
    context: Record<string, unknown>,
  ): void {
    this.options.diagnostics?.record({
      level: "info",
      category: "cache",
      operation,
      message: "Source inventory cache decision",
      providerId: input.providerId,
      titleId: input.titleId,
      season: input.season,
      episode: input.episode ?? input.absoluteEpisode,
      context: {
        mediaKind: input.mediaKind,
        runtime: input.runtime,
        schemaVersion: input.schemaVersion ?? SOURCE_INVENTORY_SCHEMA_VERSION,
        startupPriority: input.startupPriority ?? "balanced",
        ...context,
      },
    });
  }
}

export function buildSourceInventoryCacheKey(input: SourceInventoryCacheInput): string {
  return `source-inventory:${createHash("sha256")
    .update(buildSourceInventoryCachePreimage(input))
    .digest("hex")}`;
}

export function buildSourceInventoryCachePreimage(input: SourceInventoryCacheInput): string {
  return [
    input.schemaVersion ?? SOURCE_INVENTORY_SCHEMA_VERSION,
    normalizePart(input.providerId),
    normalizePart(input.mediaKind),
    normalizePart(input.titleId),
    normalizePart(input.season),
    normalizePart(input.episode),
    normalizePart(input.absoluteEpisode),
    normalizePart(input.audioMode),
    normalizePart(input.subtitleLanguage),
    // qualityPreference partitions inventory so 1080p vs 720p prefs do not share a row.
    // Bumping schemaVersion intentionally invalidates pre-qualityPreference cache entries.
    normalizePart(input.qualityPreference),
    normalizePart(input.startupPriority ?? "balanced"),
    normalizePart(input.runtime),
  ].join("\0");
}

function getInventoryExpiresAt(
  ttlClass: CacheTtlClass,
  ttlMs: number | undefined,
  now: Date,
): string {
  const effectiveTtlMs = ttlMs ?? getDefaultTtlMs(ttlClass);
  return new Date(now.getTime() + effectiveTtlMs).toISOString();
}

function normalizePart(value: string | number | undefined): string {
  if (value === undefined || value === "") {
    return "none";
  }
  return String(value).trim().toLowerCase().replaceAll(/\s+/g, "-");
}

function cacheKeyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}
