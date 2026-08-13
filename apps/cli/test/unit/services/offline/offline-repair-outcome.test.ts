import { describe, expect, test } from "bun:test";

import { describeOfflineRepairOutcome } from "@/services/offline/offline-library-action-router";

describe("describeOfflineRepairOutcome", () => {
  test("says plainly when there was nothing to repair", () => {
    // The old copy read "Re-download queued for 0 missing items" here — success
    // phrasing for a no-op, which is what made repair look broken on a healthy
    // title whose only gap was metadata.
    expect(describeOfflineRepairOutcome({ queued: 0, repairedMetadata: 0, inspected: 1 })).toBe(
      "Nothing to repair — all 1 local item is complete.",
    );
    expect(describeOfflineRepairOutcome({ queued: 0, repairedMetadata: 0, inspected: 3 })).toBe(
      "Nothing to repair — all 3 local items are complete.",
    );
  });

  test("reports an in-place metadata repair without claiming a download", () => {
    const note = describeOfflineRepairOutcome({ queued: 0, repairedMetadata: 2, inspected: 4 });

    expect(note).toBe("Repair: restored details for 2 items.");
    expect(note).not.toContain("queued");
  });

  test("reports both kinds of repair when both happened", () => {
    expect(describeOfflineRepairOutcome({ queued: 1, repairedMetadata: 1, inspected: 5 })).toBe(
      "Repair: re-download queued for 1 item · restored details for 1 item.",
    );
  });
});
