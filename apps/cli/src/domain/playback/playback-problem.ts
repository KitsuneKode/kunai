import type { PlaybackFailureClass } from "@/infra/player/playback-failure-classifier";
import { classifyProviderFailure, isOfflineNetworkFailure } from "@kunai/core";
import type { ProviderFailure } from "@kunai/types";

export type ErrorScenario =
  | { kind: "provider-timeout"; providerName: string; elapsedSec: number }
  | { kind: "stream-broken"; attempt: number; maxAttempts: number }
  | { kind: "network-offline" }
  | { kind: "provider-session"; providerName: string }
  | { kind: "title-unavailable"; title: string };

export type PlaybackProblemStage =
  | "provider-resolve"
  | "stream-open"
  | "mpv"
  | "subtitle"
  | "history";

export type PlaybackProblemSeverity = "info" | "recoverable" | "blocking";

export type PlaybackProblemAction =
  | "wait"
  | "refresh"
  | "pick-stream"
  | "relaunch"
  | "try-next-provider"
  | "settings"
  | "diagnostics";

export interface PlaybackProblem {
  readonly stage: PlaybackProblemStage;
  readonly severity: PlaybackProblemSeverity;
  readonly cause: string;
  readonly userMessage: string;
  readonly recommendedAction: PlaybackProblemAction;
  readonly secondaryActions: readonly PlaybackProblemAction[];
  readonly diagnosticId?: string;
}

export function buildMpvMissingProblem(input: {
  readonly remediationSummary: string;
  readonly commands: readonly string[];
}): PlaybackProblem {
  const commandHint = input.commands[0] ?? "Install mpv";
  return {
    stage: "mpv",
    severity: "blocking",
    cause: "mpv-missing",
    userMessage: `mpv is required for playback. ${input.remediationSummary} Try: ${commandHint}`,
    recommendedAction: "settings",
    secondaryActions: ["diagnostics"],
  };
}

/**
 * The library still advertises a title as downloaded, but nothing playable
 * resolved for it — a deleted, moved, or truncated artifact.
 *
 * Dispatched as a problem rather than playback feedback: the offline bail-out
 * runs inside a method whose `finally` clears detail and note, so a feedback
 * note is erased before it renders and the user lands back on results with no
 * reason given.
 */
export function buildOfflineFileUnavailableProblem(): PlaybackProblem {
  return {
    stage: "stream-open",
    severity: "blocking",
    cause: "offline-file-unavailable",
    userMessage:
      "Downloaded file unavailable. Run an integrity check on it in the offline library, or download it again.",
    recommendedAction: "diagnostics",
    secondaryActions: ["refresh"],
  };
}

/** A verified artifact reached mpv, but the local player handoff itself failed. */
export function buildLocalPlaybackFailureProblem(): PlaybackProblem {
  return {
    stage: "mpv",
    severity: "blocking",
    cause: "local-playback-failed",
    userMessage:
      "The downloaded file was found, but mpv could not open it. Open Diagnostics for the exact player error.",
    recommendedAction: "diagnostics",
    secondaryActions: ["relaunch"],
  };
}

