import { describe, expect, test } from "bun:test";

import { selectTransientRow } from "@/app-shell/transient-row";

const EMPTY = {
  alert: null,
  notificationToast: null,
  streakMilestoneAlert: null,
  presenceBootLine: null,
  streakAtRiskAlert: null,
  weeklyDigestLine: null,
} as const;

describe("selectTransientRow", () => {
  test("null when nothing is pending", () => {
    expect(selectTransientRow({ ...EMPTY })).toBeNull();
  });

  test("an error alert out-prioritises a toast and renders dim, tone preserved", () => {
    const row = selectTransientRow({
      ...EMPTY,
      alert: { text: "playback failed", tone: "error" },
      notificationToast: "● New episode — X",
    });
    expect(row?.text).toBe("playback failed");
    expect(row?.tone).toBe("error");
    expect(row?.dim).toBe(true);
    expect(row?.accent).toBe(false);
  });

  test("immediate notification toasts can preempt a standing alert", () => {
    const row = selectTransientRow({
      ...EMPTY,
      alert: { text: "⚠ autoplay paused", tone: "warning" },
      notificationToast: "⚠ Download failed — Show",
      notificationToastPriority: "immediate",
    });
    expect(row?.text).toBe("⚠ Download failed — Show");
    expect(row?.accent).toBe(true);
  });

  test("a toast wins over streak/presence and renders bright accent", () => {
    const row = selectTransientRow({
      ...EMPTY,
      notificationToast: "● New episode — X",
      streakMilestoneAlert: "🔥 5-day streak!",
      presenceBootLine: { text: "Discord presence · connected", tone: "success" },
    });
    expect(row?.text).toBe("● New episode — X");
    expect(row?.accent).toBe(true);
    expect(row?.dim).toBe(false);
  });

  test("streak milestone wins over presence", () => {
    const row = selectTransientRow({
      ...EMPTY,
      streakMilestoneAlert: "🔥 5-day streak!",
      presenceBootLine: { text: "Discord presence · connected", tone: "success" },
    });
    expect(row?.text).toBe("🔥 5-day streak!");
  });

  test("a calm presence line dims; an error presence line stays bright", () => {
    const calm = selectTransientRow({
      ...EMPTY,
      presenceBootLine: { text: "connected", tone: "success" },
    });
    expect(calm?.dim).toBe(true);
    const err = selectTransientRow({
      ...EMPTY,
      presenceBootLine: { text: "could not connect", tone: "error" },
    });
    expect(err?.dim).toBe(false);
  });

  test("at-risk then weekly digest are the lowest priority", () => {
    expect(
      selectTransientRow({ ...EMPTY, streakAtRiskAlert: "risk", weeklyDigestLine: "digest" })?.text,
    ).toBe("risk");
    expect(selectTransientRow({ ...EMPTY, weeklyDigestLine: "digest" })?.text).toBe("digest");
  });

  test("undo strip outranks a regular toast and the standing decorations", () => {
    const row = selectTransientRow({
      ...EMPTY,
      notificationToast: "● New episode — X",
      undoLine: { text: "added to queue · z undo", tone: "info" },
      streakMilestoneAlert: "🔥 5-day streak!",
    });
    expect(row?.text).toBe("added to queue · z undo");
    expect(row?.tone).toBe("info");
    // Not an arrival — the line reads as an affordance, not a notification.
    expect(row?.accent).toBe(false);
  });

  test("undo strip loses to alerts and immediate notification toasts", () => {
    const alert = selectTransientRow({
      ...EMPTY,
      alert: { text: "playback failed", tone: "error" },
      undoLine: { text: "undid queue add", tone: "success" },
    });
    expect(alert?.text).toBe("playback failed");

    const immediate = selectTransientRow({
      ...EMPTY,
      notificationToast: "⚠ Download failed — Show",
      notificationToastPriority: "immediate",
      undoLine: { text: "undid queue add", tone: "success" },
    });
    expect(immediate?.text).toBe("⚠ Download failed — Show");
  });

  test("undo outcome tone is preserved for warning can't-undo copy", () => {
    const row = selectTransientRow({
      ...EMPTY,
      undoLine: { text: "can't undo queue add — changed since then", tone: "warning" },
    });
    expect(row?.tone).toBe("warning");
  });
});
