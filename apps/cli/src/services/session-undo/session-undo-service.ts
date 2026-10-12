import {
  sameUndoSnapshot,
  SessionUndoJournal,
  type SessionUndoEntry,
  type SessionUndoOutcome,
} from "@/domain/undo/session-undo-journal";
import type {
  FollowedTitleRecord,
  FollowedTitleRepository,
  HistoryProgress,
  HistoryRepository,
  ListItem,
  ListRepository,
  QueueEntry,
  QueueRepository,
} from "@kunai/storage";

/**
 * Session undo — the service half of lazygit's `z`.
 *
 * The domain journal owns LIFO/bounds/expiry; this service owns capture and
 * inversion. Call sites wrap a mutation as:
 *
 *   const before = sessionUndo.captureQueue();
 *   queueService.remove(id);
 *   sessionUndo.recordQueueChange("removed from queue", "queue remove", before);
 *
 * (or the `withX` convenience wrappers which do the same three steps). Only
 * mutations with a clean inverse are journaled — anything whose side effects
 * already escaped (queue-session restore across sessions, download jobs,
 * playback progress writes) is deliberately not recorded. A fake undo is
 * worse than none.
 *
 * Every revert re-reads its target before touching it: if the entity changed
 * since the forward mutation — a row played, a record re-followed elsewhere —
 * the entry pops and reports `stale` with an honest reason instead of
 * overwriting the newer state.
 */

export type SessionUndoTone = "info" | "success" | "warning";

export type SessionUndoStripLine = {
  readonly text: string;
  readonly tone: SessionUndoTone;
  readonly expiresAt: number;
};

const OUTCOME_LINE_MS = 4_000;

export type SessionUndoServiceOptions = {
  readonly queueRepository: QueueRepository;
  readonly queueSessionId: string;
  readonly listRepository: ListRepository;
  readonly followedTitleRepository: FollowedTitleRepository;
  readonly historyRepository: HistoryRepository;
  readonly now?: () => number;
  readonly journalCapacity?: number;
  readonly journalWindowMs?: number;
};

export class SessionUndoService {
  private readonly deps: Omit<
    SessionUndoServiceOptions,
    "now" | "journalCapacity" | "journalWindowMs"
  >;
  private readonly journal: SessionUndoJournal;
  private readonly clock: () => number;
  private outcome: SessionUndoStripLine | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(options: SessionUndoServiceOptions) {
    this.deps = {
      queueRepository: options.queueRepository,
      queueSessionId: options.queueSessionId,
      listRepository: options.listRepository,
      followedTitleRepository: options.followedTitleRepository,
      historyRepository: options.historyRepository,
    };
    this.clock = options.now ?? (() => Date.now());
    this.journal = new SessionUndoJournal({
      now: options.now,
      capacity: options.journalCapacity,
      windowMs: options.journalWindowMs,
    });
    // Journal changes (record/undo) forward to strip listeners; undoLatest
    // also notifies after setting the outcome line, which lands after the
    // journal's own emit.
    this.journal.subscribe(() => this.notify());
  }

