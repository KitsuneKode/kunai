import { expect, test } from "bun:test";

import {
  playbackProgressProof,
  observedPlaybackAdvanceMs,
  kittyMouseReport,
  kittyTextTarget,
  startKittySession,
} from "../../agent/kitty-session";

test("live Kitty sessions reject absent or unknown provider pins before desktop prerequisites", async () => {
  const display = process.env.DISPLAY;
  const wayland = process.env.WAYLAND_DISPLAY;
  delete process.env.DISPLAY;
  delete process.env.WAYLAND_DISPLAY;
  try {
    await expect(startKittySession({ evidenceDir: "unused", fixture: false })).rejects.toThrow(
      "production provider pin",
    );
    await expect(
      startKittySession({
        evidenceDir: "unused",
        fixture: false,
        providerId: "unknown",
        providerIds: ["youtube"],
      }),
    ).rejects.toThrow("production provider pin");
  } finally {
    if (display !== undefined) process.env.DISPLAY = display;
    if (wayland !== undefined) process.env.WAYLAND_DISPLAY = wayland;
  }
});

test("an already cancelled Kitty run rejects before desktop prerequisites or profile creation", async () => {
  const controller = new AbortController();
  const reason = new Error("Already cancelled verification");
  controller.abort(reason);
  const display = process.env.DISPLAY;
  const wayland = process.env.WAYLAND_DISPLAY;
  delete process.env.DISPLAY;
  delete process.env.WAYLAND_DISPLAY;
  try {
    await expect(
      startKittySession({ evidenceDir: "unused", fixture: true, signal: controller.signal }),
    ).rejects.toThrow(reason);
  } finally {
    if (display !== undefined) process.env.DISPLAY = display;
    if (wayland !== undefined) process.env.WAYLAND_DISPLAY = wayland;
  }
});

test("terminal targets use cell widths and reject absent or ambiguous labels", () => {
  expect(kittyTextTarget("header\n猫 [/] commands", "[/]")).toEqual({ x: 4, y: 2 });
  expect(() => kittyTextTarget("[/] commands\n[/] other", "[/]")).toThrow("uniquely");
  expect(() => kittyTextTarget("blank", "[/]")).toThrow("uniquely");
  expect(kittyMouseReport(4, 2)).toBe("\x1b[<0;4;2M");
  expect(kittyMouseReport(4, 2, true)).toBe("\x1b[<0;4;2m");
  expect(() => kittyMouseReport(0, 1)).toThrow();
  expect(() => kittyMouseReport(1, NaN)).toThrow();
});

test("playback progress requires a moving clock and positive video dimensions; picture approval is separate", () => {
  expect(() =>
    playbackProgressProof(2, 11, null, { elapsedMs: 9_000, advancingMs: 9_000, minimumSeconds: 8 }),
  ).toThrow();
  expect(() =>
    playbackProgressProof(
      2,
      2,
      { w: 1920, h: 1080 },
      { elapsedMs: 9_000, advancingMs: 9_000, minimumSeconds: 8 },
    ),
  ).toThrow("advance");
  expect(() =>
    playbackProgressProof(
      2,
      4,
      { w: 1920, h: 1080 },
      { elapsedMs: 9_000, advancingMs: 9_000, minimumSeconds: 8 },
    ),
  ).toThrow("advance");
  expect(() =>
    playbackProgressProof(
      2,
      11,
      { w: 0, h: 1080 },
      { elapsedMs: 9_000, advancingMs: 9_000, minimumSeconds: 8 },
    ),
  ).toThrow();
  expect(() =>
    playbackProgressProof(
      NaN,
      4,
      { w: 1920, h: 1080 },
      { elapsedMs: 9_000, advancingMs: 9_000, minimumSeconds: 8 },
    ),
  ).toThrow();
  expect(
    playbackProgressProof(
      2,
      11,
      { w: 1920, h: 1080 },
      { elapsedMs: 9_000, advancingMs: 9_000, minimumSeconds: 8 },
    ),
  ).toEqual({
    timePosStart: 2,
    timePosEnd: 11,
    video: { w: 1920, h: 1080 },
    observedForMs: 9_000,
    advancingForMs: 9_000,
  });
});

test("a forward seek cannot stand in for the requested observation period", () => {
  expect(() =>
    playbackProgressProof(
      0,
      120,
      { w: 1440, h: 1080 },
      { elapsedMs: 1_000, advancingMs: 1_000, minimumSeconds: 45 },
    ),
  ).toThrow("observation");
});

test("observation evidence requires both elapsed time and media progress", () => {
  const video = { w: 1920, h: 1080 };
  expect(() =>
    playbackProgressProof(0, 1, video, {
      elapsedMs: 45_000,
      advancingMs: 45_000,
      minimumSeconds: 45,
    }),
  ).toThrow("advance");
  expect(
    playbackProgressProof(0, 46, video, {
      elapsedMs: 45_000,
      advancingMs: 45_000,
      minimumSeconds: 45,
    }).observedForMs,
  ).toBe(45_000);
  expect(() =>
    playbackProgressProof(0, 46, video, {
      elapsedMs: NaN,
      advancingMs: 45_000,
      minimumSeconds: 45,
    }),
  ).toThrow("observation");
  expect(() =>
    playbackProgressProof(0, 46, video, {
      elapsedMs: 45_000,
      advancingMs: 45_000,
      minimumSeconds: 0,
    }),
  ).toThrow("observation");
});

test("intro skips and stalls cannot manufacture observed playback time", () => {
  expect(observedPlaybackAdvanceMs(0, 120, 0, 1000)).toBe(1000);
  expect(observedPlaybackAdvanceMs(120, 120, 1000, 45000)).toBe(0);
  expect(observedPlaybackAdvanceMs(120, 1, 1000, 2000)).toBe(0);
  expect(observedPlaybackAdvanceMs(0, 45, 0, 45000)).toBe(45000);
  expect(() =>
    playbackProgressProof(
      0,
      120,
      { w: 1920, h: 1080 },
      { elapsedMs: 45000, advancingMs: 1000, minimumSeconds: 45 },
    ),
  ).toThrow("observation");
});

test("an unknown prior sample earns no credit across an IPC gap", () => {
  expect(observedPlaybackAdvanceMs(null, 120, 0, 45000)).toBe(0);
});
