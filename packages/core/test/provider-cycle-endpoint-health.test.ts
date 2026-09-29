import { describe, expect, test } from "bun:test";

import type { EndpointHealthPort, ProviderCycleCandidate } from "@kunai/types";

import { createProviderCycleFailureError, runProviderCycle } from "../src/index";

class StubEndpointHealth implements EndpointHealthPort {
  readonly blocked = new Set<string>();
  readonly failures: Array<{ endpoint: string; class: string }> = [];
  readonly successes: string[] = [];

  shouldTry(_providerId: string, endpoint: string): boolean {
    return !this.blocked.has(endpoint);
  }

  recordFailure(_providerId: string, endpoint: string, info: { class: string }): void {
    this.failures.push({ endpoint, class: info.class });
  }

  recordSuccess(_providerId: string, endpoint: string): void {
    this.successes.push(endpoint);
  }
}

describe("runProviderCycle endpoint health", () => {
  test("skips quarantined candidates and returns all-quarantined when none remain", async () => {
    const endpointHealth = new StubEndpointHealth();
    endpointHealth.blocked.add("dead");
    endpointHealth.blocked.add("also-dead");

    const candidates: ProviderCycleCandidate[] = [
      {
        id: "a",
        providerId: "videasy",
        serverId: "dead",
        priority: 0,
      },
      {
        id: "b",
        providerId: "videasy",
        serverId: "also-dead",
        priority: 1,
      },
    ];

    const result = await runProviderCycle({
      providerId: "videasy",
      candidates,
      endpointHealth,
      resolveCandidate: async () => ({ ok: true }),
    });

    expect(result.stopReason).toBe("all-quarantined");
    expect(result.attempts).toHaveLength(0);
    expect(result.events.some((event) => event.type === "source:skipped")).toBe(true);
  });

  test("records endpoint success after resolved candidate", async () => {
    const endpointHealth = new StubEndpointHealth();
    const result = await runProviderCycle({
      providerId: "videasy",
      candidates: [{ id: "a", providerId: "videasy", serverId: "good", priority: 0 }],
      endpointHealth,
      resolveCandidate: async () => ({ ok: true }),
    });

    expect(result.stopReason).toBe("resolved");
    expect(endpointHealth.successes).toEqual(["good"]);
  });

  test("records a resolve-gate rejection against the endpoint that failed it", async () => {
    // A gate rejection is a segment probe against that server's own stream, so
    // it is durable evidence about that server. Without this the cycle re-walks
    // every dead mirror on every play and the quarantine never learns.
    const endpointHealth = new StubEndpointHealth();

    const result = await runProviderCycle({
      providerId: "rivestream",
      candidates: [
        { id: "a", providerId: "rivestream", serverId: "primevids", priority: 0 },
        { id: "b", providerId: "rivestream", serverId: "citadel", priority: 1 },
      ],
      endpointHealth,
      maxAttemptsPerCandidate: 1,
      resolveCandidate: async (candidate) => {
        if (candidate.serverId === "primevids") {
          throw createProviderCycleFailureError(candidate, {
            failureClass: "candidate-blocked",
            message: "stream is unreachable (HLS segment unreachable: HTTP 403)",
            retryable: false,
            at: "2026-09-09T00:00:00.000Z",
            endpointScoped: true,
          });
        }
        return { ok: true };
      },
    });

    expect(result.stopReason).toBe("resolved");
    expect(endpointHealth.failures).toEqual([{ endpoint: "primevids", class: "server-error" }]);
    expect(endpointHealth.successes).toEqual(["citadel"]);
  });

  test("does not record a block that was not observed against the endpoint", async () => {
    // Region-wide WAF and provider session guards also arrive as
    // `candidate-blocked`; quarantining mirrors for those would blacklist
    // healthy servers for a problem that has nothing to do with them.
    const endpointHealth = new StubEndpointHealth();

    await runProviderCycle({
      providerId: "miruro",
      candidates: [{ id: "a", providerId: "miruro", serverId: "mirror-1", priority: 0 }],
      endpointHealth,
      maxAttemptsPerCandidate: 1,
      resolveCandidate: async (candidate) => {
        throw createProviderCycleFailureError(candidate, {
          failureClass: "candidate-blocked",
          message: "Cloudflare WAF",
          retryable: false,
          at: "2026-09-09T00:00:00.000Z",
        });
      },
    });

    expect(endpointHealth.failures).toEqual([]);
  });
});
