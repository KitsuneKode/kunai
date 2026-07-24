import { afterEach, describe, expect, test } from "bun:test";

import { clearKittyPlacementRegistry } from "@/app-shell/kitty-placement-registry";
import {
  __testing as rendererTesting,
  hashTitleToColor,
  renderPoster,
  resolveAppShellPosterCapability,
} from "@/app-shell/poster-renderer";
import type { ImageCapability } from "@/image";
import { __testing as probeTesting } from "@/image/probe";

import { makeRgbJpeg, makeRgbPng } from "../../support/image-fixtures";

const originalRuntime = {
  detectImageCapability: rendererTesting.runtime.detectImageCapability,
  which: rendererTesting.runtime.which,
  spawn: rendererTesting.runtime.spawn,
};
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalTransportEnv = process.env.KUNAI_IMAGE_TRANSPORT;

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
  if (renderer === "half-block") {
    return {
      terminal: "windows-terminal",
      protocol: "half-block",
      renderer: "half-block",
      available: true,
      dependency: "none",
      reason: "test half-block",
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

/** Hermetic escape assertions: force chunked base64 instead of t=t temp files. */
function forceDirectTransport(): void {
  process.env.KUNAI_IMAGE_TRANSPORT = "direct";
}

function pngBytes(): ArrayBuffer {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).buffer;
}

function captureStdout(): { writes: string[] } {
  const writes: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  return { writes };
}

afterEach(() => {
  rendererTesting.runtime.detectImageCapability = originalRuntime.detectImageCapability;
  rendererTesting.runtime.which = originalRuntime.which;
  rendererTesting.runtime.spawn = originalRuntime.spawn;
  process.stdout.write = originalStdoutWrite;
  if (originalTransportEnv === undefined) {
    delete process.env.KUNAI_IMAGE_TRANSPORT;
  } else {
    process.env.KUNAI_IMAGE_TRANSPORT = originalTransportEnv;
  }
  probeTesting.reset();
  clearKittyPlacementRegistry();
});

describe("app-shell poster renderer", () => {
  test("returns kitty result for kitty-native capability", async () => {
    forceDirectTransport();
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");
    const { writes } = captureStdout();

    const result = await renderPoster(pngBytes(), { rows: 4, cols: 8, allowKitty: true });
    expect(result.kind).toBe("kitty");
    expect(writes.join("")).toContain("\x1b_Ga=T,f=100,U=1,q=2");
  });

  test("uploads TMDB JPEG posters to kitty as compressed RGBA without magick or chafa", async () => {
    forceDirectTransport();
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");
    rendererTesting.runtime.which = () => null;
    rendererTesting.runtime.spawn = () => {
      throw new Error("chafa must not spawn on the kitty path");
    };
    const { writes } = captureStdout();

    const jpeg = makeRgbJpeg(
      8,
      4,
      Array.from({ length: 8 * 4 * 3 }, (_, i) => i % 256),
    );
    const result = await renderPoster(jpeg.buffer as ArrayBuffer, {
      rows: 2,
      cols: 4,
      allowKitty: true,
    });
    expect(result.kind).toBe("kitty");
    const out = writes.join("");
    expect(out).toContain("f=32,s=8,v=4,o=z");
    expect(out).toContain("U=1");
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

  test("renders half-block text without chafa for half-block capability", async () => {
    rendererTesting.runtime.detectImageCapability = () => capability("half-block");
    rendererTesting.runtime.which = () => null;
    rendererTesting.runtime.spawn = () => {
      throw new Error("chafa must not spawn on the half-block path");
    };

    // 2x2 red over blue pixels — real bytes, decoded in-process.
    const png = makeRgbPng(2, 2, [255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255]);
    const result = await renderPoster(png.buffer as ArrayBuffer, {
      rows: 2,
      cols: 2,
      allowKitty: true,
    });
    expect(result.kind).toBe("text");
    if (result.kind === "text") {
      expect(result.placeholder).toContain("▀");
      expect(result.placeholder).toContain("38;2;");
    }
  });

  test("falls back to half-block text when chafa-symbols capability has no chafa binary", async () => {
    rendererTesting.runtime.detectImageCapability = () => capability("chafa-symbols");
    rendererTesting.runtime.which = () => null;

    const png = makeRgbPng(2, 2, [255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255]);
    const result = await renderPoster(png.buffer as ArrayBuffer, {
      rows: 2,
      cols: 2,
      allowKitty: true,
    });
    expect(result.kind).toBe("text");
    if (result.kind === "text") {
      expect(result.placeholder).toContain("▀");
    }
  });

  test("inkEmbedded renders half-block text when chafa is missing", async () => {
    rendererTesting.runtime.which = () => null;

    const png = makeRgbPng(2, 2, [255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255]);
    const result = await renderPoster(png.buffer as ArrayBuffer, {
      rows: 2,
      cols: 2,
      inkEmbedded: true,
    });
    expect(result.kind).toBe("text");
    if (result.kind === "text") {
      expect(result.placeholder).toContain("▀");
    }
  });

  test("probe-detected kitty on a placeholder-less terminal stays on text renderers", async () => {
    rendererTesting.runtime.detectImageCapability = () => ({
      terminal: "wezterm",
      protocol: "kitty",
      renderer: "kitty-native",
      available: true,
      dependency: "none",
      reason: "terminal answered the kitty graphics query",
    });
    rendererTesting.runtime.which = () => null;
    const { writes } = captureStdout();

    const png = makeRgbPng(2, 2, [255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255]);
    const result = await renderPoster(png.buffer as ArrayBuffer, {
      rows: 2,
      cols: 2,
      allowKitty: true,
    });
    // WezTerm's opt-in kitty mode has no Unicode placeholders — Ink layout wins.
    expect(writes.join("")).not.toContain("\x1b_G");
    expect(result.kind).toBe("text");
  });

  test("probe-detected kitty on an unknown terminal still uses kitty placeholders", async () => {
    forceDirectTransport();
    probeTesting.setProbed({ sixel: false, kittyGraphics: true });
    rendererTesting.runtime.detectImageCapability = () => ({
      terminal: "unknown",
      protocol: "kitty",
      renderer: "kitty-native",
      available: true,
      dependency: "none",
      reason: "terminal answered the kitty graphics query",
    });
    const { writes } = captureStdout();

    const result = await renderPoster(pngBytes(), { rows: 4, cols: 8, allowKitty: true });
    expect(result.kind).toBe("kitty");
    expect(writes.join("")).toContain("U=1");
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

  test("falls back to text renderers when Kitty payload preparation fails", async () => {
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

    // Truncated JPEG SOI — undecodable in-process and unconvertible.
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
    forceDirectTransport();
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");
    const { writes } = captureStdout();

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
