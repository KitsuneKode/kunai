import { describe, expect, it } from "bun:test";

import { updateSignalFromCheck } from "@/services/notifications/notification-update-signal";

describe("updateSignalFromCheck", () => {
  it("returns an app-update signal when an update is available", () => {
    expect(
      updateSignalFromCheck({
        status: "update-available",
        currentVersion: "1.2.0",
        latestVersion: "1.3.0",
      }),
    ).toEqual({ type: "app-update", currentVersion: "1.2.0", latestVersion: "1.3.0" });
  });

  it("returns null when up to date", () => {
    expect(
      updateSignalFromCheck({
        status: "up-to-date",
        currentVersion: "1.3.0",
        latestVersion: "1.3.0",
      }),
    ).toBeNull();
  });

  it("returns null without a latest version", () => {
    expect(
      updateSignalFromCheck({ status: "error", currentVersion: "1.2.0", latestVersion: null }),
    ).toBeNull();
  });
});
