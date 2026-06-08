import type { EpisodeInfo, StreamInfo, TitleInfo } from "@/domain/types";
import type { StartupPriority } from "@kunai/types";

/** Maximum extended handoff wait after concrete readiness progress. */
export const EPISODE_PREFETCH_WAIT_BUDGET_MS = 8_000;
export const EPISODE_PREFETCH_DEFAULT_WAIT_BUDGET_MS = 3_000;

export type EpisodePrefetchTarget = {
  readonly titleId: string;
  readonly episode: EpisodeInfo;
  readonly providerId: string;
  readonly sourceId?: string;
  readonly streamId?: string;
  readonly audioPreference?: string;
  readonly qualityPreference?: string;
  readonly startupPriority?: StartupPriority;
  readonly subtitlePreference?: string;
};

export type EpisodePrefetchBundle = {
  readonly target: EpisodePrefetchTarget;
  readonly stream: StreamInfo;
  /** When true, subtitle selection already ran during prefetch. */
  readonly prepared: boolean;
};

export type EpisodePrefetchWaitOutcome = "ready" | "completed" | "timed-out" | "none";

export type EpisodePrefetchWaitResult = {
  readonly bundle: EpisodePrefetchBundle | null;
  readonly outcome: EpisodePrefetchWaitOutcome;
  readonly waitedMs: number;
};

export type EpisodePrefetchProgress = {
  readonly exactStreamCacheHit?: boolean;
  readonly sourceInventoryHit?: boolean;
  readonly candidateStreamsReturned?: boolean;
  readonly providerResolveActive?: boolean;
  readonly fallbackAttemptStarted?: boolean;
  readonly streamValidationActive?: boolean;
  readonly videoReady?: boolean;
  readonly timingReady?: boolean;
  readonly subtitleReady?: boolean;
};

export function episodePrefetchKey(titleId: string, episode: EpisodeInfo): string {
  return `${titleId}:${episode.season}:${episode.episode}`;
}

export function matchesEpisodePrefetchTarget(
  target: EpisodePrefetchTarget,
  requested: EpisodePrefetchTarget,
): boolean {
  if (
    target.titleId !== requested.titleId ||
    target.episode.season !== requested.episode.season ||
    target.episode.episode !== requested.episode.episode ||
    target.providerId !== requested.providerId ||
    target.sourceId !== requested.sourceId ||
    target.streamId !== requested.streamId ||
    target.audioPreference !== requested.audioPreference ||
    target.qualityPreference !== requested.qualityPreference ||
    (target.startupPriority ?? "balanced") !== (requested.startupPriority ?? "balanced")
  ) {
    return false;
  }
  // Subtitle pref mismatch is handled softly in takeReadyFor (reuse video, re-prep subs).
  return true;
}

export function prefetchTargetSubtitleMatches(
  target: EpisodePrefetchTarget,
  requested: EpisodePrefetchTarget,
): boolean {
  return (target.subtitlePreference ?? "none") === (requested.subtitlePreference ?? "none");
}

export function resolveEpisodePrefetchWaitBudget(progress?: EpisodePrefetchProgress): number {
  if (
    progress?.exactStreamCacheHit ||
    progress?.sourceInventoryHit ||
    progress?.candidateStreamsReturned ||
    progress?.providerResolveActive ||
    progress?.fallbackAttemptStarted ||
    progress?.streamValidationActive ||
    progress?.videoReady
  ) {
    return EPISODE_PREFETCH_WAIT_BUDGET_MS;
  }
  return EPISODE_PREFETCH_DEFAULT_WAIT_BUDGET_MS;
}

export function isEpisodePrefetchEligible(input: {
  readonly titleType: TitleInfo["type"];
  readonly hasNextEpisode: boolean;
  readonly stopAfterCurrent: boolean;
  readonly sessionMode: "manual" | "autoplay-chain";
  readonly autoplayPaused: boolean;
}): boolean {
  if (input.titleType !== "series" || !input.hasNextEpisode) return false;
  if (input.stopAfterCurrent) return false;
  if (input.sessionMode === "autoplay-chain" && input.autoplayPaused) return false;
  return true;
}

/**
 * Owns next-episode prefetch lifecycle: schedule, abort, keyed wait, and consume-ready.
 */
export class EpisodePrefetchHandle {
  private generation = 0;
  private abortController: AbortController | null = null;
  private inFlight: Promise<EpisodePrefetchBundle | null> | null = null;
  private ready: EpisodePrefetchBundle | null = null;
  private activeTarget: EpisodePrefetchTarget | null = null;

