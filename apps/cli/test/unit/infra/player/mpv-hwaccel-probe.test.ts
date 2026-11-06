import { describe, expect, test } from "bun:test";

import type { ImageCapability } from "@/image";
import {
  probeMpvHardwareAcceleration,
  terminalGraphicsLabel,
} from "@/infra/player/mpv-hwaccel-probe";

const ghosttyKitty: ImageCapability = {
  terminal: "ghostty",
  protocol: "kitty",
  renderer: "kitty-native",
  available: true,
  reason: "test",
};

describe("probeMpvHardwareAcceleration", () => {
  test("parses drivers from hwdec help and auto-safe stderr", () => {
    const spawned: { cmd: readonly string[] }[] = [];
    const result = probeMpvHardwareAcceleration({
      which: (c) => (c === "mpv" ? "/usr/bin/mpv" : null),
      spawnSync: ((opts: { cmd: readonly string[] }) => {
        spawned.push({ cmd: opts.cmd });
        const joined = opts.cmd.join(" ");
        if (joined.includes("--hwdec=help")) {
          return {
            exitCode: 0,
            stdout: new TextEncoder().encode("vaapi nvdec videotoolbox d3d11va"),
            stderr: new Uint8Array(),
          };
        }
        if (joined.includes("--hwdec=auto-safe")) {
          return {
            exitCode: 0,
            stdout: undefined,
            stderr: new TextEncoder().encode("Using hardware decoding (vaapi-copy)."),
          };
        }
        throw new Error(`unexpected spawn: ${joined}`);
      }) as typeof Bun.spawnSync,
      detectImageCapability: () => ghosttyKitty,
    });

    expect(spawned.length).toBe(2);
    expect(spawned[0]?.cmd).toContain("--hwdec=help");
    expect(spawned[1]?.cmd.some((a) => a.includes("auto-safe"))).toBe(true);
    expect(result.drivers).toEqual(["vaapi", "nvdec", "videotoolbox", "d3d11va"]);
    expect(result.autoSafeOk).toBe(true);
    expect(result.autoSafeDriver).toBe("vaapi");
    expect(result.terminalGraphics).toBe("Kitty");
  });
});

describe("terminalGraphicsLabel", () => {
  test("maps renderers to short doctor/setup labels", () => {
    expect(terminalGraphicsLabel(ghosttyKitty)).toBe("Kitty");
    expect(
      terminalGraphicsLabel({
        ...ghosttyKitty,
        renderer: "sixel",
        protocol: "sixel",
      }),
    ).toBe("Sixel");
    expect(
      terminalGraphicsLabel({
        ...ghosttyKitty,
        renderer: "half-block",
        protocol: "half-block",
      }),
    ).toBe("half-block");
  });
});
