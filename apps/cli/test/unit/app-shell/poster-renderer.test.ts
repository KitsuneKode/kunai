import { afterEach, describe, expect, test } from "bun:test";

import { clearKittyPlacementRegistry } from "@/app-shell/kitty-placement-registry";
import {
  __testing as rendererTesting,
  hashTitleToColor,
  renderPoster,
  resolveAppShellPosterCapability,
} from "@/app-shell/poster-renderer";
import type { ImageCapability } from "@/image";

const originalRuntime = {
  detectImageCapability: rendererTesting.runtime.detectImageCapability,
  which: rendererTesting.runtime.which,
  spawn: rendererTesting.runtime.spawn,
};
const originalStdoutWrite = process.stdout.write.bind(process.stdout);

function capability(renderer: ImageCapability["renderer"]): ImageCapability {
  if (renderer === "none") {
    return {
      terminal: "unknown",
      protocol: "none",
      renderer: "none",
      available: false,
      dependency: "none",
      reason: "test none",
    };
  }
  return {
    terminal: renderer === "kitty-native" ? "kitty" : "unknown",
    protocol: renderer === "kitty-native" ? "kitty" : "symbols",
    renderer,
    available: true,
    dependency: renderer === "kitty-native" ? "none" : "chafa",
    reason: "test",
  };
}

function pngBytes(): ArrayBuffer {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).buffer;
}

afterEach(() => {
  rendererTesting.runtime.detectImageCapability = originalRuntime.detectImageCapability;
  rendererTesting.runtime.which = originalRuntime.which;
  rendererTesting.runtime.spawn = originalRuntime.spawn;
  process.stdout.write = originalStdoutWrite;
  clearKittyPlacementRegistry();
});

describe("app-shell poster renderer", () => {
  test("returns kitty result for kitty-native capability", async () => {
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");
    const writes: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    const result = await renderPoster(pngBytes(), { rows: 4, cols: 8, allowKitty: true });
    expect(result.kind).toBe("kitty");
    expect(writes.join("")).toContain("\x1b_Ga=T,f=100,U=1,q=2");
  });

  test("returns text result for chafa fallback capability", async () => {
    rendererTesting.runtime.detectImageCapability = () => capability("chafa-symbols");
    rendererTesting.runtime.which = () => "/usr/bin/chafa";
    rendererTesting.runtime.spawn = () =>
      ({
        stdout: new Response("ASCII_PREVIEW\n").body,
        stderr: new Response("").body,
        exited: Promise.resolve(0),
      }) as unknown as Bun.Subprocess;

    const result = await renderPoster(pngBytes(), { rows: 3, cols: 6, allowKitty: true });
    expect(result.kind).toBe("text");
    if (result.kind === "text") {
      expect(result.placeholder).toBe("ASCII_PREVIEW");
    }
  });

  test("normalizes Windows Terminal sixel capability to Ink-safe chafa symbols", () => {
    expect(
      resolveAppShellPosterCapability({
        terminal: "windows-terminal",
        protocol: "sixel",
        renderer: "chafa-sixel",
        available: true,
        dependency: "chafa",
        reason: "Windows Terminal detected with chafa",
      }),
    ).toMatchObject({
      terminal: "windows-terminal",
      protocol: "symbols",
      renderer: "chafa-symbols",
      available: true,
      reason: "Windows Terminal detected with chafa; using Ink-safe chafa symbols",
    });
  });

  test("returns none when image capability is unavailable", async () => {
    rendererTesting.runtime.detectImageCapability = () => capability("none");
    const result = await renderPoster(pngBytes(), { rows: 4, cols: 8, allowKitty: true });
    expect(result).toEqual({ kind: "none" });
  });

  test("falls back to chafa symbols when Kitty PNG conversion is unavailable", async () => {
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");
    rendererTesting.runtime.which = (command: string) =>
      command === "chafa" ? "/usr/bin/chafa" : null;
    rendererTesting.runtime.spawn = () =>
      ({
        stdout: new Response("JPEG_FALLBACK\n").body,
        stderr: new Response("").body,
        exited: Promise.resolve(0),
      }) as unknown as Bun.Subprocess;
    process.stdout.write = (() => true) as typeof process.stdout.write;

    // Minimal JPEG SOI marker — ensurePngBytes cannot convert without magick.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).buffer;
    const result = await renderPoster(jpeg, {
      rows: 3,
      cols: 6,
      allowKitty: true,
      placementSlot: "postplay-hero",
    });
    expect(result.kind).toBe("text");
    if (result.kind === "text") {
      expect(result.placeholder).toBe("JPEG_FALLBACK");
    }
  });

  test("registers placement slot without emitting global delete", async () => {
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");
    const writes: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    const first = await renderPoster(pngBytes(), {
      rows: 4,
      cols: 8,
      allowKitty: true,
      placementSlot: "postplay-hero",
    });
    const second = await renderPoster(pngBytes(), {
      rows: 4,
      cols: 8,
      allowKitty: true,
      placementSlot: "postplay-discovery-0",
    });
    expect(first.kind).toBe("kitty");
    expect(second.kind).toBe("kitty");
    expect(writes.join("")).not.toContain("d=A");
    expect(writes.join("")).toContain("a=T,f=100");
  });
});

describe("hashTitleToColor", () => {
  test("returns one of the 4 palette colors for any string", () => {
    const validColors = ["amber", "teal", "purple", "pink"] as const;
    expect(validColors).toContain(hashTitleToColor("Attack on Titan"));
    expect(validColors).toContain(hashTitleToColor("Demon Slayer"));
    expect(validColors).toContain(hashTitleToColor(""));
  });

  test("same title always returns the same color", () => {
    const color1 = hashTitleToColor("Vinland Saga");
    const color2 = hashTitleToColor("Vinland Saga");
    expect(color1).toBe(color2);
  });

  test("different titles usually return different colors", () => {
    const titles = ["Attack on Titan", "Demon Slayer", "Frieren", "Solo Leveling", "Berserk"];
    const colors = titles.map(hashTitleToColor);
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });
});
