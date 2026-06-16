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
});
