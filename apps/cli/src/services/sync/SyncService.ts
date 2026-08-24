import type { HistoryProgress, SyncOutboxClaim, SyncOutboxRepository } from "@kunai/storage";

import type { DiagnosticsService } from "../diagnostics/DiagnosticsService";
import {
  parseTrackerOperation,
  trackerOperationDedupeKey,
  type TrackerOperation,
} from "./operations";
import { SYNC_SHUTDOWN_REASON } from "./request-deadline";
import { resolveAniListIdentity, resolveAniListProgressEpisode } from "./sync-identity";
import { resolvePauseState } from "./sync-pause";
import type { SyncAdapter } from "./SyncAdapter";
import {
  syncCancelled,
  type SyncCapabilities,
  type SyncMutationOptions,
  type SyncIdentity,
  type SyncOutcome,
  type TrackerId,
} from "./types";

export type SyncHealth = "ok" | "warn" | "error" | "disconnected" | "paused";

/**
 * Everything a surface needs to say what sync is doing, in one read.
 *
 * `getHealth()` alone was computed from "did the last push fail", so it could
 * not distinguish a paused queue, a backlog waiting to go out, or a credential
 * the tracker has refused — three states that need three different sentences.
 */
export type SyncStatus = {
  readonly connected: number;
  readonly pending: number;
  readonly needsReauth: number;
  readonly deadLettered: number;
  readonly health: SyncHealth;
};

export interface SyncConfigGate {
  readonly enabled: boolean;
  readonly trackWatched: boolean;
  readonly syncList: boolean;
}

/**
 * Live config, read per mutation. This is a port rather than a snapshot because
 * a captured value cannot express "the user turned this off a moment ago" — and
 * queued work outlives the moment it was queued.
 */
export interface SyncConfigPort {
  read(): Promise<{
    readonly sync: Readonly<Record<TrackerId, SyncConfigGate>> & {
      readonly pausedUntil?: string | null;
    };
  }>;
}

export type AutomaticSyncCapability = "progress" | "watchlist" | "favorite";
export type AutomaticSyncAdmission = "allowed" | "disabled" | "aborted";

export class SyncAdmissionAbortedError extends Error {
  constructor() {
    super("Tracker sync admission was cancelled");
    this.name = "SyncAdmissionAbortedError";
  }
}

export type SyncPushSummary = {
  readonly connected: number;
  readonly claimed: number;
  readonly succeeded: number;
  readonly skipped: number;
  readonly failed: number;
  readonly retrying: number;
  readonly needsReauth: number;
  readonly deadLettered: number;
  readonly released: number;
  readonly superseded: number;
  /** Held back because the tracker asked us to wait — not a failure. */
  readonly deferred: number;
  readonly pending: number;
  readonly failures: readonly string[];
};

export type SyncNowResult =
  | { readonly status: "completed"; readonly enqueued: number; readonly summary: SyncPushSummary }
  | { readonly status: "already-running"; readonly enqueued: number };

export interface SyncServiceDeps {
  readonly adapters: readonly SyncAdapter[];
  readonly outbox: SyncOutboxRepository;
  readonly config: SyncConfigPort;
  readonly diagnostics?: Pick<DiagnosticsService, "record">;
  /** Injectable so operation-budget continuations can be advanced without real timers in tests. */
  readonly scheduleContinuation?: (task: () => void) => void;
  /** Injectable only so due-time and shutdown behavior are deterministic in tests. */
  readonly scheduleWake?: (task: () => void, delayMs: number) => () => void;
  readonly now?: () => Date;
  /**
   * Rows one `deliverSoon` pass will attempt before handing back to the loop.
   *
   * Injectable because the continuation rule -- "keep going until every due row
   * has been attempted" -- is only observable across a budget boundary, so a
   * test has to enqueue more rows than the budget. Against the production 100
   * that meant seeding 103 rows through real SQLite per test, which is orders
   * of magnitude more work than the property needs and made those tests the
   * first to lose under parallel CI load. The behaviour is identical at 5.
   */
  readonly maxOperationsPerPass?: number;
  /**
   * Rows claimed per batch inside a pass.
   *
   * Injectable alongside `maxOperationsPerPass` so a test can keep the two in
   * production *proportion* rather than production *size*. Production runs 100
   * rows in batches of 25 -- four batches per pass -- and it is that loop, not
   * the row count, that the drain tests exercise. Shrinking only the budget
   * would collapse each pass to a single batch and quietly stop testing the
   * loop at all.
   */
  readonly batchSize?: number;
}

