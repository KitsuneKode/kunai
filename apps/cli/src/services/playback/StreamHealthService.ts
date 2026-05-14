import type { StreamInfo } from "@/domain/types";

import { checkStreamHealth, type StreamHealthFetch } from "./stream-health-check";
import { resolveStreamHealthPolicy } from "./stream-health-policy";

export type StreamHealthServiceDeps = {
  readonly fetchImpl?: StreamHealthFetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly staleAfterMs?: number;
};

export type StreamHealthServiceResult = {
  readonly healthy: boolean;
  readonly checked: boolean;
  readonly strategy: "none" | "hls-manifest-get" | "head-then-range";
  readonly reason: "no-cache" | "fresh" | "stale-hls" | "stale-direct";
  readonly ageMs?: number;
};

export class StreamHealthService {
  constructor(private readonly deps: StreamHealthServiceDeps = {}) {}

  async check(
    stream: Pick<StreamInfo, "url" | "headers" | "timestamp">,
  ): Promise<StreamHealthServiceResult> {
    const policy = resolveStreamHealthPolicy({
      url: stream.url,
      cachedAt: stream.timestamp,
      now: this.deps.now?.(),
      staleAfterMs: this.deps.staleAfterMs,
    });

    if (!policy.shouldCheck) {
      return {
        healthy: true,
        checked: false,
        strategy: policy.strategy,
        reason: policy.reason,
        ageMs: policy.ageMs,
      };
    }

    const healthy = await checkStreamHealth({
      url: stream.url,
      headers: stream.headers,
      fetchImpl: this.deps.fetchImpl,
      timeoutMs: this.deps.timeoutMs,
      methodPreference:
        policy.strategy === "hls-manifest-get" ? "hls-manifest-get" : "head-then-range",
    });

    return {
      healthy,
      checked: true,
      strategy: policy.strategy,
      reason: policy.reason,
      ageMs: policy.ageMs,
    };
  }
}
