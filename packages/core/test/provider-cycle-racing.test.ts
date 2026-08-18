import { describe, expect, test } from "bun:test";

import type { EndpointHealthPort, ProviderCycleCandidate } from "@kunai/types";

import { runProviderCycle } from "../src/index";

class StubEndpointHealth implements EndpointHealthPort {
  readonly blocked = new Set<string>();
  readonly failures: Array<{ endpoint: string; class: string; titleId?: string }> = [];
  readonly successes: string[] = [];

  shouldTry(_providerId: string, endpoint: string): boolean {
    return !this.blocked.has(endpoint);
  }

  recordFailure(
    _providerId: string,
    endpoint: string,
    info: { class: string; titleId?: string },
  ): void {
    this.failures.push({ endpoint, class: info.class, titleId: info.titleId });
  }

  recordSuccess(_providerId: string, endpoint: string): void {
    this.successes.push(endpoint);
  }
}

function candidates(...ids: string[]): ProviderCycleCandidate[] {
  return ids.map((id, index) => ({
    id,
    providerId: "videasy",
    serverId: id,
    priority: index,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runProviderCycle racing", () => {
  test("without a hedge delay, candidates run strictly in order", async () => {
    const started: string[] = [];

    const result = await runProviderCycle<string>({
      providerId: "videasy",
      candidates: candidates("a", "b", "c"),
      maxAttemptsPerCandidate: 1,
      resolveCandidate: async (candidate) => {
        started.push(candidate.id);
        if (candidate.id !== "c") throw new Error("nope");
        return "stream-c";
      },
    });

    expect(started).toEqual(["a", "b", "c"]);
    expect(result.selected).toBe("stream-c");
  });

  test("a slow first candidate does not block a fast second one", async () => {
    const result = await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      candidateTimeoutMs: 2_000,
      candidates: candidates("slow", "fast"),
      resolveCandidate: async (candidate) => {
        if (candidate.id === "slow") {
          await sleep(1_500);
          return "stream-slow";
        }
        return "stream-fast";
      },
    });

    expect(result.selected).toBe("stream-fast");
    expect(result.selectedCandidate?.id).toBe("fast");
    expect(result.stopReason).toBe("resolved");
  });

  test("the loser of a race records no endpoint-health failure", async () => {
    const endpointHealth = new StubEndpointHealth();

    await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      candidateTimeoutMs: 2_000,
      candidates: candidates("slow", "fast"),
      endpointHealth,
      resolveCandidate: async (candidate, context) => {
        if (candidate.id === "slow") {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 1_500);
            context.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new Error("aborted"));
            });
          });
          return "stream-slow";
        }
        return "stream-fast";
      },
    });

    // "slow" was cancelled, not broken. Recording it would quarantine a
    // perfectly good endpoint.
    expect(endpointHealth.failures).toEqual([]);
    expect(endpointHealth.successes).toEqual(["fast"]);
  });

  test("a genuinely failing candidate still records a classified failure", async () => {
    const endpointHealth = new StubEndpointHealth();

    await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      titleId: "tmdb:550",
      candidates: candidates("broken", "good"),
      endpointHealth,
      resolveCandidate: async (candidate) => {
        if (candidate.id === "broken") throw new Error("failed to parse candidate response");
        await sleep(50);
        return "stream-good";
      },
    });

    // A parse failure is real endpoint evidence, and the title id must survive
    // so the distinct-title quarantine rule can still see it.
    expect(endpointHealth.failures).toEqual([
      { endpoint: "broken", class: "server-error", titleId: "tmdb:550" },
    ]);
  });

  test("a blocked candidate records no endpoint failure", async () => {
    const endpointHealth = new StubEndpointHealth();

    await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      candidates: candidates("guarded", "good"),
      endpointHealth,
      resolveCandidate: async (candidate) => {
        if (candidate.id === "guarded") {
          throw new Error("HTTP 403 Forbidden");
        }
        await sleep(50);
        return "stream-good";
      },
    });

    // "blocked" covers provider-wide session guards and WAF responses, which
    // are not evidence about this endpoint. The sequential path refuses to
    // record them and racing must agree.
    expect(endpointHealth.failures).toEqual([]);
  });

  test("quarantined candidates are still skipped while racing", async () => {
    const endpointHealth = new StubEndpointHealth();
    endpointHealth.blocked.add("dead");
    const tried: string[] = [];

    await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      candidates: candidates("dead", "good"),
      endpointHealth,
      resolveCandidate: async (candidate) => {
        tried.push(candidate.id);
        return "stream";
      },
    });

    expect(tried).not.toContain("dead");
    expect(tried).toContain("good");
  });

  test("shouldStopAfterFailure ends the race", async () => {
    const tried: string[] = [];

    const result = await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 5_000,
      candidates: candidates("guarded", "b", "c"),
      shouldStopAfterFailure: (failure) => failure.failureClass === "candidate-blocked",
      resolveCandidate: async (candidate) => {
        tried.push(candidate.id);
        throw new Error("HTTP 403 Forbidden");
      },
    });

    // A provider-wide session guard must not be answered by hammering every
    // remaining candidate.
    expect(result.stopReason).toBe("exhausted");
    expect(tried).toEqual(["guarded"]);
  });

  test("cancelling the parent stops the whole race", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    const result = await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 5,
      candidateTimeoutMs: 5_000,
      signal: controller.signal,
      candidates: candidates("a", "b"),
      resolveCandidate: async (_candidate, context) =>
        new Promise<string>((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });

    expect(result.cancelled).toBe(true);
    expect(result.stopReason).toBe("cancelled");
  });

  test("every candidate failing exhausts the race rather than hanging", async () => {
    const result = await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      candidates: candidates("a", "b"),
      resolveCandidate: async () => {
        throw new Error("HTTP 500");
      },
    });

    expect(result.selected).toBeUndefined();
    expect(result.cancelled).toBe(false);
    expect(result.stopReason).toBe("exhausted");
    expect(result.attempts.length).toBeGreaterThanOrEqual(2);
  });

  test("records real per-candidate timings, not collapsed ones", async () => {
    let tick = 0;
    const result = await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      candidates: candidates("only"),
      now: () => new Date(1_000 + tick++ * 1_000).toISOString(),
      resolveCandidate: async () => {
        await sleep(30);
        return "stream";
      },
    });

    const attempt = result.attempts[0];
    expect(attempt).toBeDefined();
    // A collapsed startedAt would erase the latency the resolve-trace spine exists
    // to measure.
    expect(attempt?.startedAt).not.toBe(attempt?.endedAt);
  });

  test("all candidates quarantined reports all-quarantined", async () => {
    const endpointHealth = new StubEndpointHealth();
    endpointHealth.blocked.add("dead-a");
    endpointHealth.blocked.add("dead-b");

    const result = await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      candidates: candidates("dead-a", "dead-b"),
      endpointHealth,
      resolveCandidate: async () => "stream",
    });

    expect(result.stopReason).toBe("all-quarantined");
  });
});