  cancel(_reason: string): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.inFlight = null;
    this.ready = null;
    this.activeTarget = null;
  }

  hasReadyFor(target: EpisodePrefetchTarget): boolean {
    return this.ready !== null && matchesEpisodePrefetchTarget(this.ready.target, target);
  }

  takeReadyFor(target: EpisodePrefetchTarget): EpisodePrefetchBundle | null {
    if (!this.ready) return null;
    if (!matchesEpisodePrefetchTarget(this.ready.target, target)) {
      return null;
    }
    const bundle = !prefetchTargetSubtitleMatches(this.ready.target, target)
      ? { ...this.ready, target, prepared: false }
      : this.ready;
    this.ready = null;
    this.activeTarget = null;
    return bundle;
  }

  isInFlightFor(target: EpisodePrefetchTarget): boolean {
    return (
      this.inFlight !== null &&
      this.activeTarget !== null &&
      matchesEpisodePrefetchTarget(this.activeTarget, target)
    );
  }

  schedule(
    target: EpisodePrefetchTarget,
    run: (signal: AbortSignal) => Promise<EpisodePrefetchBundle | null>,
    options?: { readonly force?: boolean },
  ): void {
    if (!options?.force && this.hasReadyFor(target)) return;
    if (!options?.force && this.isInFlightFor(target)) return;

    this.generation += 1;
    const generation = this.generation;
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.activeTarget = target;
    this.ready = null;

    this.inFlight = (async () => {
      try {
        const bundle = await run(abortController.signal);
        if (generation !== this.generation) return null;
        if (bundle && matchesEpisodePrefetchTarget(bundle.target, target)) {
          this.ready = bundle;
          return bundle;
        }
        return null;
      } catch (error) {
        if (isAbortLike(error) || abortController.signal.aborted) return null;
        throw error;
      } finally {
        if (generation === this.generation) {
          this.inFlight = null;
          if (this.abortController === abortController) {
            this.abortController = null;
          }
        }
      }
    })();
  }

  async awaitFor(
    target: EpisodePrefetchTarget,
    run: (signal: AbortSignal) => Promise<EpisodePrefetchBundle | null>,
    budgetMs: number,
  ): Promise<EpisodePrefetchWaitResult> {
    const startedAt = Date.now();
    const immediate = this.peekReady(target);
    if (immediate) {
      return { bundle: immediate, outcome: "ready", waitedMs: 0 };
    }

    if (!this.isInFlightFor(target)) {
      this.schedule(target, run, { force: true });
    }

    const promise = this.inFlight;
    if (!promise) {
      return { bundle: null, outcome: "none", waitedMs: Date.now() - startedAt };
    }

    const outcome = await racePromiseWithTimeout(promise, budgetMs);
    const waitedMs = Date.now() - startedAt;
    const bundle = this.peekReady(target);
    return {
      bundle,
      outcome: bundle ? (outcome === "timed-out" ? "ready" : outcome) : outcome,
      waitedMs,
    };
  }

  private peekReady(target: EpisodePrefetchTarget): EpisodePrefetchBundle | null {
    if (!this.ready) return null;
    if (!matchesEpisodePrefetchTarget(this.ready.target, target)) {
      return null;
    }
    return this.ready;
  }
}

async function racePromiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<"completed" | "timed-out"> {
  try {
    return await Promise.race([
      promise.then(() => "completed" as const),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), timeoutMs)),
    ]);
  } catch {
    return "completed";
  }
}

function isAbortLike(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

export async function adoptEpisodePrefetchBundle(input: {
  readonly handle: EpisodePrefetchHandle;
  readonly target: EpisodePrefetchTarget;
  readonly run: (signal: AbortSignal) => Promise<EpisodePrefetchBundle | null>;
  readonly budgetMs?: number;
  readonly progress?: EpisodePrefetchProgress;
  readonly getProgress?: () => EpisodePrefetchProgress | undefined;
  readonly onWaiting?: () => void;
  readonly recordWait?: (result: EpisodePrefetchWaitResult) => void;
}): Promise<EpisodePrefetchBundle | null> {
  const budgetMs =
    input.budgetMs ?? resolveEpisodePrefetchWaitBudget(input.getProgress?.() ?? input.progress);
  const shouldAnnounceWait =
    input.handle.hasReadyFor(input.target) || input.handle.isInFlightFor(input.target);
  if (shouldAnnounceWait) {
    input.onWaiting?.();
  }

  const wait = await input.handle.awaitFor(input.target, input.run, budgetMs);
  input.recordWait?.(wait);
  return wait.bundle;
}
