import type { EpisodeInfo, StreamInfo, TitleInfo } from "@/domain/types";

/** Max time to wait for an in-flight next-episode prefetch before foreground resolve. */
export const EPISODE_PREFETCH_WAIT_BUDGET_MS = 8_000;

export type EpisodePrefetchTarget = {
  readonly titleId: string;
  readonly episode: EpisodeInfo;
  readonly providerId: string;
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

export function episodePrefetchKey(titleId: string, episode: EpisodeInfo): string {
  return `${titleId}:${episode.season}:${episode.episode}`;
}

export function matchesEpisodePrefetchTarget(
  target: EpisodePrefetchTarget,
  titleId: string,
  episode: EpisodeInfo,
  providerId: string,
): boolean {
  return (
    target.titleId === titleId &&
    target.episode.season === episode.season &&
    target.episode.episode === episode.episode &&
    target.providerId === providerId
  );
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
    return (
      this.ready !== null &&
      matchesEpisodePrefetchTarget(
        this.ready.target,
        target.titleId,
        target.episode,
        target.providerId,
      )
    );
  }

  takeReadyFor(
    titleId: string,
    episode: EpisodeInfo,
    providerId: string,
  ): EpisodePrefetchBundle | null {
    if (!this.ready) return null;
    if (!matchesEpisodePrefetchTarget(this.ready.target, titleId, episode, providerId)) {
      return null;
    }
    const bundle = this.ready;
    this.ready = null;
    this.activeTarget = null;
    return bundle;
  }

  isInFlightFor(target: EpisodePrefetchTarget): boolean {
    return (
      this.inFlight !== null &&
      this.activeTarget !== null &&
      matchesEpisodePrefetchTarget(
        this.activeTarget,
        target.titleId,
        target.episode,
        target.providerId,
      )
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
        if (
          bundle &&
          matchesEpisodePrefetchTarget(
            bundle.target,
            target.titleId,
            target.episode,
            target.providerId,
          )
        ) {
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
    if (
      !matchesEpisodePrefetchTarget(
        this.ready.target,
        target.titleId,
        target.episode,
        target.providerId,
      )
    ) {
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
  readonly onWaiting?: () => void;
  readonly recordWait?: (result: EpisodePrefetchWaitResult) => void;
}): Promise<EpisodePrefetchBundle | null> {
  const budgetMs = input.budgetMs ?? EPISODE_PREFETCH_WAIT_BUDGET_MS;
  const shouldAnnounceWait =
    input.handle.hasReadyFor(input.target) || input.handle.isInFlightFor(input.target);
  if (shouldAnnounceWait) {
    input.onWaiting?.();
  }

  const wait = await input.handle.awaitFor(input.target, input.run, budgetMs);
  input.recordWait?.(wait);
  return wait.bundle;
}