export function buildProviderResolveProblem({
  attempts,
  fallbackAvailable = true,
  hasStreamCandidates = false,
}: {
  attempts: readonly {
    readonly failure?:
      | {
          readonly providerId?: string;
          readonly code?: string;
          readonly message?: string;
        }
      | undefined;
  }[];
  capabilitySnapshot?: unknown;
  /**
   * False when every compatible provider already ran (or none is compatible):
   * offering "try the next provider" then is a dead end.
   */
  readonly fallbackAvailable?: boolean;
  /** False when no attempt produced streams or sources the picker could show. */
  readonly hasStreamCandidates?: boolean;
}): PlaybackProblem {
  if (hasRuntimeMissingFailure(attempts)) {
    return {
      stage: "provider-resolve",
      severity: "blocking",
      cause: "runtime-missing",
      userMessage: "A provider runtime dependency is missing. Open Diagnostics for details.",
      recommendedAction: "diagnostics",
      secondaryActions: [],
    };
  }

  if (hasYtDlpMissingFailure(attempts)) {
    return {
      stage: "provider-resolve",
      severity: "blocking",
      cause: "yt-dlp-missing",
      userMessage: "yt-dlp is required for YouTube playback. Install yt-dlp, then refresh.",
      recommendedAction: "settings",
      secondaryActions: ["diagnostics"],
    };
  }

  const fallbackActions: readonly PlaybackProblemAction[] = fallbackAvailable
    ? ["try-next-provider", "diagnostics"]
    : ["diagnostics"];
  const tryNextAction: PlaybackProblemAction = fallbackAvailable
    ? "try-next-provider"
    : "diagnostics";
  const streamAction: PlaybackProblemAction = hasStreamCandidates ? "pick-stream" : tryNextAction;

  if (attempts.some((attempt) => hasOfflineSignature(attempt.failure))) {
    return {
      stage: "provider-resolve",
      severity: "blocking",
      cause: "network-offline",
      userMessage: "Internet unavailable. Online providers cannot be reached right now.",
      recommendedAction: "diagnostics",
      secondaryActions: ["refresh"],
    };
  }

  const sessionFailure = findSessionFailure(attempts);
  if (sessionFailure) {
    const providerName = sessionFailure.providerId
      ? formatProviderDisplayName(sessionFailure.providerId)
      : "This provider";
    return {
      stage: "provider-resolve",
      severity: "blocking",
      cause: "provider-session",
      userMessage: `${providerName} needs a saved browser session before this source can resolve.`,
      recommendedAction: "settings",
      secondaryActions: fallbackActions,
    };
  }

  // The last *meaningful* failure is why the chain exhausted — earlier
  // providers already fell back, so their complaints are context, not cause.
  const last = lastMeaningfulFailure(attempts);
  const classification = last ? classifyProviderFailure(last) : undefined;

  switch (classification?.failureClass) {
    case "timeout":
      return {
        stage: "provider-resolve",
        severity: "recoverable",
        cause: "provider-timeout",
        userMessage: classification.userSummary,
        recommendedAction: "refresh",
        secondaryActions: fallbackActions,
      };
    case "network":
      return {
        stage: "provider-resolve",
        severity: "recoverable",
        cause: "network",
        userMessage: classification.userSummary,
        recommendedAction: "refresh",
        secondaryActions: fallbackActions,
      };
    case "rate-limited":
    case "blocked":
      return {
        stage: "provider-resolve",
        severity: "recoverable",
        cause: "provider-access",
        userMessage: classification.userSummary,
        recommendedAction: tryNextAction,
        secondaryActions: ["diagnostics"],
      };
    case "provider-empty":
    case "provider-parse":
    case "expired-stream":
    case "unsupported-title":
    case "sub-dub-mismatch":
    case "title-episode-gap":
      return {
        stage: "provider-resolve",
        severity: "blocking",
        cause: "no-stream",
        userMessage: classification.userSummary,
        recommendedAction: streamAction,
        secondaryActions: fallbackActions,
      };
    default:
      return {
        stage: "provider-resolve",
        severity: "blocking",
        cause: "no-stream",
        userMessage: "No playable stream was found for this episode.",
        recommendedAction: streamAction,
        secondaryActions: fallbackActions,
      };
  }
}

export function buildPlayerFailureProblem(failureClass: PlaybackFailureClass): PlaybackProblem {
  switch (failureClass) {
    case "network-buffering":
      return {
        stage: "mpv",
        severity: "info",
        cause: "network-buffering",
        userMessage: "The stream is buffering while mpv fills its cache.",
        recommendedAction: "wait",
        secondaryActions: ["refresh", "diagnostics"],
      };
    case "slow-stream":
      return {
        stage: "mpv",
        severity: "info",
        cause: "network-buffering",
        userMessage: "The stream is playing slowly while mpv waits for more data.",
        recommendedAction: "wait",
        secondaryActions: ["refresh", "diagnostics"],
      };
    case "expired-stream":
      return {
        stage: "mpv",
        severity: "recoverable",
        cause: "expired-stream",
        userMessage: "The stream URL or segment lease may have expired.",
        recommendedAction: "refresh",
        secondaryActions: ["pick-stream", "try-next-provider", "diagnostics"],
      };
    case "seek-stuck":
      return {
        stage: "mpv",
        severity: "recoverable",
        cause: "seek-stuck",
        userMessage: "mpv got stuck while seeking.",
        recommendedAction: "refresh",
        secondaryActions: ["relaunch", "diagnostics"],
      };
    case "ipc-stuck":
      return {
        stage: "mpv",
        severity: "recoverable",
        cause: "ipc-stuck",
        userMessage: "Kunai lost reliable control of mpv.",
        recommendedAction: "relaunch",
        secondaryActions: ["diagnostics"],
      };
    case "player-exited":
      return {
        stage: "mpv",
        severity: "recoverable",
        cause: "player-exited",
        userMessage: "mpv exited before Kunai could confirm normal playback completion.",
        recommendedAction: "relaunch",
        secondaryActions: ["try-next-provider", "diagnostics"],
      };
    case "unknown":
      return {
        stage: "mpv",
        severity: "recoverable",
        cause: "unknown",
        userMessage: "Playback ended for an unclear reason.",
        recommendedAction: "diagnostics",
        secondaryActions: ["refresh", "relaunch"],
      };
    case "none":
      return {
        stage: "mpv",
        severity: "info",
        cause: "none",
        userMessage: "No playback problem detected.",
        recommendedAction: "wait",
        secondaryActions: [],
      };
    default:
      return {
        stage: "mpv",
        severity: "recoverable",
        cause: "unknown",
        userMessage: "Playback ended for an unclear reason.",
        recommendedAction: "diagnostics",
        secondaryActions: ["refresh", "relaunch"],
      };
  }
}

