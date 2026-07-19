import { describe, test } from "bun:test";

import { BinaryAutoUpdater } from "@/services/update/BinaryAutoUpdater";

function updater(): BinaryAutoUpdater {
  return new BinaryAutoUpdater({
    config: {
      getRaw: () => ({ updateChecksEnabled: false, autoApplyBinaryUpdates: false }) as never,
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