/** Rows claimed per batch inside a pass. Overridable per instance. */
export const DRAIN_BATCH_LIMIT = 25;
/** Rows one delivery pass attempts by default. Overridable per instance. */
export const DRAIN_MAX_OPERATIONS = 100;
const DISABLED_RECHECK_MS = 60_000;

const emptySummary = (pending: number): SyncPushSummary => ({
  connected: 0,
  claimed: 0,
  succeeded: 0,
  skipped: 0,
  failed: 0,
  retrying: 0,
  needsReauth: 0,
  deadLettered: 0,
  released: 0,
  superseded: 0,
  deferred: 0,
  pending,
  failures: [],
});

function mergeSummaries(left: SyncPushSummary, right: SyncPushSummary): SyncPushSummary {
  return {
    connected: right.connected,
    claimed: left.claimed + right.claimed,
    succeeded: left.succeeded + right.succeeded,
    skipped: left.skipped + right.skipped,
    failed: left.failed + right.failed,
    retrying: left.retrying + right.retrying,
    needsReauth: left.needsReauth + right.needsReauth,
    deadLettered: left.deadLettered + right.deadLettered,
    released: left.released + right.released,
    superseded: left.superseded + right.superseded,
    deferred: left.deferred + right.deferred,
    pending: right.pending,
    failures: [...left.failures, ...right.failures],
  };
}

/**
 * Whether the user's per-tracker settings permit this kind of write.
 *
 * `trackWatched` and `syncList` were declared on the config port and read by
 * nothing — settings could toggle them and delivery carried on regardless,
 * which is the silent no-op this repo gates against. They are checked here,
 * beside `enabled`, against the same freshly-read config.
 */
function allowedByConfig(operation: TrackerOperation, gate: SyncConfigGate): boolean {
  switch (operation.kind) {
    case "progress:set":
      return gate.trackWatched;
    case "list-membership:set":
    case "favorite-membership:set":
      return gate.syncList;
  }
}

/** Which capability an operation needs, so gating reads one declaration. */
function requiredCapability(operation: TrackerOperation): keyof SyncCapabilities {
  switch (operation.kind) {
    case "progress:set":
      return "episodeProgress";
    case "list-membership:set":
      return "watchlistMembership";
    case "favorite-membership:set":
      return "favoriteMembership";
  }
}

function trackerOf(operation: TrackerOperation): TrackerId {
  return operation.target.tracker;
}

/**
 * Collapse history facts into the monotonic remote state each AniList title
 * should receive. History is ordered for presentation, not delivery: a newest
 * episode followed by an older one must never overwrite it in the outbox.
 */
export function buildProgressUpdates(
  entries: readonly HistoryProgress[],
): readonly HistoryProgress[] {
  const byAniListId = new Map<number, HistoryProgress>();
  for (const entry of entries) {
    const identity = resolveAniListIdentity(entry);
    const episode = resolveAniListProgressEpisode(entry);
    if (!identity || episode === null) continue;
    const previous = byAniListId.get(identity.anilistId);
    const previousEpisode = previous ? resolveAniListProgressEpisode(previous) : null;
    if (
      !previous ||
      previousEpisode === null ||
      episode > previousEpisode ||
      (episode === previousEpisode && entry.completed && !previous.completed)
    ) {
      byAniListId.set(identity.anilistId, entry);
    }
  }
  return [...byAniListId.values()];
}

/**
 * Owns durable delivery of tracker writes.
 *
 * Playback and shell surfaces enqueue desired state and return; nothing waits on
 * a remote call. Exactly one drain is active at a time, so a scheduler tick and
 * a manual "sync now" cannot both claim the same row, and shutdown has a single
 * thing to cancel and await.
 */
