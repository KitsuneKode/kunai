// Proof that pixels actually reach the terminal.
//
// The rest of the image suite is protocol-level: it asserts control keys,
// transmission-mode selection, and capability routing. All of it would still
// pass if rendering silently produced nothing, because none of it looks at a
// rendered cell. This file closes that gap.
//
// Half-block is the renderer worth asserting: it is in-process and
// deterministic, needs no chafa, no ImageMagick, and no kitty-capable terminal,
// so it runs identically in CI on every platform. It is also the path most
// users actually hit — Windows and any machine without chafa.

import { describe, expect, test } from "bun:test";

import { renderPoster, __testing as rendererTesting } from "@/app-shell/poster-renderer";
import type { ImageCapability } from "@/image";

import { makeRgbPng } from "../../support/image-fixtures";

const HALF_BLOCK_CAPABILITY: ImageCapability = {
  terminal: "windows-terminal",
  protocol: "half-block",
  renderer: "half-block",
  available: true,
  dependency: "none",
  reason: "pixel fidelity test",
};

// Built from a constant rather than written inline: a literal ESC inside a
// regex trips `no-control-regex`, and naming the SGR parameter keeps the two
// patterns obviously parallel.
const ESC = "";
const truecolorPattern = (sgrParameter: 38 | 48): RegExp =>
  new RegExp(`${ESC}\\[${String(sgrParameter)};2;(\\d+);(\\d+);(\\d+)m`, "g");

function colorsMatching(text: string, sgrParameter: 38 | 48): string[] {
  return [...text.matchAll(truecolorPattern(sgrParameter))].map((m) => `${m[1]},${m[2]},${m[3]}`);
}

/** Foreground (top pixel) truecolour triples, in emission order. */
function foregroundColors(text: string): string[] {
  return colorsMatching(text, 38);
}

/** Background (bottom pixel) truecolour triples, in emission order. */
function backgroundColors(text: string): string[] {
  return colorsMatching(text, 48);
}

async function renderHalfBlock(png: Uint8Array, cols: number, rows: number): Promise<string> {
  const original = rendererTesting.runtime.detectImageCapability;
  const originalWhich = rendererTesting.runtime.which;
  rendererTesting.runtime.detectImageCapability = () => HALF_BLOCK_CAPABILITY;
  // No chafa on PATH: force the in-process renderer rather than a subprocess.
  rendererTesting.runtime.which = () => null;
  try {
    const result = await renderPoster(png.buffer as ArrayBuffer, { rows, cols, allowKitty: true });
    expect(result.kind).toBe("text");
    return result.kind === "text" ? result.placeholder : "";
  } finally {
    rendererTesting.runtime.detectImageCapability = original;
    rendererTesting.runtime.which = originalWhich;
  }
}

describe("half-block pixel fidelity", () => {
  test("source pixels survive the pipeline into truecolour cells", async () => {
    // One cell tall: top row red, bottom row blue. U+2580 paints the top pixel
    // as foreground and the bottom as background, so a faithful render must emit
    // exactly one 38;2;255;0;0 and one 48;2;0;0;255.
    const png = makeRgbPng(1, 2, [255, 0, 0, 0, 0, 255]);

    const text = await renderHalfBlock(png, 1, 1);

    expect(text).toContain("▀");
    expect(foregroundColors(text)).toEqual(["255,0,0"]);
    expect(backgroundColors(text)).toEqual(["0,0,255"]);
  });

  test("distinct columns keep their own colours and order", async () => {
    // Emission order is left-to-right, so a transposed or mirrored pipeline
    // fails here.
    const RED = [255, 0, 0];
    const GREEN = [0, 255, 0];
    const BLUE = [0, 0, 255];
    const WHITE = [255, 255, 255];
    const png = makeRgbPng(2, 2, [...RED, ...GREEN, ...BLUE, ...WHITE]);

    const text = await renderHalfBlock(png, 2, 1);

    expect(foregroundColors(text)).toEqual(["255,0,0", "0,255,0"]);
    expect(backgroundColors(text)).toEqual(["0,0,255", "255,255,255"]);
  });

  test("a rendered cell is emitted for every requested row", async () => {
    // 2 cell rows = 4 pixel rows, each a distinct grey so nothing can collapse.
    const png = makeRgbPng(1, 4, [16, 16, 16, 64, 64, 64, 128, 128, 128, 200, 200, 200]);

    const text = await renderHalfBlock(png, 1, 2);

    expect(text.split("\n")).toHaveLength(2);
    expect(foregroundColors(text)).toEqual(["16,16,16", "128,128,128"]);
    expect(backgroundColors(text)).toEqual(["64,64,64", "200,200,200"]);
  });

  test("an undecodable payload renders nothing rather than garbage", async () => {
    const original = rendererTesting.runtime.detectImageCapability;
    const originalWhich = rendererTesting.runtime.which;
    rendererTesting.runtime.detectImageCapability = () => HALF_BLOCK_CAPABILITY;
    rendererTesting.runtime.which = () => null;
    try {
      const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const result = await renderPoster(junk.buffer as ArrayBuffer, {
        rows: 2,
        cols: 2,
        allowKitty: true,
      });
      expect(result.kind).toBe("none");
    } finally {
      rendererTesting.runtime.detectImageCapability = original;
      rendererTesting.runtime.which = originalWhich;
    }
  });
});
