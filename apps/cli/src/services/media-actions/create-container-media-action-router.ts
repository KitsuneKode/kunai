import type { Container } from "@/container";
import { titleInfoFromMediaItemIdentity } from "@/domain/media/media-item-adapters";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";

import { MediaActionRouter, type MediaActionRouterDeps } from "./MediaActionRouter";

export type ContainerMediaActionRouterOptions = {
  readonly playback?: MediaActionRouterDeps["playback"];
  readonly details?: MediaActionRouterDeps["details"];
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
    downloads: {
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
        markMediaItemWatched(container, item);
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

export async function queueDownloadFromMediaItem(
  container: Container,
  item: MediaItemIdentity,
): Promise<void> {
  const eligibility = container.downloadService.getEnqueueEligibility();
  if (!eligibility.allowed) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Download unavailable: ${eligibility.reason}`,
    });
    return;
  }

  const { DownloadOnlyPhase } = await import("@/app/DownloadOnlyPhase");
  const title = titleInfoFromMediaItemIdentity(item);
  await new DownloadOnlyPhase().execute(
    { title },
    { container, signal: AbortSignal.timeout(60_000) },
  );
}

/**
 * Mark a specific episode (or a movie) as watched — writes a completed history
 * entry for the item's identity. completed=true is the bucket classifier's
 * authority, so the title moves to Completed / advances continuation honestly.
 */
function markMediaItemWatched(container: Container, item: MediaItemIdentity): void {
  const hasEpisode = typeof item.season === "number" && typeof item.episode === "number";
  const kind =
    item.mediaKind === "movie" ? "movie" : item.mediaKind === "anime" ? "anime" : "series";
  container.historyRepository.upsertProgress({
    title: {
      id: item.titleId,
      kind,
      title: item.title,
    },
    episode: hasEpisode
      ? {
          season: item.season,
          episode: item.episode,
          absoluteEpisode: item.absoluteEpisode,
        }
      : undefined,
    positionSeconds: 0,
    completed: true,
  });
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
