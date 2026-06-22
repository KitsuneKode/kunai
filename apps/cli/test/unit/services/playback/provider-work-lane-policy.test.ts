import { describe, expect, test } from "bun:test";

import {
  providerWorkLaneForRequest,
  providerWorkLanePolicy,
} from "@/services/playback/provider-work-lane-policy";

describe("provider work lane policy", () => {
  test("maps resolve intent and budget lane into explicit provider work lanes", () => {
    expect(
      providerWorkLaneForRequest({ intentKind: "playback", budgetLane: "user-blocking" }),
    ).toBe("foreground-playback");
    expect(
      providerWorkLaneForRequest({ intentKind: "recovery", budgetLane: "user-blocking" }),
    ).toBe("foreground-playback");
    expect(providerWorkLaneForRequest({ intentKind: "prefetch", budgetLane: "near-need" })).toBe(
      "near-need-prefetch",
    );
    expect(providerWorkLaneForRequest({ intentKind: "prefetch", budgetLane: "background" })).toBe(
      "background-inventory",
    );
    expect(
      providerWorkLaneForRequest({ intentKind: "diagnostic", budgetLane: "manual-diagnostic" }),
    ).toBe("manual-diagnostic");
  });

  test("foreground playback is stricter than manual diagnostics", () => {
    const foreground = providerWorkLanePolicy("foreground-playback");
    const diagnostic = providerWorkLanePolicy("manual-diagnostic");

    expect(foreground.timeoutMs).toBeLessThan(diagnostic.timeoutMs);
    expect(foreground.diagnosticsLevel).toBe("trace");
    expect(diagnostic.diagnosticsLevel).toBe("full");
    expect(foreground.cancelWhenUnobserved).toBe(true);
    expect(diagnostic.cancelWhenUnobserved).toBe(false);
  });

  test("background inventory is bounded and cache friendly", () => {
    const policy = providerWorkLanePolicy("background-inventory");

    expect(policy.concurrency).toBe(2);
    expect(policy.freshness).toBe("trust-fresh");
    expect(policy.mayUseCachedInventory).toBe(true);
    expect(policy.diagnosticsLevel).toBe("summary");
  });
});
