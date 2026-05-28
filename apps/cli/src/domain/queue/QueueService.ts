import type {
  PlaylistItem,
  PlaylistItemInput,
  PlaylistRepository,
  QueueSessionRecord,
} from "@kunai/storage";

import type { MediaItemIdentity } from "../media/media-item-identity";
import { planMediaQueuePlacement } from "../queue/QueuePlanner";
import type { ListService } from "./ListService";

export type { PlaylistItem, PlaylistItemInput };

export type PlaylistStatus = {
  readonly unplayedCount: number;
  readonly nextItem: PlaylistItem | undefined;
  readonly isStale: boolean;
  readonly lastActivityAt: string | undefined;
};

const STALE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

export class PlaylistService {
  constructor(
    private readonly repo: PlaylistRepository,
    private readonly sessionId: string,
  ) {}

  enqueue(input: Omit<PlaylistItemInput, "sessionId">): PlaylistItem {
    return this.repo.enqueue({ ...input, sessionId: this.sessionId });
  }

  enqueueMediaItem(
    item: MediaItemIdentity,
    options: {
      readonly placement: "next" | "after-current-chain" | "end";
      readonly source: string;
    },
  ): PlaylistItem {
    const { priority } = planMediaQueuePlacement(options.placement);
    return this.enqueue({
      title: item.title,
      mediaKind: item.mediaKind,
      titleId: item.titleId,
      season: item.season,
      episode: item.episode,
      absoluteEpisode: item.absoluteEpisode,
      priority,
      source: options.source,
    });
  }

  enqueueBatch(items: Omit<PlaylistItemInput, "sessionId">[]): void {
    for (const item of items) {
      this.repo.enqueue({ ...item, sessionId: this.sessionId });
    }
  }

  peekNext(): PlaylistItem | undefined {
    return this.repo.peekNext(this.sessionId);
  }

  advance(): PlaylistItem | undefined {
    const current = this.repo.peekNext(this.sessionId);
    if (current) {
      this.repo.markPlayed(current.id);
    }
    return this.repo.peekNext(this.sessionId);
  }

  getStatus(): PlaylistStatus {
    const unplayedCount = this.repo.countUnplayed(this.sessionId);
    const nextItem = this.repo.peekNext(this.sessionId);
    const lastActivityAt = this.repo.getLastActivity();
    const isStale =
      lastActivityAt !== undefined &&
      Date.now() - new Date(lastActivityAt).getTime() > STALE_THRESHOLD_MS;

    return { unplayedCount, nextItem, isStale, lastActivityAt };
  }

  clear(): void {
    this.repo.clear(this.sessionId);
  }

  clearPlayed(): void {
    this.repo.clearPlayed(this.sessionId);
  }

  getAll(): PlaylistItem[] {
    return this.repo.getAll(this.sessionId);
  }

  getUnplayed(): PlaylistItem[] {
    return this.repo.getUnplayed(this.sessionId);
  }

  listRecoverableSessions(): QueueSessionRecord[] {
    return this.repo.listRecoverableQueueSessions();
  }

  restoreRecoverableSession(sourceSessionId: string): number {
    return this.repo.restoreQueueSession(sourceSessionId, this.sessionId, new Date().toISOString());
  }

  markCurrentPlayed(): void {
    const current = this.repo.peekNext(this.sessionId);
    if (current) {
      this.repo.markPlayed(current.id);
    }
  }

  refillFromWatchlist(listService: ListService): number {
    const watchlist = listService.getWatchlist();
    const existingTitleIds = new Set(this.repo.getAll(this.sessionId).map((i) => i.titleId));

    let added = 0;
    for (const item of watchlist) {
      if (!existingTitleIds.has(item.titleId)) {
        this.repo.enqueue({
          title: item.title,
          mediaKind: item.mediaKind,
          titleId: item.titleId,
          season: item.season,
          episode: item.episode,
          priority: 0,
          source: "watchlist",
          sessionId: this.sessionId,
        });
        added++;
      }
    }
    return added;
  }
}
