import { describe, expect, test } from "bun:test";

import {
  historyRowIntentForShellAction,
  resolveHistoryOverlayKey,
} from "@/app-shell/use-history-overlay-input";

describe("history overlay key routing", () => {
  test("m opens the title control menu for the selected row", () => {
    // `m` is the title-control chord everywhere else in the app; history used
    // to spend it on an undocumented watched toggle.
    expect(resolveHistoryOverlayKey("m", { hasSelection: true })).toBe("open-title-menu");
  });

  test("m does nothing with no row selected", () => {
    expect(resolveHistoryOverlayKey("m", { hasSelection: false })).toBe("ignore");
  });

  test("w keeps a one-key watched toggle", () => {
    expect(resolveHistoryOverlayKey("w", { hasSelection: true })).toBe("toggle-watched");
  });

  test("w does nothing with no row selected", () => {
    expect(resolveHistoryOverlayKey("w", { hasSelection: false })).toBe("ignore");
  });

  test("keys are case insensitive", () => {
    expect(resolveHistoryOverlayKey("M", { hasSelection: true })).toBe("open-title-menu");
    expect(resolveHistoryOverlayKey("W", { hasSelection: true })).toBe("toggle-watched");
  });

  test("enter still resumes rather than opening the menu", () => {
    expect(resolveHistoryOverlayKey("\r", { hasSelection: true })).not.toBe("open-title-menu");
  });

  test("unrelated keys fall through to the rest of the key map", () => {
    // "unhandled" and "ignore" differ: ignore means the key was ours and we
    // chose to do nothing, so it must not fall through to deletion or queueing.
    expect(resolveHistoryOverlayKey("x", { hasSelection: true })).toBe("unhandled");
    expect(resolveHistoryOverlayKey("q", { hasSelection: true })).toBe("unhandled");
  });
});

describe("history row intents", () => {
  test("download from the menu targets the row, not the session", () => {
    expect(historyRowIntentForShellAction("download")).toEqual({
      kind: "media-action",
      actionId: "download",
      status: "Queued download from history",
    });
  });

  test("marking watched maps to the router action", () => {
    expect(historyRowIntentForShellAction("mark-watched")).toMatchObject({
      kind: "media-action",
      actionId: "mark-watched",
    });
  });

  test("resume hands back to the existing confirm path", () => {
    expect(historyRowIntentForShellAction("resume")).toEqual({
      kind: "resume",
    });
  });

  test("an action the row cannot service is reported, not silently dropped", () => {
    expect(historyRowIntentForShellAction("diagnostics")).toEqual({
      kind: "delegate",
    });
  });
});
