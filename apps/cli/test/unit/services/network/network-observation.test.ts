import { describe, expect, test } from "bun:test";

import {
  observeOnline,
  observeResolveNetworkOutcome,
  recordNetworkFailure,
  recordNetworkSuccess,
  type NetworkObserver,
} from "@/services/network/network-observation";
import { NetworkStatusTracker } from "@/services/network/NetworkStatusTracker";

function makeObserver(offlineMode = false): {
  container: NetworkObserver;
  tracker: NetworkStatusTracker;
} {
  const tracker = new NetworkStatusTracker();
  const container = {
    config: { offlineMode },
    networkStatus: tracker,
  } as unknown as NetworkObserver;
  return { container, tracker };
}

describe("recordNetworkFailure", () => {
  test("flips to offline on connectivity-class errors", () => {
    const { container, tracker } = makeObserver();
    recordNetworkFailure(container, new Error("getaddrinfo ENOTFOUND example.com"), "search-error");
    expect(tracker.getSnapshot().status).toBe("offline");
    expect(tracker.isAvailable()).toBe(false);
  });

  test("ignores non-connectivity errors (no flapping on provider churn)", () => {
    const { container, tracker } = makeObserver();
    recordNetworkFailure(container, new Error("HTTP 404 Not Found"), "search-error");
    expect(tracker.getSnapshot().status).toBe("online");
  });

  test("treats timeouts as limited, not offline", () => {
    const { container, tracker } = makeObserver();
    recordNetworkFailure(container, new Error("request timed out"), "provider-error");
    expect(tracker.getSnapshot().status).toBe("limited");
    expect(tracker.isAvailable()).toBe(true);
  });

  test("never overrides manual offline mode", () => {
    const { container, tracker } = makeObserver(true);
    recordNetworkSuccess(container, "search-error");
    // tracker stays at its optimistic default; offline mode is enforced upstream
    expect(tracker.getSnapshot().evidence).toBe("startup-probe");
  });
});

describe("recordNetworkSuccess", () => {
  test("restores online after a prior failure", () => {
    const { container, tracker } = makeObserver();
    recordNetworkFailure(container, new Error("ENETUNREACH"), "search-error");
    expect(tracker.getSnapshot().status).toBe("offline");
    recordNetworkSuccess(container, "search-error");
    expect(tracker.getSnapshot().status).toBe("online");
  });
});

describe("observeOnline", () => {
  test("records success and returns the value", async () => {
    const { container, tracker } = makeObserver();
    const value = await observeOnline(container, "search-error", async () => 42);
    expect(value).toBe(42);
    expect(tracker.getSnapshot().status).toBe("online");
  });

  test("records failure and rethrows", async () => {
    const { container, tracker } = makeObserver();
    await expect(
      observeOnline(container, "search-error", async () => {
        throw new Error("ECONNREFUSED");
      }),
    ).rejects.toThrow("ECONNREFUSED");
    expect(tracker.getSnapshot().status).toBe("offline");
  });
});

describe("observeResolveNetworkOutcome", () => {
  test("fresh stream proves connectivity", () => {
    const { container, tracker } = makeObserver();
    recordNetworkFailure(container, new Error("ENOTFOUND"), "provider-error");
    observeResolveNetworkOutcome(container, {
      stream: { url: "https://host/x.m3u8" },
      provenance: "fresh",
      attempts: [],
    });
    expect(tracker.getSnapshot().status).toBe("online");
  });

  test("cache/prefetch stream does not flip status", () => {
    const { container, tracker } = makeObserver();
    recordNetworkFailure(container, new Error("ENOTFOUND"), "provider-error");
    observeResolveNetworkOutcome(container, {
      stream: { url: "https://host/x.m3u8" },
      provenance: "cache-hit",
      attempts: [],
    });
    expect(tracker.getSnapshot().status).toBe("offline");
  });

  test("no stream with connectivity failures marks offline", () => {
    const { container, tracker } = makeObserver();
    observeResolveNetworkOutcome(container, {
      stream: null,
      provenance: "fresh",
      attempts: [{ failure: { message: "fetch failed: ENOTFOUND" } }],
    });
    expect(tracker.getSnapshot().status).toBe("offline");
  });

  test("no stream with provider-only failures stays online", () => {
    const { container, tracker } = makeObserver();
    observeResolveNetworkOutcome(container, {
      stream: null,
      provenance: "fresh",
      attempts: [{ failure: { message: "no playable sources" } }],
    });
    expect(tracker.getSnapshot().status).toBe("online");
  });
});