  private get now(): number {
    return this.clock();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * A fresh forward action supersedes any still-showing outcome line —
   * "undid queue add" must not sit on top of a new "removed from queue · z
   * undo" affordance for the remainder of its window.
   */
  private push(input: Parameters<SessionUndoJournal["record"]>[0]): SessionUndoEntry {
    this.outcome = null;
    return this.journal.record(input);
  }

  /** True while `z` has a live entry to pop — the only gate `z` needs. */
  hasLiveUndo(): boolean {
    return this.journal.peek() !== undefined;
  }

  /**
   * The line for the shell's transient row, or null when nothing is live.
   * An undo outcome ("undid queue add" / "can't undo — changed since")
   * outranks a still-live entry briefly, then falls back to it.
   */
  peekStrip(now: number): SessionUndoStripLine | null {
    if (this.outcome) {
      if (now < this.outcome.expiresAt) return this.outcome;
      this.outcome = null;
    }
    const entry = this.journal.peek();
    if (!entry) return null;
    return {
      text: `${entry.label} · z undo`,
      tone: "info",
      expiresAt: entry.expiresAt,
    };
  }

  /**
   * Pop and invert the newest live entry. `empty` is the silent no-op the
   * keybinding needs — it must not flash anything.
   */
  undoLatest(): SessionUndoOutcome {
    const outcome = this.journal.undo();
    const until = this.now + OUTCOME_LINE_MS;
    if (outcome.kind === "undone") {
      this.outcome = { text: `undid ${outcome.entry.undoNoun}`, tone: "success", expiresAt: until };
    } else if (outcome.kind === "skipped") {
      this.outcome = {
        text: `can't undo ${outcome.entry.undoNoun} — ${outcome.reason}`,
        tone: "warning",
        expiresAt: until,
      };
    }
    this.notify();
    return outcome;
  }

  // ── Queue ────────────────────────────────────────────────────────────────
  // Snapshot is the whole session queue: every covered op (add, remove,
  // clear, reorder, refill, playlist load) is a subset of the same inverse.

  captureQueue(): readonly QueueEntry[] {
    return this.deps.queueRepository.getAll(this.deps.queueSessionId);
  }

  recordQueueChange(
    label: string,
    undoNoun: string,
    before: readonly QueueEntry[],
  ): SessionUndoEntry | undefined {
    const after = this.captureQueue();
    if (sameUndoSnapshot(before, after)) return undefined;
    const queueRepository = this.deps.queueRepository;
    const capture = () => this.captureQueue();
    return this.push({
      label,
      undoNoun,
      revert: () => {
        const currentById = new Map(capture().map((entry) => [entry.id, entry]));
        // Every row the mutation produced must still be there untouched;
        // rows added afterwards are newer state and are left alone.
        const afterById = new Map(after.map((entry) => [entry.id, entry]));
        for (const row of after) {
          if (!sameUndoSnapshot(currentById.get(row.id), row)) {
            return { kind: "stale", reason: "queue changed since then" };
          }
        }
        // Rows the mutation added are `after` minus `before` — every `after`
        // row still exists in `current` (the staleness check above), so
        // membership in `before` is the only discriminator that matters.
        for (const row of after) {
          if (!beforeHas(before, row.id)) queueRepository.remove(row.id);
        }
        // Every `before` row that is gone or differs in any field gets its
        // verbatim row back — positions included, so no separate fix-up.
        const toRestore = before.filter((row) => {
          const afterRow = afterById.get(row.id);
          return !afterRow || !sameUndoSnapshot(afterRow, row);
        });
        if (toRestore.length > 0) queueRepository.restoreEntries(toRestore);
        return { kind: "reverted" };
      },
    });

    function beforeHas(rows: readonly QueueEntry[], id: string): boolean {
      return rows.some((row) => row.id === id);
    }
  }

  /** Convenience: capture → run → record, one line at the call site. */
  withQueueChange<T>(label: string, undoNoun: string, run: () => T): T {
    const before = this.captureQueue();
    const result = run();
    this.recordQueueChange(label, undoNoun, before);
    return result;
  }

  // ── Lists (watchlist / favorites / custom) ────────────────────────────────

  captureListItem(listId: string, titleId: string): ListItem | undefined {
    return this.deps.listRepository.getItemByTitle(listId, titleId);
  }

  recordListItem(
    listId: string,
    titleId: string,
    label: string,
    undoNoun: string,
    before: ListItem | undefined,
  ): SessionUndoEntry | undefined {
    const after = this.captureListItem(listId, titleId);
    if (sameUndoSnapshot(before, after)) return undefined;
    const listRepository = this.deps.listRepository;
    const capture = () => this.captureListItem(listId, titleId);
    return this.push({
      label,
      undoNoun,
      revert: () => {
        if (!sameUndoSnapshot(capture(), after)) {
          return { kind: "stale", reason: "list entry changed since then" };
        }
        if (after) listRepository.removeItem(after.id);
        if (before) listRepository.restoreItem(before);
        return { kind: "reverted" };
      },
    });
  }

  withListItem<T>(
    listId: string,
    titleId: string,
    label: string,
    undoNoun: string,
    run: () => T,
  ): T {
    const before = this.captureListItem(listId, titleId);
    const result = run();
    this.recordListItem(listId, titleId, label, undoNoun, before);
    return result;
  }

  // ── Followed titles ───────────────────────────────────────────────────────

  captureFollowed(titleId: string): FollowedTitleRecord | undefined {
    return this.deps.followedTitleRepository.get(titleId);
  }

  recordFollowed(
    titleId: string,
    label: string,
    undoNoun: string,
    before: FollowedTitleRecord | undefined,
  ): SessionUndoEntry | undefined {
    const after = this.captureFollowed(titleId);
    if (sameUndoSnapshot(before, after)) return undefined;
    const followedTitleRepository = this.deps.followedTitleRepository;
    const capture = () => this.captureFollowed(titleId);
    return this.push({
      label,
      undoNoun,
      revert: () => {
        if (!sameUndoSnapshot(capture(), after)) {
          return { kind: "stale", reason: "follow state changed since then" };
        }
        if (before) followedTitleRepository.upsert(before);
        else followedTitleRepository.delete(titleId);
        return { kind: "reverted" };
      },
    });
  }

  withFollowed<T>(titleId: string, label: string, undoNoun: string, run: () => T): T {
    const before = this.captureFollowed(titleId);
    const result = run();
    this.recordFollowed(titleId, label, undoNoun, before);
    return result;
  }

  // ── History ───────────────────────────────────────────────────────────────
  // Snapshot is the full progress table keyed by row key. markWatched,
  // season-wide marks, row deletes, title deletes and clear() are all the
  // same inverse: restore the rows that changed, delete the ones created.

  captureHistory(): ReadonlyMap<string, HistoryProgress> {
    return new Map(this.deps.historyRepository.listAllProgress().map((row) => [row.key, row]));
  }

  recordHistoryChange(
    label: string,
    undoNoun: string,
    before: ReadonlyMap<string, HistoryProgress>,
  ): SessionUndoEntry | undefined {
    const after = this.captureHistory();
    const changedKeys: string[] = [];
    for (const [key, row] of after) {
      if (!sameUndoSnapshot(before.get(key), row)) changedKeys.push(key);
    }
    for (const [key, row] of before) {
      if (!sameUndoSnapshot(after.get(key), row) && !changedKeys.includes(key)) {
        changedKeys.push(key);
      }
    }
    if (changedKeys.length === 0) return undefined;
    const historyRepository = this.deps.historyRepository;
    const capture = () => this.captureHistory();
    return this.push({
      label,
      undoNoun,
      revert: () => {
        const current = capture();
        for (const key of changedKeys) {
          if (!sameUndoSnapshot(current.get(key), after.get(key))) {
            return { kind: "stale", reason: "history changed since then" };
          }
        }
        for (const key of changedKeys) {
          const restored = before.get(key);
          if (restored) historyRepository.restoreProgressRow(restored);
          else historyRepository.deleteProgressByKey(key);
        }
        return { kind: "reverted" };
      },
    });
  }

  withHistory<T>(label: string, undoNoun: string, run: () => T): T {
    const before = this.captureHistory();
    const result = run();
    this.recordHistoryChange(label, undoNoun, before);
    return result;
  }
}