export type ErrorScenarioContext = {
  readonly providerName?: string;
  readonly title?: string;
  readonly resolveRetryCount?: number;
};

export function toErrorScenario(
  problem: PlaybackProblem | null | undefined,
  context: ErrorScenarioContext = {},
): ErrorScenario | undefined {
  if (!problem) return undefined;

  const attempt = Math.max(1, (context.resolveRetryCount ?? 0) + 1);

  switch (problem.cause) {
    case "provider-timeout":
      return {
        kind: "provider-timeout",
        providerName: context.providerName ?? "provider",
        elapsedSec: 30,
      };
    case "network":
    case "network-offline":
      return { kind: "network-offline" };
    case "provider-session":
      return {
        kind: "provider-session",
        providerName: context.providerName ?? "provider",
      };
    case "no-stream":
    case "provider-access":
    // An unplayable download is the same shape of dead end as a title no
    // provider can serve: the thing the user asked for is not obtainable right
    // now. Without this case the switch fell through to `undefined`, and the
    // shell rendered the bare `⚠ issue · offline-file-unavailable` slug instead
    // of the error surface every other blocking failure gets.
    case "offline-file-unavailable":
    case "local-playback-failed":
      return {
        kind: "title-unavailable",
        title: context.title ?? extractUnavailableTitle(problem.userMessage),
      };
    case "expired-stream":
    case "seek-stuck":
    case "ipc-stuck":
    case "player-exited":
    case "network-buffering":
      return { kind: "stream-broken", attempt, maxAttempts: 3 };
    default:
      return undefined;
  }
}

function extractUnavailableTitle(message: string): string {
  const quoted = message.match(/"([^"]+)"/);
  if (quoted?.[1]) return quoted[1];
  return "This title";
}

function hasRuntimeMissingFailure(
  attempts: readonly {
    readonly failure?: { readonly code?: string; readonly message?: string } | undefined;
  }[],
): boolean {
  return attempts.some((attempt) => {
    const code = attempt.failure?.code?.toLowerCase() ?? "";
    const message = attempt.failure?.message?.toLowerCase() ?? "";
    return code === "runtime_missing" || message.includes("runtime dependency");
  });
}

function hasYtDlpMissingFailure(
  attempts: readonly {
    readonly failure?: { readonly code?: string; readonly message?: string } | undefined;
  }[],
): boolean {
  return attempts.some((attempt) => {
    const code = attempt.failure?.code?.toLowerCase() ?? "";
    const message = attempt.failure?.message?.toLowerCase() ?? "";
    return code === "yt-dlp-missing" || message.includes("yt-dlp");
  });
}

function hasOfflineSignature(
  failure: { readonly code?: string; readonly message?: string } | undefined,
): boolean {
  return Boolean(
    failure?.message &&
    isOfflineNetworkFailure({
      code: (failure.code as ProviderFailure["code"]) ?? "unknown",
      message: failure.message,
    }),
  );
}

const SESSION_GUARD_PATTERN =
  /session_missing|session_invalid|session_expired|turnstile_failed|guarded_session_invalid|valid browser session|x-session-token|videasy session/i;

function findSessionFailure(
  attempts: readonly {
    readonly failure?: { readonly providerId?: string; readonly message?: string } | undefined;
  }[],
): { readonly providerId?: string; readonly message?: string } | undefined {
  return attempts.find((attempt) => SESSION_GUARD_PATTERN.test(attempt.failure?.message ?? ""))
    ?.failure;
}

/**
 * The last non-noise failure in candidate order. Aborted attempts carry no
 * failure at all, and a bare "unknown" from an early provider must not shadow
 * the typed failure that actually exhausted the chain.
 */
function lastMeaningfulFailure(
  attempts: readonly {
    readonly failure?:
      | {
          readonly providerId?: string;
          readonly code?: string;
          readonly message?: string;
        }
      | undefined;
  }[],
): { readonly providerId?: string; readonly code?: string; readonly message?: string } | undefined {
  const failures = attempts.flatMap((attempt) => (attempt.failure ? [attempt.failure] : []));
  if (failures.length === 0) return undefined;
  const meaningful = failures.findLast((failure) => {
    if (failure.code && failure.code !== "unknown") return true;
    const cls = classifyProviderFailure(failure);
    return cls.failureClass !== "unknown" && cls.failureClass !== "user-cancelled";
  });
  return meaningful ?? failures.at(-1);
}

function formatProviderDisplayName(providerId: string): string {
  return providerId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
