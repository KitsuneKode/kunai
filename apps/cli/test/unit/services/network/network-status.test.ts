import { describe, expect, test } from "bun:test";

import {
  classifyNetworkFailure,
  describeNetworkUnavailableAction,
  shouldShowNetworkUnavailableHint,
} from "@/services/network/NetworkStatus";

describe("NetworkStatus", () => {
  test("classifies OS and DNS failures as offline", () => {
    expect(classifyNetworkFailure("getaddrinfo ENOTFOUND api.example.test")).toBe("offline");
    expect(classifyNetworkFailure("Network is unreachable")).toBe("offline");
  });

  test("classifies single timeouts as limited instead of offline", () => {
    expect(classifyNetworkFailure("provider timed out")).toBe("limited");
  });

  test("shows offline suggestion in online contexts only", () => {
    const snapshot = {
      status: "offline" as const,
      checkedAt: 1,
      evidence: "startup-probe" as const,
    };

    expect(shouldShowNetworkUnavailableHint({ snapshot, context: "playback-resolve" })).toBe(true);
    expect(shouldShowNetworkUnavailableHint({ snapshot, context: "offline-library" })).toBe(false);
    expect(describeNetworkUnavailableAction()).toContain("Open offline library");
  });
});
