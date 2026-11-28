import { describe, expect, test } from "bun:test";

import { applyOfflineCommandAvailability } from "@/domain/session/command-registry";
import { deriveOfflineMode } from "@/domain/session/offline-mode";

describe("offline-first shell policy", () => {
  test("derives one offline value from explicit intent or connectivity", () => {
    expect(deriveOfflineMode({ explicitOffline: true, networkAvailable: true })).toEqual({
      active: true,
      source: "explicit",
    });
    expect(deriveOfflineMode({ explicitOffline: false, networkAvailable: false }).active).toBe(
      true,
    );
    expect(deriveOfflineMode({ explicitOffline: false, networkAvailable: true }).active).toBe(
      false,
    );
  });

  test("disables online discovery commands with a connection reason", () => {
    const command = {
      id: "trending" as const,
      label: "Trending",
      aliases: ["trending"],
      description: "Trending",
      enabled: true,
    };
    expect(applyOfflineCommandAvailability(command, true)).toMatchObject({
      enabled: false,
      reason: "needs a connection",
    });
    expect(applyOfflineCommandAvailability(command, false).enabled).toBe(true);
  });
});
