import type { Container } from "@/container";
import { titleInfoFromMediaItemIdentity } from "@/domain/media/media-item-adapters";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import {
  buildDefaultDownloadProfile,
  commitDownloadIntent,
  resolveDownloadIntentItems,
} from "@/services/download/DownloadIntentService";
import type { MediaKind } from "@kunai/types";

import { MediaActionRouter, type MediaActionRouterDeps } from "./MediaActionRouter";

export type ContainerMediaActionRouterOptions = {
  readonly playback?: MediaActionRouterDeps["playback"];
  readonly details?: MediaActionRouterDeps["details"];
  readonly downloads?: MediaActionRouterDeps["downloads"];
  readonly playlists?: MediaActionRouterDeps["playlists"];
  readonly onDownloadQueued?: (item: MediaItemIdentity) => void;
};

/**
 * Hand a local list change to the sync outbox.
 *
 * Enqueue is durable and cheap, so it happens whether or not a tracker is
 * connected: the work waits in the outbox and goes out when one is, rather than
 * being lost because nothing was linked at the moment the user pressed a key.
 * Identity resolution decides which trackers can address the title at all.
 */
function mirrorToTrackers(
  item: MediaItemIdentity,
  enqueue: (source: { titleId: string; mediaKind: MediaKind }) => number,
): void {
  try {
    enqueue({ titleId: item.titleId, mediaKind: normalizeMediaKind(item.mediaKind) });
  } catch {
    // Mirroring is secondary. The list change has already been written locally,
    // and failing the user's keypress because the outbox is unavailable would
    // trade a working local action for a broken one.
  }
}

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
    watchlist: {
      addToWatchlist: (item) => {
        container.listService.addToWatchlist({
          titleId: item.titleId,
          mediaKind: normalizeMediaKind(item.mediaKind),
          title: item.title,
          season: item.season,
          episode: item.episode,
        });
        mirrorToTrackers(item, (source) =>
          container.syncService.enqueueListMembership({
            source,
            list: "watchlist",
            present: true,
          }),
        );
      },
    },
    favorites: {
      toggleFavorite: (item) => {
        const outcome = container.listService.toggleFavorites({
          titleId: item.titleId,
          mediaKind: normalizeMediaKind(item.mediaKind),
          title: item.title,
          season: item.season,
          episode: item.episode,
        });
        // The local list is the source of truth, and the tracker is told the
        // resulting *state* rather than "toggle" — so a redelivery converges
        // instead of undoing what the user just did.
        mirrorToTrackers(item, (source) =>
          container.syncService.enqueueFavoriteMembership({
            source,
            present: outcome === "added",
          }),
        );
        return outcome;
      },
    },
    attention: {
      follow: (item) => {
        upsertAttentionPreference(container, item, "following");
      },
      unfollow: (item) => {
        upsertAttentionPreference(container, item, "implicit");
      },
      unmute: (item) => {
        upsertAttentionPreference(container, item, "implicit");
      },
      mute: (item) => {
        upsertAttentionPreference(container, item, "muted");
      },
    },
    playlists: options.playlists ?? {
      addToPlaylist: async (item) => {
        const { addMediaItemToPickedPlaylist } =
          await import("@/app-shell/workflows/playlist-add-workflow");
        const result = await addMediaItemToPickedPlaylist(container, item);
        if (result) {
          container.stateManager.dispatch({
            type: "SET_PLAYBACK_FEEDBACK",
            note: `Added "${item.title}" to playlist "${result.playlistName}".`,
          });
        }
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
    mediaKind: item.mediaKind,
    items: resolveDownloadIntentItems({
      title,
      mediaKind: item.mediaKind,
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
  preference: "implicit" | "following" | "muted",
): void {
  container.followedTitleRepository.upsert({
    titleId: item.titleId,
    mediaKind: normalizeMediaKind(item.mediaKind),
    title: item.title,
    preference,
    updatedAt: new Date().toISOString(),
  });
}

/** Watchlist rows only distinguish title-level from episodic content. */
function normalizeMediaKind(mediaKind: MediaItemIdentity["mediaKind"]): "movie" | "series" {
  return mediaKind === "movie" || mediaKind === "video" ? "movie" : "series";
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
