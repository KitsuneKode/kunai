import type { Container } from "@/container";
import { titleInfoFromMediaItemIdentity } from "@/domain/media/media-item-adapters";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import {
  buildDefaultDownloadProfile,
  commitDownloadIntent,
  resolveDownloadIntentEpisodes,
} from "@/services/download/DownloadIntentService";
import type { MediaKind } from "@kunai/types";

import { MediaActionRouter, type MediaActionRouterDeps } from "./MediaActionRouter";

export type ContainerMediaActionRouterOptions = {
  readonly playback?: MediaActionRouterDeps["playback"];
  readonly details?: MediaActionRouterDeps["details"];
  readonly downloads?: MediaActionRouterDeps["downloads"];
  readonly onDownloadQueued?: (item: MediaItemIdentity) => void;
};

export function createContainerMediaActionRouter(
  container: Container,
  options: ContainerMediaActionRouterOptions = {},
): MediaActionRouter {
  return new MediaActionRouter({
    queue: {
      enqueueMediaItem: (item, placement) => {
        container.queueService.enqueueMediaItem(item, placement);
      },
    },
    downloads: options.downloads ?? {
      queueDownload: async (item) => {
        await queueDownloadFromMediaItem(container, item);
        options.onDownloadQueued?.(item);
      },
    },
    playlists: {
      addToPlaylist: (item) => {
        container.listService.addToWatchlist({
          titleId: item.titleId,
          mediaKind: normalizeMediaKind(item.mediaKind),
          title: item.title,
          season: item.season,
          episode: item.episode,
        });
      },
    },
    attention: {
      follow: (item) => {
        upsertAttentionPreference(container, item, "following");
      },
      mute: (item) => {
        upsertAttentionPreference(container, item, "muted");
      },
    },
    history: {
      markWatched: (item) => {
        markMediaItemWatched(container, item, true);
      },
      markUnwatched: (item) => {
        markMediaItemWatched(container, item, false);
      },
    },
    playback: options.playback,
    details: options.details,
    notifications: {
      dismissByItem: async (item) => {
        for (const notice of container.notificationService.listActive()) {
          const parsed = parseNotificationItemJson(notice.itemJson);
          if (parsed?.titleId === item.titleId) {
            await container.notificationService.dismiss(notice.dedupKey);
          }
        }
      },
    },
  });
}

/**
 * Programmatic (non-interactive) download for a media item: commit the carried
 * episode (or movie slot) with the default profile via DownloadIntentService.
 * Interactive surfaces (DownloadOnlyPhase) gather a confirmed profile first and
 * then call the same service, so the queue/persist behaviour stays identical.
 */
export async function queueDownloadFromMediaItem(
  container: Container,
  item: MediaItemIdentity,
): Promise<void> {
  const title = titleInfoFromMediaItemIdentity(item);
  await commitDownloadIntent(container, {
    title,
    episodes: resolveDownloadIntentEpisodes({
      title,
      season: item.season,
      episode: item.episode,
    }),
    profile: buildDefaultDownloadProfile(container),
  });
}

/**
 * Single source of truth for marking a specific episode (or movie) watched or
 * unwatched — writes a history entry for the item's identity with the given
 * `completed` flag. `completed` is the bucket classifier's authority, so toggling
 * it moves the title between Completed and continue/unwatched honestly. All
 * surfaces (episode picker, history, details, browse) route through this helper
 * via the MediaActionRouter so the behavior is identical everywhere.
 */
export function markMediaItemWatched(
  container: Container,
  item: MediaItemIdentity,
  completed: boolean,
): void {
  const hasEpisode = typeof item.season === "number" && typeof item.episode === "number";
  const kind: MediaKind =
    item.mediaKind === "movie" ? "movie" : item.mediaKind === "anime" ? "anime" : "series";
  const title = {
    id: item.titleId,
    kind,
    title: item.title,
  };
  const episode = hasEpisode
    ? {
        season: item.season,
        episode: item.episode,
        absoluteEpisode: item.absoluteEpisode,
      }
    : undefined;
  if (completed) {
    container.historyRepository.markWatched(title, episode);
    return;
  }
  container.historyRepository.markUnwatched(title, episode);
}

function upsertAttentionPreference(
  container: Container,
  item: MediaItemIdentity,
  preference: "following" | "muted",
): void {
  container.followedTitleRepository.upsert({
    titleId: item.titleId,
    mediaKind: normalizeMediaKind(item.mediaKind),
    title: item.title,
    preference,
    updatedAt: new Date().toISOString(),
  });
}

function normalizeMediaKind(mediaKind: MediaItemIdentity["mediaKind"]): "movie" | "series" {
  return mediaKind === "movie" ? "movie" : "series";
}

function parseNotificationItemJson(itemJson: string | undefined): { titleId?: string } | null {
  if (!itemJson) return null;
  try {
    const parsed: unknown = JSON.parse(itemJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const titleId = "titleId" in parsed ? parsed.titleId : undefined;
    return typeof titleId === "string" ? { titleId } : null;
  } catch {
    return null;
  }
}
