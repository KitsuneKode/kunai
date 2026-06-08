import {
  isHlsManifestUrl,
  isStreamReachableForPlaybackPreflight,
  isStreamReachableForResolve,
  probeStreamReachability,
  type StreamReachabilityFetch,
  type StreamReachabilityProbeResult,
} from "./stream-reachability";

export type StreamHealthPhase = "resolve-gate" | "cache-revalidate" | "playback-preflight";

export type StreamHealthStrategy = "none" | "hls-manifest-get" | "head-then-range";

export type StreamHealthSkipReason = "provider-attested" | "fresh-cache" | "recent-resolve";

export type StreamHealthPolicyReason =
  | "no-cache"
  | "fresh"
  | "forced-hls"
  | "forced-direct"
  | "stale-hls"
  | "stale-direct"
  | "provider-attested"
  | "recent-resolve";

export const STREAM_HEALTH_DEFAULTS = {
  staleAfterMs: 60_000,
  playbackTrustMs: 5 * 60 * 1000,
  resolveGateTimeoutMs: 3_000,
  vidkingResolveGateTimeoutMs: 2_500,
  preflightTimeoutMs: 3_000,
} as const;

export type StreamHealthPlan = {
  readonly shouldProbe: boolean;
  readonly skipReason?: StreamHealthSkipReason;
  readonly strategy: StreamHealthStrategy;
  readonly policyReason: StreamHealthPolicyReason;
  readonly timeoutMs: number;
  readonly ageMs?: number;
};

export type StreamHealthCheckInput = {
  readonly phase: StreamHealthPhase;
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly cachedAt?: number | null;
  readonly streamReachabilityVerified?: boolean;
  readonly force?: boolean;
  readonly fetchImpl?: StreamReachabilityFetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly now?: number;
  readonly staleAfterMs?: number;
  readonly playbackTrustMs?: number;
};

export type StreamHealthResult = {
  readonly healthy: boolean;
  readonly probed: boolean;
  readonly strategy: StreamHealthStrategy;
  readonly policyReason: StreamHealthPolicyReason;
  readonly skipReason?: StreamHealthSkipReason;
  readonly ageMs?: number;
  readonly probe?: StreamReachabilityProbeResult;
};

type PlanContext = {
  readonly now: number;
  readonly ageMs?: number;
  readonly staleAfterMs: number;
  readonly playbackTrustMs: number;
  readonly timeoutMs: number;
  readonly strategy: Exclude<StreamHealthStrategy, "none">;
};

export function planStreamHealth(input: StreamHealthCheckInput): StreamHealthPlan {
  const now = input.now ?? Date.now();
  const ageMs = resolveAgeMs(input.cachedAt, now);
  const context: PlanContext = {
    now,
    ageMs,
    staleAfterMs: input.staleAfterMs ?? STREAM_HEALTH_DEFAULTS.staleAfterMs,
    playbackTrustMs: input.playbackTrustMs ?? STREAM_HEALTH_DEFAULTS.playbackTrustMs,
    timeoutMs:
      input.timeoutMs ??
      (input.phase === "playback-preflight"
        ? STREAM_HEALTH_DEFAULTS.preflightTimeoutMs
        : STREAM_HEALTH_DEFAULTS.resolveGateTimeoutMs),
    strategy: probeStrategyForUrl(input.url),
  };

  switch (input.phase) {
    case "resolve-gate":
      return planResolveGateHealth(input, context);
    case "playback-preflight":
      return planPlaybackPreflightHealth(input, context);
    case "cache-revalidate":
      return planCacheRevalidateHealth(input, context);
  }
}

export function evaluateStreamHealth(
  phase: StreamHealthPhase,
  probe: StreamReachabilityProbeResult | null,
): boolean {
  if (!probe) return true;
  return phase === "playback-preflight"
    ? isStreamReachableForPlaybackPreflight(probe)
    : isStreamReachableForResolve(probe);
}

export async function runStreamHealthCheck(
  input: StreamHealthCheckInput,
): Promise<StreamHealthResult> {
  const plan = planStreamHealth(input);
  if (!plan.shouldProbe) {
    return skippedHealthResult(plan);
  }

  const probe = await probeStreamReachability({
    url: input.url,
    headers: input.headers,
    fetchImpl: input.fetchImpl,
    timeoutMs: plan.timeoutMs,
    signal: input.signal,
  });

  return {
    healthy: evaluateStreamHealth(input.phase, probe),
    probed: true,
    strategy: plan.strategy,
    policyReason: plan.policyReason,
    ageMs: plan.ageMs,
    probe,
  };
}

function planResolveGateHealth(
  input: StreamHealthCheckInput,
  context: PlanContext,
): StreamHealthPlan {
  if (input.streamReachabilityVerified === true) {
    return skipPlan(context, "provider-attested");
  }
  return probePlan(context, "forced");
}

function planPlaybackPreflightHealth(
  input: StreamHealthCheckInput,
  context: PlanContext,
): StreamHealthPlan {
  if (
    input.streamReachabilityVerified === true &&
    typeof context.ageMs === "number" &&
    context.ageMs <= context.playbackTrustMs
  ) {
    return skipPlan(context, "provider-attested");
  }
  if (typeof context.ageMs === "number" && context.ageMs <= context.playbackTrustMs) {
    return skipPlan(context, "recent-resolve");
  }
  return probePlan(context, "forced");
}

function planCacheRevalidateHealth(
  input: StreamHealthCheckInput,
  context: PlanContext,
): StreamHealthPlan {
  if (!input.url || input.cachedAt === undefined || input.cachedAt === null) {
    return {
      shouldProbe: false,
      strategy: "none",
      policyReason: "no-cache",
      timeoutMs: context.timeoutMs,
    };
  }
  if (input.force) {
    return probePlan(context, "forced");
  }
  if (typeof context.ageMs === "number" && context.ageMs <= context.staleAfterMs) {
    return skipPlan(context, "fresh-cache", "fresh");
  }
  return probePlan(context, "stale");
}

function skipPlan(
  context: PlanContext,
  skipReason: StreamHealthSkipReason,
  policyReason: StreamHealthPolicyReason = skipReason,
): StreamHealthPlan {
  return {
    shouldProbe: false,
    skipReason,
    strategy: "none",
    policyReason,
    timeoutMs: context.timeoutMs,
    ageMs: context.ageMs,
  };
}

function probePlan(context: PlanContext, mode: "forced" | "stale"): StreamHealthPlan {
  const isHls = context.strategy === "hls-manifest-get";
  const policyReason: StreamHealthPolicyReason =
    mode === "forced"
      ? isHls
        ? "forced-hls"
        : "forced-direct"
      : isHls
        ? "stale-hls"
        : "stale-direct";

  return {
    shouldProbe: true,
    strategy: context.strategy,
    policyReason,
    timeoutMs: context.timeoutMs,
    ageMs: context.ageMs,
  };
}

function skippedHealthResult(plan: StreamHealthPlan): StreamHealthResult {
  return {
    healthy: true,
    probed: false,
    strategy: plan.strategy,
    policyReason: plan.policyReason,
    skipReason: plan.skipReason,
    ageMs: plan.ageMs,
  };
}

function resolveAgeMs(cachedAt: number | null | undefined, now: number): number | undefined {
  if (cachedAt === undefined || cachedAt === null) return undefined;
  return Math.max(0, now - cachedAt);
}

function probeStrategyForUrl(url: string): Exclude<StreamHealthStrategy, "none"> {
  return isHlsManifestUrl(url) ? "hls-manifest-get" : "head-then-range";
}
