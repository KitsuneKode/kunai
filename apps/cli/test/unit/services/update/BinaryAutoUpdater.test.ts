import { describe, expect, test } from "bun:test";

import { BinaryAutoUpdater, resolveAutoUpdateGate } from "@/services/update/BinaryAutoUpdater";

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
