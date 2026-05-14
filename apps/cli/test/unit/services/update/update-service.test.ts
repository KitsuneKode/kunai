import { describe, expect, test } from "bun:test";

import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { shouldRunUpdateCheck, updateCheckCachePatch } from "@/services/update/update-check-cache";
import { UpdateService } from "@/services/update/UpdateService";

function makeConfig(overrides: Partial<KitsuneConfig> = {}) {
  let raw: KitsuneConfig = { ...DEFAULT_CONFIG, ...overrides };
  return {
    getRaw: () => ({ ...raw }),
    async update(partial: Partial<KitsuneConfig>) {
      raw = { ...raw, ...partial };
    },
    async save() {},
  };
}

function makeDiagnostics() {
  const events: { category: string; message: string }[] = [];
  return {
    events,
    record(event: { category: string; message: string }) {
      events.push(event);
    },
  };
}

describe("update check cache", () => {
  test("respects disabled, snoozed, and interval-gated update checks", () => {
    const now = Date.UTC(2026, 4, 14);

    expect(shouldRunUpdateCheck({ ...DEFAULT_CONFIG, updateChecksEnabled: false }, now)).toBe(
      false,
    );
    expect(shouldRunUpdateCheck({ ...DEFAULT_CONFIG, updateSnoozedUntil: now + 60_000 }, now)).toBe(
      false,
    );
    expect(
      shouldRunUpdateCheck(
        { ...DEFAULT_CONFIG, lastUpdateCheckAt: now - 60_000, updateCheckIntervalDays: 7 },
        now,
      ),
    ).toBe(false);
    expect(
      shouldRunUpdateCheck(
        {
          ...DEFAULT_CONFIG,
          lastUpdateCheckAt: now - 8 * 24 * 60 * 60 * 1000,
          updateCheckIntervalDays: 7,
        },
        now,
      ),
    ).toBe(true);
  });

  test("builds cache patches without losing existing latest-version evidence", () => {
    expect(
      updateCheckCachePatch({
        now: 100,
        latestVersion: "0.2.0",
        failed: false,
      }),
    ).toEqual({
      lastUpdateCheckAt: 100,
      lastKnownLatestVersion: "0.2.0",
      lastUpdateCheckFailedAt: 0,
    });

    expect(
      updateCheckCachePatch({
        now: 200,
        latestVersion: null,
        failed: true,
      }),
    ).toEqual({
      lastUpdateCheckAt: 200,
      lastUpdateCheckFailedAt: 200,
    });
  });
});

describe("UpdateService", () => {
  test("returns update guidance without running install commands", async () => {
    const config = makeConfig({
      updateChecksEnabled: true,
      lastUpdateCheckAt: 0,
      updateCheckIntervalDays: 7,
    });
    const diagnostics = makeDiagnostics();
    const service = new UpdateService({
      config,
      diagnostics,
      currentVersion: "0.1.0",
      now: () => Date.UTC(2026, 4, 14),
      installMethod: { kind: "bun-global", label: "Bun global" },
      fetchLatestVersion: async () => "0.2.0",
    });

    const result = await service.checkForUpdate({ force: true });

    expect(result.status).toBe("update-available");
    expect(result.latestVersion).toBe("0.2.0");
    expect(result.guidance).toContain("bun update --global");
    expect(config.getRaw().lastKnownLatestVersion).toBe("0.2.0");
    expect(diagnostics.events.at(-1)?.message).toBe("Update available");
  });

  test("snoozes and disables checks through config only", async () => {
    const now = Date.UTC(2026, 4, 14);
    const config = makeConfig();
    const diagnostics = makeDiagnostics();
    const service = new UpdateService({
      config,
      diagnostics,
      currentVersion: "0.1.0",
      now: () => now,
      installMethod: { kind: "source", label: "Source checkout" },
      fetchLatestVersion: async () => "0.2.0",
    });

    await service.snoozeForDays(7);
    expect(config.getRaw().updateSnoozedUntil).toBe(now + 7 * 24 * 60 * 60 * 1000);

    await service.setChecksEnabled(false);
    expect(config.getRaw().updateChecksEnabled).toBe(false);
  });
});
