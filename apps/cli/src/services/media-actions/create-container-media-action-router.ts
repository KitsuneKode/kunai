import type { Container } from "@/container";
import { titleInfoFromMediaItemIdentity } from "@/domain/media/media-item-adapters";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import {
  buildDefaultDownloadProfile,
  commitDownloadIntent,
  resolveDownloadIntentItems,
} from "@/services/download/DownloadIntentService";
import { resolveMirrorTargets } from "@/services/sync/mirror-targets";
import type { SyncIdentity } from "@/services/sync/types";
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
 *
 * The item's own `mediaKind` is passed through untouched. Flattening it to
 * `series` first — as the list write does, because the column wants a coarse
 * kind — made `resolveAniListIdentity` reject every anime title outright, so
 * AniList membership could never be queued from any surface.
 */
async function mirrorToTrackers(
  container: Container,
  item: MediaItemIdentity,
  enqueue: (identities: readonly SyncIdentity[]) => Promise<number>,
): Promise<void> {
  try {
    const targets = await resolveMirrorTargets(container, {
      titleId: item.titleId,
      mediaKind: item.mediaKind,
      title: item.title,
      ...(item.externalIds ? { externalIds: item.externalIds } : {}),
    });
    if (targets.identities.length === 0) {
      // Recorded rather than swallowed: "saved locally, addressable by no
      // tracker" is the one outcome the user cannot see from the list itself.
      container.diagnosticsService?.record({
        category: "sync",
        message: "List change could not be mirrored: no tracker id for title",
        context: { titleId: item.titleId, mediaKind: item.mediaKind },
      });
      return;
    }
    if ((await enqueue(targets.identities)) === 0) return;
    // Nothing queued means nothing to deliver, so an unaddressable title starts
    // no drain.
    container.syncService.deliverSoon();
  } catch (error) {
    // Mirroring is secondary. The list change has already been written locally,
    // and failing the user's keypress because the outbox is unavailable would
    // trade a working local action for a broken one.
    container.diagnosticsService?.record({
      category: "sync",
      message: "List change was saved locally but could not be queued for tracker sync",
      context: {
        titleId: item.titleId,
        mediaKind: item.mediaKind,
        error: error instanceof Error ? error.name : "unknown",
      },
    });
  }
}

/**
 * The one seam for list mutations made outside `MediaActionRouter` (notably
 * command-palette removal actions).  It deliberately takes the post-mutation
 * state so redelivery converges instead of replaying a toggle.
 */
export async function mirrorListMembershipChange(
  container: Container,
  item: MediaItemIdentity,
  change: { readonly list: "watchlist" | "favorite"; readonly present: boolean },
): Promise<void> {
  await mirrorToTrackers(container, item, (identities) =>
    change.list === "watchlist"
      ? container.syncService.enqueueListMembershipIfEnabled({
          identities,
          list: "watchlist",
          present: change.present,
        })
      : container.syncService.enqueueFavoriteMembershipIfEnabled({
          identities,
          present: change.present,
        }),
  );
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
      addToWatchlist: async (item) => {
        container.listService.addToWatchlist({
          titleId: item.titleId,
          mediaKind: normalizeMediaKind(item.mediaKind),
          title: item.title,
          season: item.season,
          episode: item.episode,
        });
        await mirrorListMembershipChange(container, item, { list: "watchlist", present: true });
      },
    },
    favorites: {
      toggleFavorite: async (item) => {
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
        await mirrorListMembershipChange(container, item, {
          list: "favorite",
          present: outcome === "added",
        });
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
  const saved = persistMediaItemWatched(container, item, completed);
  queueHistoryMirror(container, item.titleId, saved);
}

/**
 * Mark an entire season locally, then mirror the greatest durable episode once.
 * This keeps a bulk command from racing several progress payloads through the
 * outbox and makes it use the same local-write/mirror boundary as one episode.
 */
export function markSeasonThroughMediaItemWatched(
  container: Container,
  item: MediaItemIdentity,
  season: number,
  throughEpisode: number,
): number {
  const maximum = Math.max(1, Math.floor(throughEpisode));
  let latest: ReturnType<Container["historyRepository"]["getLatestForTitle"]>;
  for (let episode = 1; episode <= maximum; episode += 1) {
    latest = persistMediaItemWatched(container, { ...item, season, episode }, true);
  }
  queueHistoryMirror(container, item.titleId, latest);
  return maximum;
}

function persistMediaItemWatched(
  container: Container,
  item: MediaItemIdentity,
  completed: boolean,
) {
  const hasEpisode = typeof item.season === "number" && typeof item.episode === "number";
  const kind: MediaKind =
    item.mediaKind === "movie" ? "movie" : item.mediaKind === "anime" ? "anime" : "series";
  const title = {
    id: item.titleId,
    kind,
    title: item.title,
    ...(item.externalIds ? { externalIds: item.externalIds } : {}),
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
  } else {
    container.historyRepository.markUnwatched(title, episode);
  }
  return container.historyRepository.getProgress(title, episode);
}

function queueHistoryMirror(
  container: Container,
  titleId: string,
  saved: ReturnType<Container["historyRepository"]["getProgress"]>,
): void {
  const syncService = container.syncService;
  if (!saved || !syncService) return;
  void syncService
    .enqueueProgressIfEnabled(saved)
    .then((queued) => {
      if (queued > 0) syncService.deliverSoon();
      return undefined;
    })
    .catch((error) => {
      container.diagnosticsService?.record({
        category: "sync",
        message: "History change was saved locally but could not be queued for tracker sync",
        context: {
          titleId,
          error: error instanceof Error ? error.name : "unknown",
        },
      });
    });
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
