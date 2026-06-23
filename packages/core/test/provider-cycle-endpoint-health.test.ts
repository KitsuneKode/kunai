import { describe, expect, test } from "bun:test";

import type { EndpointHealthPort, ProviderCycleCandidate } from "@kunai/types";

import { runProviderCycle } from "../src/index";

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
});