/**
 * Clamp an injected drain limit to something a pass can actually make progress
 * on.
 *
 * Zero is the dangerous value, and it fails differently on each limit. A batch
 * size of 0 claims nothing, and `claimed < batchSize` is then `0 < 0` -- false
 * -- so `drainBatches` never breaks and never decrements: it spins. A pass
 * budget of 0 skips the loop entirely, but `claimed >= maxOperationsPerPass` is
 * then `0 >= 0` -- true -- so `deliverSoon` reschedules a continuation that
 * will do nothing, forever. Negative and fractional values are the same class.
 *
 * Clamping rather than throwing matches the activation lock, which clamps a
 * non-positive poll interval to one millisecond: a caller passing nonsense
 * should get slow, not a wedged queue or a crash on a background path.
 */
function clampDrainLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export class SyncService {
  private readonly adaptersById = new Map<TrackerId, SyncAdapter>();
  private readonly outbox: SyncOutboxRepository;
  private readonly config: SyncConfigPort;
  private readonly diagnostics?: Pick<DiagnosticsService, "record">;
  private readonly scheduleContinuation: (task: () => void) => void;
  private readonly scheduleWake: (task: () => void, delayMs: number) => () => void;
  private readonly now: () => Date;
  private readonly maxOperationsPerPass: number;
  private readonly batchSize: number;
  private readonly shutdownController = new AbortController();
  private activeDrain: Promise<SyncPushSummary> | null = null;
  private continuationScheduled = false;
  private deliveryRequestedWhileActive = false;
  private retryWakeCancel?: () => void;
  private retryWakeAt?: number;
  private accepting = true;
  private lastPushFailed = false;

  constructor(deps: SyncServiceDeps) {
    for (const adapter of deps.adapters) this.adaptersById.set(adapter.id, adapter);
    this.outbox = deps.outbox;
    this.config = deps.config;
    this.diagnostics = deps.diagnostics;
    this.now = deps.now ?? (() => new Date());
    this.maxOperationsPerPass = clampDrainLimit(deps.maxOperationsPerPass, DRAIN_MAX_OPERATIONS);
    this.batchSize = clampDrainLimit(deps.batchSize, DRAIN_BATCH_LIMIT);
    this.scheduleContinuation = deps.scheduleContinuation ?? ((task) => setTimeout(task, 0));
    this.scheduleWake =
      deps.scheduleWake ??
      ((task, delayMs) => {
        const timer = setTimeout(task, delayMs);
        timer.unref();
        return () => clearTimeout(timer);
      });
  }

  get adapters(): readonly SyncAdapter[] {
    return [...this.adaptersById.values()];
  }

  /** Lifetime cancellation shared by admission, reconciliation, and delivery. */
  get lifetimeSignal(): AbortSignal {
    return this.shutdownController.signal;
  }

  getConnectedAdapters(): SyncAdapter[] {
    return this.adapters.filter((adapter) => adapter.isConnected());
  }

  /**
   * Pause is passed in rather than read here: the caller already holds config,
   * and an async status read would make every surface that renders a one-word
   * badge wait on the filesystem.
   */
  getHealth(pausedUntil?: string | null): SyncHealth {
    if (resolvePauseState(pausedUntil).paused) return "paused";
    if (this.getConnectedAdapters().length === 0) return "disconnected";
    if (this.outbox.counts().needsReauth > 0) return "error";
    return this.lastPushFailed ? "warn" : "ok";
  }

  getStatus(pausedUntil?: string | null): SyncStatus {
    const counts = this.outbox.counts();
    return {
      connected: this.getConnectedAdapters().length,
      pending: counts.pending,
      needsReauth: counts.needsReauth,
      deadLettered: counts.deadLetter,
      health: this.getHealth(pausedUntil),
    };
  }

  /**
   * Persist one operation. Returns how many rows were written (0 or 1) so
   * callers can report an exact count rather than an intention.
   */
  private enqueueOperation(operation: TrackerOperation): number {
    if (!this.accepting || this.shutdownController.signal.aborted) {
      throw new SyncAdmissionAbortedError();
    }
    const tracker = trackerOf(operation);
    if (!this.adaptersById.has(tracker)) return 0;

    this.outbox.enqueue({
      trackerId: tracker,
      dedupeKey: trackerOperationDedupeKey(operation),
      payload: operation,
    });
    return 1;
  }

  /** Read the current user gate before identity work creates tracker intent. */
  async checkAutomaticAdmission(
    input: { readonly tracker: TrackerId; readonly capability: AutomaticSyncCapability },
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<AutomaticSyncAdmission> {
    if (!this.accepting || this.shutdownController.signal.aborted) return "aborted";
    let config: Awaited<ReturnType<SyncConfigPort["read"]>>;
    try {
      config = await this.readConfig(options.signal);
    } catch (error) {
      if (error instanceof SyncAdmissionAbortedError) return "aborted";
      throw error;
    }
    if (!this.accepting || this.shutdownController.signal.aborted || options.signal?.aborted) {
      return "aborted";
    }
    const gate = config.sync[input.tracker];
    const adapter = this.adaptersById.get(input.tracker);
    if (!gate?.enabled || !adapter) return "disabled";
    if (input.capability === "progress") {
      return gate.trackWatched && adapter.capabilities.episodeProgress ? "allowed" : "disabled";
    }
    const supported =
      input.capability === "watchlist"
        ? adapter.capabilities.watchlistMembership
        : adapter.capabilities.favoriteMembership;
    return gate.syncList && supported ? "allowed" : "disabled";
  }

  /**
   * Admission gate for newly-created automatic work. Disabled sync is opt-out,
   * not a deferred consent prompt: do not persist history for later delivery.
   */
  async enqueueProgressIfEnabled(
    entry: HistoryProgress,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<number> {
    const identity = resolveAniListIdentity(entry);
    const progress = resolveAniListProgressEpisode(entry);
    if (!identity || progress === null) return 0;
    const admission = await this.checkAutomaticAdmission(
      { tracker: "anilist", capability: "progress" },
      options,
    );
    if (admission === "aborted") throw new SyncAdmissionAbortedError();
    if (admission === "disabled") return 0;
    return this.enqueueOperation({
      version: 1,
      kind: "progress:set",
      target: identity,
      progress,
      status: entry.completed ? "completed" : "watching",
      ...(entry.completedAt ? { watchedAt: entry.completedAt } : {}),
    });
  }

  /**
   * Membership writes take already-resolved identities rather than a title.
   *
   * Resolution needs the crosswalk and may enrich, which is async and belongs to
   * the caller that owns the keypress. Taking a `TrackerIdSource` here meant
   * this class silently resolved to zero targets and returned 0 to a caller
   * that ignored the count — the favourite that never left the device.
   */
  async enqueueListMembershipIfEnabled(
    input: {
      readonly identities: readonly SyncIdentity[];
      readonly list: "watchlist";
      readonly present: boolean;
    },
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<number> {
    return this.enqueueForEachIfEnabled(
      input.identities,
      (target) => ({
        version: 1,
        kind: "list-membership:set",
        target,
        list: input.list,
        present: input.present,
      }),
      options,
    );
  }

  async enqueueFavoriteMembershipIfEnabled(
    input: {
      readonly identities: readonly SyncIdentity[];
      readonly present: boolean;
    },
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<number> {
    return this.enqueueForEachIfEnabled(
      input.identities,
      (target) => ({
        version: 1,
        kind: "favorite-membership:set",
        target,
        present: input.present,
      }),
      options,
    );
  }

  private async enqueueForEachIfEnabled(
    identities: readonly SyncIdentity[],
    build: (target: TrackerOperation["target"]) => TrackerOperation,
    options: { readonly signal?: AbortSignal },
  ): Promise<number> {
    let count = 0;
    for (const identity of identities) {
      const operation = build(identity);
      const capability = operation.kind === "list-membership:set" ? "watchlist" : "favorite";
      const admission = await this.checkAutomaticAdmission(
        { tracker: trackerOf(operation), capability },
        options,
      );
      if (admission === "aborted") throw new SyncAdmissionAbortedError();
      if (admission === "disabled") continue;
      count += this.enqueueOperation(operation);
    }
    return count;
  }

  private async readConfig(
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<SyncConfigPort["read"]>>> {
    const admissionSignal = signal
      ? AbortSignal.any([this.shutdownController.signal, signal])
      : this.shutdownController.signal;
    if (admissionSignal.aborted) throw new SyncAdmissionAbortedError();
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new SyncAdmissionAbortedError());
      admissionSignal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([this.config.read(), cancelled]);
    } finally {
      admissionSignal.removeEventListener("abort", abort);
    }
  }

  /**
   * Enqueue then deliver, for an explicit user action.
   *
   * A caller arriving while a drain is already running is told so rather than
   * handed that drain's summary: its rows were enqueued after the batch was
   * claimed, so reporting them as delivered would be a lie a later drain has to
   * make true.
   */
  async syncNow(entries: readonly HistoryProgress[]): Promise<SyncNowResult> {
    let enqueued = 0;
    for (const entry of buildProgressUpdates(entries)) {
      enqueued += await this.enqueueProgressIfEnabled(entry);
    }
    if (this.activeDrain) {
      this.deliverSoon();
      return { status: "already-running", enqueued };
    }
    return { status: "completed", enqueued, summary: await this.drain() };
  }

  /**
   * Ask for delivery without waiting for it.
   *
   * Enqueueing promises eventual delivery, but for a long time the only
   * automatic drain was `sync.startup` — so anything queued mid-session sat in
   * the outbox until the process restarted, which is indistinguishable from
   * never having queued at all. Every enqueue site calls this instead of
   * awaiting `drain()`: a keypress or a playback teardown must not block on a
   * remote call, and `drain()` is single-flight so a burst joins one batch.
   *
   * The caller does not wait for delivery, but setup failures are still made
   * visible to diagnostics. Row-level delivery failures record their own
   * transition and remain queued for retry.
   */
  deliverSoon(): void {
    if (this.activeDrain) this.deliveryRequestedWhileActive = true;
    void this.drain()
      .then((summary) => {
        const requestedWhileActive = this.deliveryRequestedWhileActive;
        this.deliveryRequestedWhileActive = false;
        if (
          (requestedWhileActive || summary.claimed >= this.maxOperationsPerPass) &&
          summary.pending > 0 &&
          !this.continuationScheduled &&
          !this.shutdownController.signal.aborted
        ) {
          this.continuationScheduled = true;
          this.scheduleContinuation(() => {
            this.continuationScheduled = false;
            if (!this.shutdownController.signal.aborted) this.deliverSoon();
          });
        }
        return undefined;
      })
      .catch((error) => {
        this.diagnostics?.record({
          category: "sync",
          message: "Deferred tracker-sync drain failed before completing",
          context: { error: error instanceof Error ? error.name : "unknown" },
        });
      });
  }

  /**
   * Deliver one bounded batch. Duplicate callers join the active drain rather
   * than starting a second one — two drains would race for the same claims.
   */
  async drain(limit = this.batchSize, options?: SyncMutationOptions): Promise<SyncPushSummary> {
    if (this.activeDrain) return this.activeDrain;
    const run = this.drainBatches(Math.min(limit, this.batchSize), options)
      .then((summary) => {
        this.scheduleNextPendingAttempt();
        return summary;
      })
      .finally(() => {
        if (this.activeDrain === run) this.activeDrain = null;
      });
    this.activeDrain = run;
    return run;
  }

  private async drainBatches(
    batchSize: number,
    options?: SyncMutationOptions,
  ): Promise<SyncPushSummary> {
    let total: SyncPushSummary | null = null;
    let remaining = this.maxOperationsPerPass;
    while (remaining > 0) {
      const summary = await this.drainOnce(Math.min(batchSize, remaining), options);
      total = total ? mergeSummaries(total, summary) : summary;
      remaining -= summary.claimed;
      if (summary.claimed < batchSize) break;
    }
    return total ?? emptySummary(this.outbox.counts().pending);
  }

  private async drainOnce(limit: number, options?: SyncMutationOptions): Promise<SyncPushSummary> {
    // Checked before claiming, not per row: a paused queue should not churn
    // leases it has no intention of using.
    const pause = resolvePauseState((await this.config.read()).sync.pausedUntil);
    if (pause.paused) {
      this.scheduleRetryWake(pause.until.getTime());
      return emptySummary(this.outbox.counts().pending);
    }

    const claims = this.outbox.claimDue(limit, this.now());
    if (claims.length === 0) return emptySummary(this.outbox.counts().pending);

    const tally = {
      succeeded: 0,
      skipped: 0,
      retrying: 0,
      needsReauth: 0,
      deadLettered: 0,
      released: 0,
      superseded: 0,
      deferred: 0,
    };
    const failures: string[] = [];

    /**
     * Once a tracker says "come back later", every remaining row for that
     * tracker in this batch is deferred without asking again.
     *
     * Deciding this per row is what turned one drain of 25 rows into 25
     * requests the server had already refused — the limit is a property of the
     * connection, not of any single payload.
     */
    const backOffUntil = new Map<TrackerId, Date>();

    for (const claim of claims) {
      const blocked = backOffUntil.get(claim.trackerId);
      if (blocked) {
        this.outbox.defer({ item: claim, notBefore: blocked, errorCode: "rate-limited" });
        tally.deferred += 1;
        continue;
      }

      const result = await this.deliver(claim, options);
      if (result.transition === "superseded") tally.superseded += 1;
      else tally[result.bucket] += 1;
      if (result.failure) failures.push(result.failure);
      if (result.retryAfterMs !== undefined) {
        backOffUntil.set(claim.trackerId, new Date(this.now().getTime() + result.retryAfterMs));
      }
    }

    const failed = tally.retrying + tally.needsReauth + tally.deadLettered;
    this.lastPushFailed = failed > 0;

    return {
      connected: this.getConnectedAdapters().length,
      claimed: claims.length,
      ...tally,
      failed,
      pending: this.outbox.counts().pending,
      failures,
    };
  }

  private async deliver(
    claim: SyncOutboxClaim,
    options?: SyncMutationOptions,
  ): Promise<{
    transition: string;
    bucket:
      | "succeeded"
      | "skipped"
      | "retrying"
      | "needsReauth"
      | "deadLettered"
      | "released"
      | "deferred";
    failure?: string;
    retryAfterMs?: number;
  }> {
    const parsed = parseTrackerOperation(claim.payload);
    if (!parsed.ok) {
      // Unparseable rows can never succeed, and the payload is exactly what must
      // not be logged — only the bounded code is recorded.
      this.outbox.deadLetter({ item: claim, errorCode: parsed.code });
      this.diagnostics?.record({
        category: "sync",
        message: "Dead-lettered unparseable tracker operation",
        context: { tracker: claim.trackerId, code: parsed.code },
      });
      return { transition: "applied", bucket: "deadLettered", failure: parsed.code };
    }

    const operation = parsed.operation;
    const adapter = this.adaptersById.get(trackerOf(operation));
    if (!adapter) {
      this.outbox.deadLetter({ item: claim, errorCode: "tracker-unknown" });
      return { transition: "applied", bucket: "deadLettered", failure: "tracker-unknown" };
    }
    if (!adapter.capabilities[requiredCapability(operation)]) {
      this.outbox.deadLetter({ item: claim, errorCode: "capability-unsupported" });
      return { transition: "applied", bucket: "deadLettered", failure: "capability-unsupported" };
    }

    // Re-read config here, immediately before the external call, so disabling a
    // tracker stops the very next write instead of the next session.
    const gate = (await this.config.read()).sync[adapter.id];
    if (!gate?.enabled || !allowedByConfig(operation, gate)) {
      // Legacy rows may predate opt-in. Hold them briefly rather than putting
      // them straight back at the head of every batch, where they could starve
      // another eligible tracker forever.
      this.outbox.hold({
        item: claim,
        notBefore: new Date(this.now().getTime() + DISABLED_RECHECK_MS),
        errorCode: "disabled-by-config",
        now: this.now(),
      });
      return { transition: "applied", bucket: "released" };
    }

    const outcome = await this.applyWithShutdown(adapter, operation, options);
    return this.recordOutcome(claim, adapter, outcome);
  }

  /**
   * Compose the caller's signal with the service shutdown signal, so an orderly
   * quit cancels in-flight adapter work rather than waiting it out.
   */
  private async applyWithShutdown(
    adapter: SyncAdapter,
    operation: TrackerOperation,
    options?: SyncMutationOptions,
  ): Promise<SyncOutcome> {
    if (this.shutdownController.signal.aborted) return syncCancelled("shutdown");
    const signals = [this.shutdownController.signal];
    if (options?.signal) signals.push(options.signal);
    try {
      return await adapter.apply(operation, { signal: AbortSignal.any(signals) });
    } catch (error) {
      return {
        status: "failed",
        code: "adapter-threw",
        kind: "network",
        retryable: true,
        detail: error instanceof Error ? error.name : "unknown",
      };
    }
  }

  private recordOutcome(
    claim: SyncOutboxClaim,
    adapter: SyncAdapter,
    outcome: SyncOutcome,
  ): {
    transition: string;
    bucket:
      | "succeeded"
      | "skipped"
      | "retrying"
      | "needsReauth"
      | "deadLettered"
      | "released"
      | "deferred";
    failure?: string;
    /** Set only when the tracker named a wait, so the drain can stop asking. */
    retryAfterMs?: number;
  } {
    const label = (code: string) => `${adapter.displayName}: ${code}`;
    switch (outcome.status) {
      case "ok":
        return { transition: this.outbox.complete(claim), bucket: "succeeded" };
      case "skipped":
        return { transition: this.outbox.complete(claim), bucket: "skipped" };
      case "cancelled":
        // Cancellation is not failure: the claim goes back untouched so an
        // orderly shutdown cannot walk a row toward dead-letter.
        return { transition: this.outbox.release(claim, this.now()), bucket: "released" };
      case "rate-limited":
        return {
          transition: this.outbox.defer({
            item: claim,
            notBefore: new Date(this.now().getTime() + outcome.retryAfterMs),
            errorCode: "rate-limited",
            now: this.now(),
          }),
          bucket: "deferred",
          retryAfterMs: outcome.retryAfterMs,
        };
      case "needs-reauth":
        return {
          transition: this.outbox.requireReauth({
            item: claim,
            errorCode: outcome.code,
            ...(outcome.detail ? { errorDetail: outcome.detail } : {}),
          }),
          bucket: "needsReauth",
          failure: label(outcome.code),
        };
      case "failed":
        if (outcome.retryable) {
          return {
            transition: this.outbox.retry({
              item: claim,
              errorCode: outcome.code,
              now: this.now(),
              ...(outcome.detail ? { errorDetail: outcome.detail } : {}),
            }),
            bucket: "retrying",
            failure: label(outcome.code),
          };
        }
        return {
          transition: this.outbox.deadLetter({
            item: claim,
            errorCode: outcome.code,
            ...(outcome.detail ? { errorDetail: outcome.detail } : {}),
          }),
          bucket: "deadLettered",
          failure: label(outcome.code),
        };
    }
  }

  async refreshIdentities(options?: SyncMutationOptions): Promise<void> {
    const signals = [this.shutdownController.signal];
    if (options?.signal) signals.push(options.signal);
    const signal = AbortSignal.any(signals);
    await Promise.all(
      this.adapters.map(async (adapter) => {
        try {
          await adapter.refreshIdentity({ signal });
        } catch {
          // Identity is presentational; a failure here must not block delivery.
        }
      }),
    );
  }

  /** Unpark rows that were waiting on this tracker's credentials. */
  resumeAfterReauth(trackerId: TrackerId): number {
    return this.outbox.resetNeedsReauth(trackerId);
  }

  private scheduleNextPendingAttempt(): void {
    const nextAttemptAt = this.outbox.nextPendingAttemptAt();
    if (!nextAttemptAt) {
      this.clearRetryWake();
      return;
    }
    const wakeAt = Date.parse(nextAttemptAt);
    if (Number.isFinite(wakeAt)) this.scheduleRetryWake(wakeAt);
  }

  private scheduleRetryWake(wakeAt: number): void {
    if (this.shutdownController.signal.aborted) return;
    if (this.retryWakeAt !== undefined && this.retryWakeAt <= wakeAt) return;
    this.clearRetryWake();
    this.retryWakeAt = wakeAt;
    this.retryWakeCancel = this.scheduleWake(
      () => {
        this.retryWakeAt = undefined;
        this.retryWakeCancel = undefined;
        if (!this.shutdownController.signal.aborted) this.deliverSoon();
      },
      Math.max(1, wakeAt - this.now().getTime()),
    );
  }

  private clearRetryWake(): void {
    this.retryWakeCancel?.();
    this.retryWakeCancel = undefined;
    this.retryWakeAt = undefined;
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  /**
   * Stop accepting, cancel in-flight work, and wait for the active drain to
   * settle. Storage is closed by `dispose-container`, after this resolves — a
   * drain still holding the database would fault on a closed handle.
   */
  async shutdown(): Promise<void> {
    this.stopAccepting();
    this.shutdownController.abort(SYNC_SHUTDOWN_REASON);
    this.clearRetryWake();
    try {
      await this.activeDrain;
    } catch {
      // Shutdown is best-effort: a failing drain must not block disposal.
    }
  }
}
