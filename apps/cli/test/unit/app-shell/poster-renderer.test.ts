import { afterEach, describe, expect, test } from "bun:test";

import { __testing as rendererTesting, renderPoster } from "@/app-shell/poster-renderer";
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

  test("returns none when image capability is unavailable", async () => {
    rendererTesting.runtime.detectImageCapability = () => capability("none");
    const result = await renderPoster(pngBytes(), { rows: 4, cols: 8, allowKitty: true });
    expect(result).toEqual({ kind: "none" });
  });
});
