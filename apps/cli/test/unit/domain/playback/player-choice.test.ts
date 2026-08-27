import { describe, expect, test } from "bun:test";

import {
  normalizePlayerPlatform,
  parsePlayerChoice,
  resolvePlayerMode,
  type SupportedPlayerPlatform,
} from "@/domain/playback/player-choice";

describe("player choice", () => {
  test("defaults to auto and accepts every public choice", () => {
    expect(parsePlayerChoice(undefined)).toBe("auto");
    expect(parsePlayerChoice("auto")).toBe("auto");
    expect(parsePlayerChoice("mpv")).toBe("mpv");
    expect(parsePlayerChoice("vlc")).toBe("vlc");
  });

  test("rejects unknown player names before runtime composition", () => {
    expect(() => parsePlayerChoice("potato")).toThrow(/--player.*auto.*mpv.*vlc/i);
  });

  test("maps Android choices to detached targets", () => {
    expect(resolvePlayerMode({ choice: "auto", platform: "android" })).toEqual({
      kind: "android-handoff",
      target: "chooser",
    });
    expect(resolvePlayerMode({ choice: "mpv", platform: "android" })).toEqual({
      kind: "android-handoff",
      target: "mpv",
    });
    expect(resolvePlayerMode({ choice: "vlc", platform: "android" })).toEqual({
      kind: "android-handoff",
      target: "vlc",
    });
  });

  test("preserves managed mpv for existing desktop platforms", () => {
    for (const platform of [
      "linux",
      "darwin",
      "win32",
      "other",
    ] as const satisfies readonly SupportedPlayerPlatform[]) {
      expect(resolvePlayerMode({ choice: "auto", platform })).toEqual({ kind: "managed-mpv" });
      expect(resolvePlayerMode({ choice: "mpv", platform })).toEqual({ kind: "managed-mpv" });
      expect(resolvePlayerMode({ choice: "vlc", platform })).toEqual({
        kind: "unsupported",
        choice: "vlc",
      });
    }
  });

  test("normalizes Bun and Node platform values without treating unknown systems as Android", () => {
    expect(normalizePlayerPlatform("android")).toBe("android");
    expect(normalizePlayerPlatform("linux")).toBe("linux");
    expect(normalizePlayerPlatform("darwin")).toBe("darwin");
    expect(normalizePlayerPlatform("win32")).toBe("win32");
    expect(normalizePlayerPlatform("freebsd")).toBe("other");
  });
});
