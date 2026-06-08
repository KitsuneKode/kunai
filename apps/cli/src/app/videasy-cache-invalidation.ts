import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import type { CacheStore } from "@/services/persistence/CacheStore";
import type { SourceInventoryService } from "@/services/playback/SourceInventoryService";

/** Best-effort purge after videasyAppId migration or explicit provider reset. */
export async function invalidateVideasyProviderCaches(input: {
  readonly cacheStore: CacheStore;
  readonly sourceInventory: SourceInventoryService;
  readonly diagnostics?: Pick<DiagnosticsService, "record">;
  readonly reason: string;
  readonly clearStreamCache?: boolean;
}): Promise<void> {
  if (input.clearStreamCache !== false) {
    try {
      await input.cacheStore.clear();
    } catch {
      // best-effort
    }
  }

  const removedVideasy = await input.sourceInventory.deleteByProvider("videasy");
  const removedVidking = await input.sourceInventory.deleteByProvider("vidking");

  input.diagnostics?.record({
    category: "cache",
    message: "Videasy provider caches invalidated",
    context: {
      reason: input.reason,
      removedVideasy,
      removedVidking,
      streamCacheCleared: input.clearStreamCache !== false,
    },
  });
}
