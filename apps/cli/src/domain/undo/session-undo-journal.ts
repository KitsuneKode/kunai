/**
 * Session undo journal — lazygit's `z`, scoped to Kunai's reversible mutations.
 *
 * Domain-pure: entries carry the pre-mutation snapshot plus a `revert` closure
 * supplied by the service layer (which owns the repositories). The journal
 * itself knows nothing about storage — it only answers "what is the latest
 * live entry", bounds the stack, and expires entries after a short window.
 *
 * Semantics:
 * - LIFO: `undo()` pops the newest live entry.
 * - Bounded: the stack keeps at most `capacity` entries; overflow evicts the
 *   OLDEST first (FIFO eviction — depth beyond capacity is unreachable anyway).
 * - Timed: an entry is undoable only until `expiresAt`. Expired entries are
 *   pruned lazily on `peek`/`undo`, never by a timer — expiry is a read-side
 *   fact, which keeps the journal deterministic under an injected clock.
 * - One-shot: a reverted or skipped entry is gone. The revert reports either
 *   "reverted" or "stale" (the entity changed elsewhere since recording), and
 *   stale entries pop-and-skip rather than silently overwriting newer state.
 */

export const SESSION_UNDO_CAPACITY = 10;
export const SESSION_UNDO_WINDOW_MS = 8_000;

export type SessionUndoRevertResult =
  | { readonly kind: "reverted" }
  | { readonly kind: "stale"; readonly reason: string };

export type SessionUndoEntry = {
  /** Monotonic id — ordering survives capacity eviction. */
  readonly id: number;
  /** Past-tense strip copy without the hint suffix: "added to queue". */
  readonly label: string;
  /** Noun phrase for the confirmation line: "queue add" → "undid queue add". */
  readonly undoNoun: string;
  readonly recordedAt: number;
  readonly expiresAt: number;
  readonly revert: () => SessionUndoRevertResult;
};

export type SessionUndoOutcome =
  | { readonly kind: "undone"; readonly entry: SessionUndoEntry }
  | { readonly kind: "skipped"; readonly entry: SessionUndoEntry; readonly reason: string }
  | { readonly kind: "empty" };

/**
 * Canonical structural equality for row snapshots. `undefined` fields are
 * dropped (matching how repository mappers represent SQL NULL on optional
 * columns), object keys sort so field order can't create false drift, and
 * array order is significant (queue position is order).
 */
export function stableUndoJson(value: unknown): string {
  // `undefined` gets its own token: `JSON.stringify(undefined)` returns
  // `undefined`, which would otherwise collide with literal `null`.
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? '"\u0000undefined"';
  }
  if (Array.isArray(value)) return `[${value.map(stableUndoJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, field]) => `${JSON.stringify(key)}:${stableUndoJson(field)}`)
    .join(",")}}`;
}

export function sameUndoSnapshot(left: unknown, right: unknown): boolean {
  return stableUndoJson(left) === stableUndoJson(right);
}

export type SessionUndoJournalOptions = {
  readonly now?: () => number;
  readonly capacity?: number;
  readonly windowMs?: number;
};

export class SessionUndoJournal {
  private readonly now: () => number;
  private readonly capacity: number;
  private readonly windowMs: number;
  private entries: SessionUndoEntry[] = [];
  private nextId = 1;
  private readonly listeners = new Set<() => void>();

  constructor(options: SessionUndoJournalOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.capacity = options.capacity ?? SESSION_UNDO_CAPACITY;
    this.windowMs = options.windowMs ?? SESSION_UNDO_WINDOW_MS;
  }

  /** Push a covered mutation. Returns the entry so callers can read expiresAt. */
  record(input: {
    readonly label: string;
    readonly undoNoun: string;
    readonly revert: () => SessionUndoRevertResult;
  }): SessionUndoEntry {
    this.pruneExpired();
    const recordedAt = this.now();
    const entry: SessionUndoEntry = {
      id: this.nextId++,
      label: input.label,
      undoNoun: input.undoNoun,
      recordedAt,
      expiresAt: recordedAt + this.windowMs,
      revert: input.revert,
    };
    this.entries.push(entry);
    while (this.entries.length > this.capacity) this.entries.shift();
    this.emit();
    return entry;
  }

  /** Newest live entry — what the strip displays and `z` would pop. */
  peek(): SessionUndoEntry | undefined {
    this.pruneExpired();
    return this.entries[this.entries.length - 1];
  }

  /**
   * Pop the newest live entry and run its revert. An entry whose target moved
   * since recording reports `stale` and is still consumed — undo must never
   * reach past a superseded change or silently overwrite it.
   */
  undo(): SessionUndoOutcome {
    this.pruneExpired();
    const entry = this.entries.pop();
    if (!entry) return { kind: "empty" };
    const result = entry.revert();
    this.emit();
    return result.kind === "reverted"
      ? { kind: "undone", entry }
      : { kind: "skipped", entry, reason: result.reason };
  }

  /** Live entry count — diagnostics and tests. */
  size(): number {
    this.pruneExpired();
    return this.entries.length;
  }

  /**
   * Fires when the stack changes (record, undo). Expiry is intentionally NOT
   * notified — nothing in the entry changes when the clock passes it; the
   * shell schedules its own repaint at `expiresAt`.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private pruneExpired(): void {
    const now = this.now();
    if (this.entries.some((entry) => entry.expiresAt <= now)) {
      this.entries = this.entries.filter((entry) => entry.expiresAt > now);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
