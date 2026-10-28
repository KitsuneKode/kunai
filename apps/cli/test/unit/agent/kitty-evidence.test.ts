import { expect, test } from "bun:test";

import {
  decodedVideoProof,
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

test("terminal targets use cell widths and reject absent or ambiguous labels", () => {
  expect(kittyTextTarget("header\n猫 [/] commands", "[/]")).toEqual({ x: 4, y: 2 });
  expect(() => kittyTextTarget("[/] commands\n[/] other", "[/]")).toThrow("uniquely");
  expect(() => kittyTextTarget("blank", "[/]")).toThrow("uniquely");
  expect(kittyMouseReport(4, 2)).toBe("\x1b[<0;4;2M");
  expect(kittyMouseReport(4, 2, true)).toBe("\x1b[<0;4;2m");
  expect(() => kittyMouseReport(0, 1)).toThrow();
  expect(() => kittyMouseReport(1, NaN)).toThrow();
});

test("decoded-video proof refuses a moving audio clock, stalled playback and invalid dimensions", () => {
  expect(() => decodedVideoProof(2, 11, null)).toThrow();
  expect(() => decodedVideoProof(2, 2, { w: 1920, h: 1080 })).toThrow("advance");
  expect(() => decodedVideoProof(2, 4, { w: 1920, h: 1080 })).toThrow("advance");
  expect(() => decodedVideoProof(2, 11, { w: 0, h: 1080 })).toThrow();
  expect(() => decodedVideoProof(NaN, 4, { w: 1920, h: 1080 })).toThrow();
  expect(decodedVideoProof(2, 11, { w: 1920, h: 1080 })).toEqual({
    timePosStart: 2,
    timePosEnd: 11,
    video: { w: 1920, h: 1080 },
  });
});
