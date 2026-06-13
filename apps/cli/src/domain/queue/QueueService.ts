import type {
  QueueEntry,
  QueueEntryInput,
  QueueRepository,
  QueueSessionRecord,
} from "@kunai/storage";

import type { ListService } from "../lists/ListService";
import type { MediaItemIdentity } from "../media/media-item-identity";
import { planMediaQueuePlacement } from "./QueuePlanner";

export type { QueueEntry, QueueEntryInput };

export type QueueStatus = {
  readonly unplayedCount: number;
  readonly nextItem: QueueEntry | undefined;
  readonly isStale: boolean;
  readonly lastActivityAt: string | undefined;
};

const STALE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

export class QueueService {
  constructor(
    private readonly repo: QueueRepository,
    private readonly sessionId: string,
  ) {}

  enqueue(input: Omit<QueueEntryInput, "sessionId">): QueueEntry {
    return this.repo.enqueue({ ...input, sessionId: this.sessionId });
  }

  enqueueMediaItem(
    item: MediaItemIdentity,
    options: {
      readonly placement: "next" | "after-current-chain" | "end";
      readonly source: string;
    },
  ): QueueEntry {
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

  enqueueBatch(items: Omit<QueueEntryInput, "sessionId">[]): void {
    for (const item of items) {
      this.repo.enqueue({ ...item, sessionId: this.sessionId });
    }
  }

  peekNext(): QueueEntry | undefined {
    return this.repo.peekNext(this.sessionId);
  }

  advance(): QueueEntry | undefined {
    const current = this.repo.peekNext(this.sessionId);
    if (current) {
      this.repo.markPlayed(current.id);
    }
    return this.repo.peekNext(this.sessionId);
  }

  getStatus(): QueueStatus {
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

  remove(id: string): void {
    this.repo.remove(id);
  }

  /**
   * Reorder an unplayed item one slot earlier (-1) or later (+1) in the Up Next
   * queue. Played items keep their leading slots; only the unplayed tail is
   * reordered. Returns true if the queue actually changed.
   */
  private moveUnplayed(id: string, direction: -1 | 1): boolean {
    const all = this.repo.getAll(this.sessionId);
    const played = all.filter((entry) => entry.playedAt !== undefined);
    const unplayed = all.filter((entry) => entry.playedAt === undefined);
    const index = unplayed.findIndex((entry) => entry.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= unplayed.length) return false;
    const moved = unplayed[index];
    const displaced = unplayed[target];
    if (!moved || !displaced) return false;
    unplayed[index] = displaced;
    unplayed[target] = moved;
    this.repo.setQueuePositions([...played, ...unplayed].map((entry) => entry.id));
    return true;
  }

  moveUp(id: string): boolean {
    return this.moveUnplayed(id, -1);
  }

  moveDown(id: string): boolean {
    return this.moveUnplayed(id, 1);
  }

  /**
   * Jump an unplayed item to the front ("play next") or back of the Up Next
   * queue. Played items keep their leading slots; only the unplayed tail moves.
   * Returns true if the queue actually changed.
   */
  private moveUnplayedToEnd(id: string, end: "top" | "bottom"): boolean {
    const all = this.repo.getAll(this.sessionId);
    const played = all.filter((entry) => entry.playedAt !== undefined);
    const unplayed = all.filter((entry) => entry.playedAt === undefined);
    const index = unplayed.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    const target = end === "top" ? 0 : unplayed.length - 1;
    if (index === target) return false;
    const [moved] = unplayed.splice(index, 1);
    if (!moved) return false;
    if (end === "top") unplayed.unshift(moved);
    else unplayed.push(moved);
    this.repo.setQueuePositions([...played, ...unplayed].map((entry) => entry.id));
    return true;
  }

  moveToTop(id: string): boolean {
    return this.moveUnplayedToEnd(id, "top");
  }

  moveToBottom(id: string): boolean {
    return this.moveUnplayedToEnd(id, "bottom");
  }

  getAll(): QueueEntry[] {
    return this.repo.getAll(this.sessionId);
  }

  getUnplayed(): QueueEntry[] {
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
