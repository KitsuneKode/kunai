import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import type { CacheStore } from "@/services/persistence/CacheStore";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { SourceInventoryService } from "@/services/playback/SourceInventoryService";

import type { EpisodePrefetchHandle } from "./episode-prefetch";
import { invalidateEpisodePlaybackCaches } from "./playback-source-cache-invalidation";

export async function invalidateTitlePlaybackCaches(input: {
  readonly cacheStore: CacheStore;
  readonly sourceInventory: Pick<SourceInventoryService, "delete">;
  readonly providerId: string;
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
        title: input.title,
        episode,
        mode: input.mode,
        config: input.config,
      }),
    ),
  );
}
