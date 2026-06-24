import { describe, expect, test } from "bun:test";

import { Connectivity } from "@/services/network/Connectivity";

describe("Connectivity", () => {
  test("isOnline reflects offline mode intent over network reality", () => {
    const online = new Connectivity(() => false);
    online.recordFailure("ENOTFOUND", "search-error");
    expect(online.isOnline()).toBe(false);

    const offline = new Connectivity(() => true);
    offline.recordSuccess("search-error");
    expect(offline.isOnline()).toBe(false);
  });

  test("limited network status still counts as online", () => {
    const connectivity = new Connectivity(() => false);
    connectivity.recordFailure("request timed out", "provider-error");
    expect(connectivity.getSnapshot().status).toBe("limited");
    expect(connectivity.isOnline()).toBe(true);
  });

  test("subscribe fires when network reality changes", () => {
    const connectivity = new Connectivity(() => false);
    let calls = 0;
    connectivity.subscribe(() => {
      calls += 1;
    });

    connectivity.recordFailure("ENOTFOUND", "search-error");
    expect(calls).toBe(1);
    expect(connectivity.isOnline()).toBe(false);
  });

  test("notifyIntentChanged fires subscribers when offline mode toggles", () => {
    let offlineMode = false;
    const connectivity = new Connectivity(() => offlineMode);
    let calls = 0;
    connectivity.subscribe(() => {
      calls += 1;
    });

    offlineMode = true;
    connectivity.notifyIntentChanged();
    expect(calls).toBe(1);
    expect(connectivity.isOnline()).toBe(false);
  });

  test("recordSuccess restores online after failure", () => {
    const connectivity = new Connectivity(() => false);
    connectivity.recordFailure("ENETUNREACH", "search-error");
    expect(connectivity.isOnline()).toBe(false);
    connectivity.recordSuccess("search-error");
    expect(connectivity.isOnline()).toBe(true);
  });
});
