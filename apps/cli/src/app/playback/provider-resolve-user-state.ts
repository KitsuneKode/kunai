import type { PlaybackProblem } from "@/domain/playback/playback-problem";

export type ProviderResolveUserState =
  | "slow-source"
  | "trying-another-source"
  | "using-cached-source"
  | "provider-title-issue"
  | "network-unstable"
  | "no-playable-source";

export type ProviderResolveUserStateCopy = {
  readonly state: ProviderResolveUserState;
  readonly title: string;
  readonly detail: string;
};

/**
 * What the resolve pipeline actually observed.
 *
 * Every field is structured state the pipeline already holds. This classifier
 * deliberately does **not** accept a prose `issue` string: it previously
 * substring-matched one, and the healthy-path advisory note "Recoverable
 * provider failures retry before fallback." contains the word `fallback`, so a
 * successful resolve rendered "Trying another source" in an alarm colour.
 *
 * Copy is derived from state. State is never re-derived from copy.
 */
export type ProviderResolveUserStateInput = {
  /** Structured problem from the resolve pipeline. Authoritative when present. */
  readonly problem?: PlaybackProblem | null;
  /** True only once fallback to another provider has actually started. */
  readonly fallbackInProgress?: boolean;
  /** True only when a refresh failed and the last cached stream was reused. */
  readonly servedFromCacheAfterFailure?: boolean;
  /** Wall time spent resolving so far. */
  readonly elapsedSeconds?: number;
};

/** Resolve wall time past which the wait itself is worth surfacing. */
const SLOW_RESOLVE_SECONDS = 20;

/**
 * `PlaybackProblem.cause` values that describe a local connectivity fault
 * rather than a provider fault. Blaming a source for these misleads the user.
 */
const NETWORK_CAUSES = new Set(["network-offline", "network"]);

/** Causes that mean this provider cannot serve this title right now. */
const PROVIDER_TITLE_CAUSES = new Set(["provider-session", "provider-access", "provider-blocked"]);

/** Causes that mean nothing playable was produced at all. */
const NO_SOURCE_CAUSES = new Set(["no-stream", "runtime-missing", "yt-dlp-missing"]);

/** Causes that mean the provider is responding, just slowly. */
const SLOW_CAUSES = new Set(["provider-timeout", "network-buffering"]);

function classifyProblem(problem: PlaybackProblem): ProviderResolveUserStateCopy | null {
  if (NETWORK_CAUSES.has(problem.cause)) {
    return {
      state: "network-unstable",
      title: "Network looks unstable",
      detail:
        "Kunai paused provider fallback so a local connection problem is not blamed on a source.",
    };
  }
  if (NO_SOURCE_CAUSES.has(problem.cause)) {
    return {
      state: "no-playable-source",
      title: "No playable source found",
      detail:
        "No confirmed stream is available for this selection. Try another source or provider.",
    };
  }
  if (PROVIDER_TITLE_CAUSES.has(problem.cause)) {
    return {
      state: "provider-title-issue",
      title: "Provider issue for this title",
      detail:
        "This provider has failed repeatedly for this title; other titles may still work normally.",
    };
  }
  if (SLOW_CAUSES.has(problem.cause)) {
    return {
      state: "slow-source",
      title: "Slow source",
      detail: "This source is taking longer than expected. You can wait or try another source.",
    };
  }
  return null;
}

/**
 * Classify what to tell the user about an in-flight or failed resolve.
 *
 * Returns `null` when nothing noteworthy happened — a healthy resolve must
 * produce no alarm state at all.
 */
export function classifyProviderResolveUserState(
  input: ProviderResolveUserStateInput,
): ProviderResolveUserStateCopy | null {
  // A structured problem is real evidence and outranks every heuristic below,
  // including the slow-wait timer — a blocking failure at 45s is a failure,
  // not a slow source.
  if (input.problem) {
    const fromProblem = classifyProblem(input.problem);
    if (fromProblem) return fromProblem;
  }

  if (input.fallbackInProgress) {
    return {
      state: "trying-another-source",
      title: "Trying another source",
      detail:
        "The previous source did not resolve cleanly. Kunai is trying a compatible alternative.",
    };
  }

  if (input.servedFromCacheAfterFailure) {
    return {
      state: "using-cached-source",
      title: "Using cached source",
      detail: "The fresh lookup failed, so Kunai kept the last playable cached stream.",
    };
  }

  // A long wait is a true observation about elapsed time. It deliberately does
  // not assert that the source failed — nothing here is evidence of failure.
  if ((input.elapsedSeconds ?? 0) >= SLOW_RESOLVE_SECONDS) {
    return {
      state: "slow-source",
      title: "Slow source",
      detail: "This source is taking longer than expected. You can wait or try another source.",
    };
  }

  return null;
}
