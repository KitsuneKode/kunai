import { describe, expect, test } from "bun:test";

import { presenceStatusDetail } from "@/services/presence/presence-status-line";

/**
 * The reported shape: an unavailable provider printed its status twice on the
 * shell boot line, the settings action result, and the diagnostics reason —
 * "Discord presence · unavailable · unavailable · Could not connect to…".
 */
describe("presenceStatusDetail", () => {
  test("drops a detail that restates the status", () => {
    expect(
      presenceStatusDetail("unavailable", "unavailable  ·  Could not connect to Discord IPC"),
    ).toBe("unavailable  ·  Could not connect to Discord IPC");
  });

  test("keeps the retry segment the service appends", () => {
    expect(
      presenceStatusDetail("unavailable", "unavailable  ·  IPC refused  ·  retrying in 5s"),
    ).toBe("unavailable  ·  IPC refused  ·  retrying in 5s");
  });

  test("prefixes the status when the detail does not carry it", () => {
    expect(presenceStatusDetail("ready", "connected to local Discord client")).toBe(
      "ready  ·  connected to local Discord client",
    );
  });

  test("falls back to the status alone for an empty detail", () => {
    expect(presenceStatusDetail("error", "")).toBe("error");
    expect(presenceStatusDetail("error", "   ")).toBe("error");
    expect(presenceStatusDetail("idle", " · ")).toBe("idle");
  });

  test("only a leading restatement is dropped", () => {
    // A reason may legitimately mention the status again further along; that is
    // information, not the duplication this exists to remove.
    expect(presenceStatusDetail("unavailable", "unavailable · retried · still unavailable")).toBe(
      "unavailable  ·  retried  ·  still unavailable",
    );
  });

  test("compares case-insensitively", () => {
    expect(presenceStatusDetail("unavailable", "Unavailable  ·  pipe closed")).toBe(
      "Unavailable  ·  pipe closed",
    );
  });

  test("honours a caller-supplied separator", () => {
    // The shell boot line and the diagnostics reason use single spaces around
    // the separator; the settings surfaces use the wider health-row form.
    expect(presenceStatusDetail("unavailable", "unavailable · IPC refused", " · ")).toBe(
      "unavailable · IPC refused",
    );
    expect(presenceStatusDetail("ready", "connected", " · ")).toBe("ready · connected");
  });
});
