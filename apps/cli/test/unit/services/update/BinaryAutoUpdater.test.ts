import { describe, expect, test } from "bun:test";

import { BinaryAutoUpdater, resolveAutoUpdateGate } from "@/services/update/BinaryAutoUpdater";
import type { InstallManifest } from "@/services/update/install-manifest";

function updater(
  raw: Record<string, unknown> = { updateChecksEnabled: false, autoApplyBinaryUpdates: false },
): BinaryAutoUpdater {
  return new BinaryAutoUpdater({
    config: {
      getRaw: () => raw as never,
      update: async () => {},
      save: async () => {},
    },
    currentVersion: "0.0.0",
  });
}

describe("BinaryAutoUpdater.stopBackground", () => {
  test("clears the background interval and is idempotent", () => {
    const instance = updater();
    instance.startBackground();
    instance.stopBackground();
    instance.stopBackground();
    // Restarting after stop must be possible (interval handle was cleared).
    instance.startBackground();
    instance.stopBackground();
  });

  test("can arm the interval without duplicating an already-completed startup check", () => {
    let manifestReads = 0;
    const instance = new BinaryAutoUpdater({
      config: {
        getRaw: () =>
          ({
            updateChecksEnabled: true,
            autoApplyBinaryUpdates: true,
            updateSnoozedUntil: 0,
            updateCheckIntervalDays: 7,
            lastUpdateCheckAt: 0,
            lastUpdateCheckFailedAt: 0,
          }) as never,
        update: async () => {},
        save: async () => {},
      },
      currentVersion: "0.3.0",
      readInstallManifest: async () => {
        manifestReads += 1;
        return binaryManifest();
      },
    });

    instance.startBackground({ runImmediately: false });
    instance.stopBackground();
    expect(manifestReads).toBe(0);
  });
});

describe("BinaryAutoUpdater.runOnce", () => {
  const enabled = {
    updateChecksEnabled: true,
    autoApplyBinaryUpdates: true,
    updateSnoozedUntil: 0,
    updateCheckIntervalDays: 7,
    lastUpdateCheckAt: 0,
    lastUpdateCheckFailedAt: 0,
  };

  test("downloads and activates a newer native binary through the transactional installer", async () => {
    const patches: unknown[] = [];
    let installedVersion = "";
    const instance = new BinaryAutoUpdater({
      config: {
        getRaw: () => enabled as never,
        update: async (patch) => {
          patches.push(patch);
        },
        save: async () => {},
      },
      currentVersion: "0.3.0",
      now: () => 123_000,
      readInstallManifest: async () => binaryManifest(),
      getPendingRestartVersion: async () => null,
      resolveLatestVersion: async () => "0.4.0",
      installLatest: async (options) => {
        installedVersion = options?.version ?? "";
        return {
          status: "installed",
          version: options?.version ?? "",
          versionPath: "C:\\Users\\k\\AppData\\Local\\kunai\\versions\\0.4.0\\kunai.exe",
        };
      },
    });

    await expect(instance.runOnce()).resolves.toEqual({ status: "installed", version: "0.4.0" });
    expect(installedVersion).toBe("0.4.0");
    expect(patches).toContainEqual(
      expect.objectContaining({ lastUpdateCheckAt: 123_000, lastKnownLatestVersion: "0.4.0" }),
    );
  });

  test("refuses auto-apply when another install method merely contains a versioned path", async () => {
    let resolvedLatest = false;
    const instance = new BinaryAutoUpdater({
      config: {
        getRaw: () => enabled as never,
        update: async () => {},
        save: async () => {},
      },
      currentVersion: "0.3.0",
      readInstallManifest: async () => ({
        ...binaryManifest(),
        method: "npm-global",
      }),
      resolveLatestVersion: async () => {
        resolvedLatest = true;
        return "0.4.0";
      },
    });

    // Still refuses to auto-apply and still never reaches the network -- only
    // the label changed. "disabled" blamed a setting the user never touched;
    // this channel simply cannot replace its own binary, and the caller uses
    // the channel to name the right upgrade command instead.
    await expect(instance.runOnce()).resolves.toEqual({
      status: "not-applicable",
      channel: "npm-global",
    });
    expect(resolvedLatest).toBe(false);
  });
});

describe("resolveAutoUpdateGate", () => {
  const enabled = {
    updateChecksEnabled: true,
    autoApplyBinaryUpdates: true,
    updateSnoozedUntil: 0,
    updateCheckIntervalDays: 7,
    lastUpdateCheckAt: 0,
    lastUpdateCheckFailedAt: 0,
  };

  test("automatic runs stop on either opt-out", () => {
    expect(
      resolveAutoUpdateGate({
        config: { ...enabled, autoApplyBinaryUpdates: false },
        now: 1,
        force: false,
      }),
    ).toEqual({ status: "disabled" });
    expect(
      resolveAutoUpdateGate({
        config: { ...enabled, updateChecksEnabled: false },
        now: 1,
        force: false,
      }),
    ).toEqual({ status: "disabled" });
  });

  test("automatic runs stop while snoozed, and while the last check is still fresh", () => {
    expect(
      resolveAutoUpdateGate({
        config: { ...enabled, updateSnoozedUntil: 5_000 },
        now: 1_000,
        force: false,
      }),
    ).toEqual({ status: "snoozed" });
    expect(
      resolveAutoUpdateGate({
        config: { ...enabled, lastUpdateCheckAt: 1_000 },
        now: 1_001,
        force: false,
      }),
    ).toEqual({ status: "fresh" });
  });

  test("an eligible automatic run proceeds", () => {
    expect(resolveAutoUpdateGate({ config: enabled, now: Date.now(), force: false })).toBeNull();
  });

  // The shell's manual "update now" calls runOnce({force:true}). Gating that on
  // autoApplyBinaryUpdates meant switching off *automatic* updates also broke
  // the *manual* one, which reported "Update did not apply (disabled)".
  test("an explicit forced run ignores every opt-out", () => {
    expect(
      resolveAutoUpdateGate({
        config: {
          updateChecksEnabled: false,
          autoApplyBinaryUpdates: false,
          updateSnoozedUntil: Number.MAX_SAFE_INTEGER,
          updateCheckIntervalDays: 7,
          lastUpdateCheckAt: Number.MAX_SAFE_INTEGER,
          lastUpdateCheckFailedAt: 0,
        },
        now: 1_000,
        force: true,
      }),
    ).toBeNull();
  });
});

function binaryManifest(): InstallManifest {
  return {
    schemaVersion: 1,
    method: "binary",
    activeVersion: "0.3.0",
    preferredChannel: "stable",
    launcherPath: "C:\\Users\\k\\AppData\\Local\\kunai\\bin\\kunai.exe",
    versionedPath: "C:\\Users\\k\\AppData\\Local\\kunai\\versions\\0.3.0\\kunai.exe",
    managedPaths: [],
    downloadBaseUrl: "https://github.com/KitsuneKode/kunai/releases/download",
    installedAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
}
