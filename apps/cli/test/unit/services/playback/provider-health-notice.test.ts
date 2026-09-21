import { describe, expect, test } from "bun:test";

import { providerHealthNotice } from "@/services/playback/provider-health-notice";
import type { ProviderHealth } from "@kunai/types";

const NOW = new Date("2026-09-21T12:00:00Z");

function row(
  providerId: string,
  status: ProviderHealth["status"],
  checkedAt = NOW.toISOString(),
): ProviderHealth {
  return { providerId, status, checkedAt } as ProviderHealth;
}

const LOADED = ["videasy", "vidlink", "rivestream", "hianime"];

describe("providerHealthNotice", () => {
  test("fires when the configured provider is down and suggests the first healthy priority provider", () => {
    const notice = providerHealthNotice({
      configuredProvider: "videasy",
      providerPriority: ["videasy", "rivestream", "vidlink"],
      loadedProviders: LOADED,
      healthRows: [row("videasy", "down"), row("rivestream", "healthy")],
      now: NOW,
    });
    expect(notice).toEqual({
      downProviderId: "videasy",
      suggestedProviderId: "rivestream",
    });
  });

  test("skips priority providers that are also down and falls back to any loaded healthy provider", () => {
    const notice = providerHealthNotice({
      configuredProvider: "videasy",
      providerPriority: ["rivestream"],
      loadedProviders: LOADED,
      healthRows: [row("videasy", "down"), row("rivestream", "down"), row("hianime", "healthy")],
      now: NOW,
    });
    // vidlink has no health row — unknown is not evidence of down, so it wins
    // over hianime in loaded order.
    expect(notice?.suggestedProviderId).toBe("vidlink");
  });

  test("reports a null suggestion when every loaded provider is down", () => {
    const notice = providerHealthNotice({
      configuredProvider: "videasy",
      providerPriority: ["rivestream"],
      loadedProviders: ["videasy", "rivestream"],
      healthRows: [row("videasy", "down"), row("rivestream", "down")],
      now: NOW,
    });
    expect(notice).toEqual({ downProviderId: "videasy", suggestedProviderId: null });
  });

  test("stays quiet for degraded — a degraded provider still resolves sometimes", () => {
    const notice = providerHealthNotice({
      configuredProvider: "videasy",
      providerPriority: ["rivestream"],
      loadedProviders: LOADED,
      healthRows: [row("videasy", "degraded")],
      now: NOW,
    });
    expect(notice).toBeNull();
  });

  test("stays quiet when the down row is stale enough to have healed by TTL", () => {
    // DOWN_TO_DEGRADED_MS heals `down` to `degraded` after its first window —
    // a row checked hours ago is not evidence the provider is still down.
    const stale = new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const notice = providerHealthNotice({
      configuredProvider: "videasy",
      providerPriority: ["rivestream"],
      loadedProviders: LOADED,
      healthRows: [row("videasy", "down", stale)],
      now: NOW,
    });
    expect(notice).toBeNull();
  });

  test("never suggests a provider that is not loaded even when listed in priority", () => {
    const notice = providerHealthNotice({
      configuredProvider: "videasy",
      providerPriority: ["movy"],
      loadedProviders: LOADED,
      healthRows: [row("videasy", "down"), row("vidlink", "healthy")],
      now: NOW,
    });
    expect(notice?.suggestedProviderId).toBe("vidlink");
  });
});
