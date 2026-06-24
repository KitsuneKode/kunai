import { describe, expect, test } from "bun:test";

import { buildRootStatusSummary } from "@/app-shell/root-status-summary";
import { createInitialState } from "@/domain/session/SessionState";
import { Connectivity } from "@/services/network/Connectivity";

describe("header connectivity reactivity", () => {
  test("network drop surfaces offline alert when not in manual offline mode", () => {
    const connectivity = new Connectivity(() => false);
    const state = createInitialState("vidking", "hianime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });

    const onlineSummary = buildRootStatusSummary({
      state,
      currentViewLabel: "home",
      rootStatus: "ready",
      networkAvailable: connectivity.isOnline(),
      offlineMode: false,
    });
    expect(onlineSummary.alert).toBeNull();

    connectivity.recordFailure("ENOTFOUND", "search-error");
    const offlineSummary = buildRootStatusSummary({
      state,
      currentViewLabel: "home",
      rootStatus: "ready",
      networkAvailable: connectivity.isOnline(),
      offlineMode: false,
    });
    expect(offlineSummary.alert?.text).toContain("network unavailable");
  });
});
