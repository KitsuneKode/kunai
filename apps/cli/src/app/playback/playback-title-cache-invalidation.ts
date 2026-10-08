import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import type { CacheStore } from "@/services/persistence/CacheStore";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { SourceInventoryService } from "@/services/playback/SourceInventoryService";
import type { CoreProviderManifest } from "@kunai/core";

import type { EpisodePrefetchHandle } from "./episode-prefetch";
import { invalidateEpisodePlaybackCaches } from "./playback-source-cache-invalidation";

export async function invalidateTitlePlaybackCaches(input: {
  readonly cacheStore: CacheStore;
  readonly sourceInventory: Pick<SourceInventoryService, "delete">;
  readonly providerId: string;
  /** Manifest-driven keyParts decide the resolve-cache key; without them the
   * delete targets a key that was never written (anime providers key without
   * `season`). */
  readonly providerManifest?: CoreProviderManifest;
  readonly title: TitleInfo;
  readonly mode: ShellMode;
  readonly config: KitsuneConfig;
  readonly episodes: readonly EpisodeInfo[];
  readonly episodePrefetch?: EpisodePrefetchHandle;
  readonly cancelReason?: string;
}): Promise<void> {
  input.episodePrefetch?.cancel(input.cancelReason ?? "title-playback-cache-invalidation");

  await Promise.all(
    input.episodes.map((episode) =>
      invalidateEpisodePlaybackCaches({
        cacheStore: input.cacheStore,
        sourceInventory: input.sourceInventory,
        providerId: input.providerId,
        providerManifest: input.providerManifest,
        title: input.title,
        episode,
        mode: input.mode,
        config: input.config,
      }),
    ),
  );
}
