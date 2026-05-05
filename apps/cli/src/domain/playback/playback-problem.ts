import type { PlaybackFailureClass } from "@/infra/player/playback-failure-classifier";

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

export function buildProviderResolveProblem({
  attempts,
  capabilitySnapshot,
}: {
  attempts: readonly {
    readonly failure?: { readonly code?: string; readonly message?: string } | undefined;
  }[];
  capabilitySnapshot: { readonly chromiumForEmbeds: boolean } | null;
}): PlaybackProblem {
  if (!capabilitySnapshot?.chromiumForEmbeds) {
    return {
      stage: "provider-resolve",
      severity: "blocking",
      cause: "missing-chromium",
      userMessage:
        "Playwright Chromium is not installed. Install it before embed providers can resolve streams.",
      recommendedAction: "diagnostics",
      secondaryActions: [],
    };
  }

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

  const failureMessages = attempts
    .map((attempt) => attempt.failure?.message ?? "")
    .filter(Boolean)
    .join(" ");

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

  return {
    stage: "provider-resolve",
    severity: "recoverable",
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
  }
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
