import { describe, expect, test } from "bun:test";

import {
  detectPlayerPlatform,
  normalizePlayerPlatform,
  parsePlayerChoice,
  requiredManagedPlayer,
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

  test("desktop keeps managed mpv by default and runs VLC observed when asked", () => {
    for (const platform of [
      "linux",
      "darwin",
      "win32",
      "other",
    ] as const satisfies readonly SupportedPlayerPlatform[]) {
      expect(resolvePlayerMode({ choice: "auto", platform })).toEqual({ kind: "managed-mpv" });
      expect(resolvePlayerMode({ choice: "mpv", platform })).toEqual({ kind: "managed-mpv" });
      expect(resolvePlayerMode({ choice: "vlc", platform })).toEqual({ kind: "managed-vlc" });
    }
  });

  test("auto plays in VLC when VLC is installed and mpv is not, and only then", () => {
    const auto = (installed: { mpv: boolean; vlc: boolean }) =>
      resolvePlayerMode({ choice: "auto", platform: "linux", installed });
    expect(auto({ mpv: false, vlc: true })).toEqual({ kind: "managed-vlc" });
    expect(auto({ mpv: true, vlc: true })).toEqual({ kind: "managed-mpv" });
    // Neither: mpv stays the choice so its install guidance shows.
    expect(auto({ mpv: false, vlc: false })).toEqual({ kind: "managed-mpv" });
    // An explicit choice is never second-guessed.
    expect(
      resolvePlayerMode({ choice: "mpv", platform: "linux", installed: { mpv: false, vlc: true } }),
    ).toEqual({ kind: "managed-mpv" });
    // Android hands off to another app whatever is installed.
    expect(
      resolvePlayerMode({
        choice: "auto",
        platform: "android",
        installed: { mpv: false, vlc: true },
      }),
    ).toEqual({ kind: "android-handoff", target: "chooser" });
  });

  test("one shared rule maps each selected player mode to its managed dependency", () => {
    expect(requiredManagedPlayer({ kind: "managed-mpv" })).toBe("mpv");
    expect(requiredManagedPlayer({ kind: "managed-vlc" })).toBe("vlc");
    expect(requiredManagedPlayer({ kind: "android-handoff", target: "chooser" })).toBeNull();
    expect(requiredManagedPlayer({ kind: "android-handoff", target: "mpv" })).toBeNull();
    expect(requiredManagedPlayer({ kind: "android-handoff", target: "vlc" })).toBeNull();
  });

  test("normalizes Bun and Node platform values without treating unknown systems as Android", () => {
    expect(normalizePlayerPlatform("android")).toBe("android");
    expect(normalizePlayerPlatform("linux")).toBe("linux");
    expect(normalizePlayerPlatform("darwin")).toBe("darwin");
    expect(normalizePlayerPlatform("win32")).toBe("win32");
    expect(normalizePlayerPlatform("freebsd")).toBe("other");
  });

  test("detects Android from Termux and Android runtime markers before generic Linux", () => {
    expect(detectPlayerPlatform({ platform: "linux", env: { TERMUX_VERSION: "0.119" } })).toBe(
      "android",
    );
    expect(detectPlayerPlatform({ platform: "linux", env: { ANDROID_ROOT: "/system" } })).toBe(
      "android",
    );
    expect(
      detectPlayerPlatform({
        platform: "linux",
        env: { PREFIX: "/data/data/com.termux/files/usr" },
      }),
    ).toBe("android");
    expect(detectPlayerPlatform({ platform: "linux", env: {} })).toBe("linux");
  });
});
