import { describe, expect, test } from "bun:test";

import { Connectivity } from "@/services/network/Connectivity";
import {
  observeOnline,
  observeResolveNetworkOutcome,
  recordNetworkFailure,
  recordNetworkSuccess,
  type NetworkObserver,
} from "@/services/network/network-observation";

function makeObserver(offlineMode = false): {
  container: NetworkObserver;
  connectivity: Connectivity;
} {
  const connectivity = new Connectivity(() => offlineMode);
  const container = {
    connectivity,
  } as unknown as NetworkObserver;
  return { container, connectivity };
}

describe("recordNetworkFailure", () => {
  test("flips to offline on connectivity-class errors", () => {
    const { container, connectivity } = makeObserver();
    recordNetworkFailure(container, new Error("getaddrinfo ENOTFOUND example.com"), "search-error");
    expect(connectivity.getSnapshot().status).toBe("offline");
    expect(connectivity.isOnline()).toBe(false);
  });

  test("ignores non-connectivity errors (no flapping on provider churn)", () => {
    const { container, connectivity } = makeObserver();
    recordNetworkFailure(container, new Error("HTTP 404 Not Found"), "search-error");
    expect(connectivity.getSnapshot().status).toBe("online");
  });

  test("treats timeouts as limited, not offline", () => {
    const { container, connectivity } = makeObserver();
    recordNetworkFailure(container, new Error("request timed out"), "provider-error");
    expect(connectivity.getSnapshot().status).toBe("limited");
    expect(connectivity.isOnline()).toBe(true);
  });

  test("never overrides manual offline mode", () => {
    const { container, connectivity } = makeObserver(true);
    recordNetworkSuccess(container, "search-error");
    expect(connectivity.getSnapshot().evidence).toBe("startup-probe");
    expect(connectivity.isOnline()).toBe(false);
  });
});

describe("recordNetworkSuccess", () => {
  test("restores online after a prior failure", () => {
    const { container, connectivity } = makeObserver();
    recordNetworkFailure(container, new Error("ENETUNREACH"), "search-error");
    expect(connectivity.getSnapshot().status).toBe("offline");
    recordNetworkSuccess(container, "search-error");
    expect(connectivity.getSnapshot().status).toBe("online");
  });
});

describe("observeOnline", () => {
  test("records success and returns the value", async () => {
    const { container, connectivity } = makeObserver();
    const value = await observeOnline(container, "search-error", async () => 42);
    expect(value).toBe(42);
    expect(connectivity.getSnapshot().status).toBe("online");
  });

  test("records failure and rethrows", async () => {
    const { container, connectivity } = makeObserver();
    await expect(
      observeOnline(container, "search-error", async () => {
        throw new Error("ECONNREFUSED");
      }),
    ).rejects.toThrow("ECONNREFUSED");
    expect(connectivity.getSnapshot().status).toBe("offline");
  });
});

describe("observeResolveNetworkOutcome", () => {
  test("fresh stream proves connectivity", () => {
    const { container, connectivity } = makeObserver();
    recordNetworkFailure(container, new Error("ENOTFOUND"), "provider-error");
    observeResolveNetworkOutcome(container, {
      stream: { url: "https://host/x.m3u8" },
      provenance: "fresh",
      attempts: [],
    });
    expect(connectivity.getSnapshot().status).toBe("online");
  });

  test("cache/prefetch stream does not flip status", () => {
    const { container, connectivity } = makeObserver();
    recordNetworkFailure(container, new Error("ENOTFOUND"), "provider-error");
    observeResolveNetworkOutcome(container, {
      stream: { url: "https://host/x.m3u8" },
      provenance: "cache-hit",
      attempts: [],
    });
    expect(connectivity.getSnapshot().status).toBe("offline");
  });

  test("no stream with connectivity failures marks offline", () => {
    const { container, connectivity } = makeObserver();
    observeResolveNetworkOutcome(container, {
      stream: null,
      provenance: "fresh",
      attempts: [{ failure: { message: "fetch failed: ENOTFOUND" } }],
    });
    expect(connectivity.getSnapshot().status).toBe("offline");
  });

  test("no stream with provider-only failures stays online", () => {
    const { container, connectivity } = makeObserver();
    observeResolveNetworkOutcome(container, {
      stream: null,
      provenance: "fresh",
      attempts: [{ failure: { message: "no playable sources" } }],
    });
    expect(connectivity.getSnapshot().status).toBe("online");
  });
});
