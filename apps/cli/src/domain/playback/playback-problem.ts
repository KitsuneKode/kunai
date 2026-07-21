import type { PlaybackFailureClass } from "@/infra/player/playback-failure-classifier";
import { classifyNetworkFailure } from "@/services/network/NetworkStatus";

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

export function buildProviderResolveProblem({
  attempts,
}: {
  attempts: readonly {
    readonly failure?: { readonly code?: string; readonly message?: string } | undefined;
  }[];
  capabilitySnapshot?: unknown;
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

  const failureMessages = attempts
    .map((attempt) => attempt.failure?.message ?? "")
    .filter(Boolean)
    .join(" ");

  if (classifyNetworkFailure(failureMessages) === "offline") {
    return {
      stage: "provider-resolve",
      severity: "blocking",
      cause: "network-offline",
      userMessage: "Internet unavailable. Online providers cannot be reached right now.",
      recommendedAction: "diagnostics",
      secondaryActions: ["refresh"],
    };
  }

  if (/net::|ERR_INTERNET|network|ECONNREFUSED|ETIMEDOUT/i.test(failureMessages)) {
    return {
      stage: "provider-resolve",
      severity: "recoverable",
      cause: "network",
      userMessage: "Network error while resolving the stream.",
      recommendedAction: "refresh",
      secondaryActions: ["try-next-provider", "diagnostics"],
    };
  }

  if (/timeout|timed out/i.test(failureMessages)) {
    return {
      stage: "provider-resolve",
      severity: "recoverable",
      cause: "provider-timeout",
      userMessage: "The provider timed out while resolving the stream.",
      recommendedAction: "refresh",
      secondaryActions: ["try-next-provider", "diagnostics"],
    };
  }

  if (
    /session_missing|session_invalid|session_expired|turnstile_failed|guarded_session_invalid|valid browser session|x-session-token|videasy session/i.test(
      failureMessages,
    )
  ) {
    return {
      stage: "provider-resolve",
      severity: "blocking",
      cause: "provider-session",
      userMessage:
        "VidKing needs your attended Bitcine/Videasy browser session before this source can resolve.",
      recommendedAction: "settings",
      secondaryActions: ["try-next-provider", "diagnostics"],
    };
  }

  if (/403|401|auth|forbidden|unauthorized/i.test(failureMessages)) {
    return {
      stage: "provider-resolve",
      severity: "recoverable",
      cause: "provider-access",
      userMessage: "The provider returned an access error. This title may be region-locked.",
      recommendedAction: "try-next-provider",
      secondaryActions: ["diagnostics"],
    };
  }

  if (
    /no stream|stream not found|no streams found|no playable stream|no stream candidates/i.test(
      failureMessages,
    )
  ) {
    return {
      stage: "provider-resolve",
      severity: "blocking",
      cause: "no-stream",
      userMessage: "No playable stream was found for this episode.",
      recommendedAction: "pick-stream",
      secondaryActions: ["try-next-provider", "diagnostics"],
    };
  }

  return {
    stage: "provider-resolve",
    severity: "blocking",
    cause: "no-stream",
    userMessage: "No playable stream was found from the available provider attempts.",
    recommendedAction: "pick-stream",
    secondaryActions: ["try-next-provider", "diagnostics"],
  };
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
