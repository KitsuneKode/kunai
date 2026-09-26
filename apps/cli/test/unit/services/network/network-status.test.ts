import { describe, expect, test } from "bun:test";

import {
  buildNetworkUserHint,
  classifyNetworkFailure,
  describeNetworkUnavailableAction,
  shouldShowNetworkUnavailableHint,
} from "@/services/network/NetworkStatus";

describe("NetworkStatus", () => {
  test("classifies OS and DNS failures as offline", () => {
    expect(classifyNetworkFailure("getaddrinfo ENOTFOUND api.example.test")).toBe("offline");
    expect(classifyNetworkFailure("Network is unreachable")).toBe("offline");
  });

  test("classifies Bun unable-to-connect failures as offline", () => {
    expect(
      classifyNetworkFailure("Unable to connect. Is the computer able to access the url?"),
    ).toBe("offline");
    expect(classifyNetworkFailure("FailedToOpenSocket")).toBe("offline");
    expect(classifyNetworkFailure("Was there a typo in the url or port?")).toBe("offline");
  });

  test("classifies the resolver's real phrasings as offline", () => {
    // The forms curl, glibc, Windows and Bun actually emit. The bare `dns`
    // token that used to stand in for all of these is gone; see the pattern
    // list's comment for why it was a hazard.
    expect(classifyNetworkFailure("curl: (6) Could not resolve host: anidb.app")).toBe("offline");
    expect(classifyNetworkFailure("Name or service not known")).toBe("offline");
    expect(classifyNetworkFailure("no such host")).toBe("offline");
    expect(classifyNetworkFailure("dns lookup failed")).toBe("offline");
  });

  test("does not read a bare dns token as a network outage", () => {
    // Two of these across distinct providers would trip
    // DEFAULT_CONSECUTIVE_OFFLINE_THRESHOLD and halt every remaining live
    // candidate — including the ones that are working.
    expect(classifyNetworkFailure('anidb search returned zero results for "dns"')).not.toBe(
      "offline",
    );
    expect(classifyNetworkFailure("Could not parse manifest at /tmp/dns/manifest.m3u8")).not.toBe(
      "offline",
    );
    expect(classifyNetworkFailure("provider dns stream inventory empty")).not.toBe("offline");
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

  test("builds user hints without warning inside offline-only library", () => {
    const snapshot = {
      status: "offline" as const,
      checkedAt: 1,
      evidence: "provider-error" as const,
    };

    expect(buildNetworkUserHint({ snapshot, context: "offline-library" })).toBeNull();
    expect(buildNetworkUserHint({ snapshot, context: "playback-resolve" })).toEqual({
      tone: "warning",
      title: "Internet unavailable",
      detail: "Online providers cannot be reached right now. Offline downloads are still playable.",
      actions: ["offline-library", "retry", "diagnostics", "back"],
    });
  });

  test("limited network hint stays neutral and avoids provider blame", () => {
    const hint = buildNetworkUserHint({
      snapshot: {
        status: "limited",
        checkedAt: 1,
        evidence: "provider-error",
        message: "provider timed out",
      },
      context: "online-search",
    });

    expect(hint?.tone).toBe("neutral");
    expect(hint?.detail).toContain("retry online work");
  });
});
