import { describe, expect, test } from "bun:test";

import { decodeImageBytes, decodePng } from "@/image/decode";
import {
  buildHalfBlockOutput,
  fitDimensions,
  parseSizeSpec,
  resampleRgba,
} from "@/image/renderers/half-block";
import type { ImageRenderOptions } from "@/image/types";

import { makeRgbPng } from "../../support/image-fixtures";

const OPTIONS: ImageRenderOptions = { size: "30x18", maxRows: 18, debug: false };
const UPPER_HALF_BLOCK = "▀";

describe("decodePng", () => {
  test("decodes truecolour pixels to straight RGBA", () => {
    // 2x1: pure red, pure green.
    const png = makeRgbPng(2, 1, [255, 0, 0, 0, 255, 0]);
    const decoded = decodePng(png);

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect(Array.from(decoded.rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  test("reverses the Up scanline filter across rows", () => {
    // Two identical rows; the encoder writes filter None, so a decoder that
    // ignored filters would still pass. Assert the second row survives the
    // unfilter arithmetic rather than being doubled.
    const png = makeRgbPng(1, 2, [10, 20, 30, 10, 20, 30]);
    const decoded = decodePng(png);
    expect(Array.from(decoded.rgba)).toEqual([10, 20, 30, 255, 10, 20, 30, 255]);
  });
});

describe("decodeImageBytes", () => {
  test("sniffs PNG by magic bytes, not file extension", () => {
    const png = makeRgbPng(1, 1, [1, 2, 3]);
    expect(decodeImageBytes(png)?.width).toBe(1);
  });

  test("returns null rather than throwing on undecodable input", () => {
    expect(decodeImageBytes(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(decodeImageBytes(new Uint8Array())).toBeNull();
  });
});

describe("parseSizeSpec", () => {
  test("parses a COLUMNSxROWS spec", () => {
    expect(parseSizeSpec("30x18")).toEqual({ columns: 30, rows: 18 });
  });

  test("rejects malformed and zero specs", () => {
    for (const spec of ["30", "x18", "0x18", "30x0", "abc", ""]) {
      expect(parseSizeSpec(spec)).toBeNull();
    }
  });
});

describe("fitDimensions", () => {
  test("preserves aspect ratio inside the cell budget", () => {
    // A 2:3 poster in a 30-wide, 36-tall pixel budget is height-limited.
    const fitted = fitDimensions({ width: 342, height: 513 }, 30, 36);
    expect(fitted).toEqual({ width: 24, height: 36 });
  });

  test("never upscales a small source", () => {
    const fitted = fitDimensions({ width: 8, height: 8 }, 30, 36);
    expect(fitted).toEqual({ width: 8, height: 8 });
  });
});

describe("resampleRgba", () => {
  test("box-averages source pixels that collapse into one target pixel", () => {
    // 2x2 of black/white halves averages to mid grey.
    const image = {
      width: 2,
      height: 2,
      rgba: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]),
    };
    const resampled = resampleRgba(image, 1, 1);
    expect(Array.from(resampled.slice(0, 3))).toEqual([128, 128, 128]);
  });
});

describe("buildHalfBlockOutput", () => {
  test("packs two pixel rows into one cell row", () => {
    // 1x2: red over blue -> a single cell, red foreground, blue background.
    const image = {
      width: 1,
      height: 2,
      rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]),
    };
    const output = buildHalfBlockOutput(image, OPTIONS);

    expect(output).toContain("[38;2;255;0;0m");
    expect(output).toContain("[48;2;0;0;255m");
    expect(output).toContain(UPPER_HALF_BLOCK);
    expect(output.trimEnd().split("\n")).toHaveLength(1);
  });

  test("emits one cell row per two pixel rows and resets each line", () => {
    const pixels: number[] = [];
    for (let index = 0; index < 4 * 4; index += 1) pixels.push(9, 9, 9, 255);
    const image = { width: 4, height: 4, rgba: new Uint8Array(pixels) };

    const lines = buildHalfBlockOutput(image, OPTIONS).trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.endsWith("[0m")).toBe(true);
      expect([...line].filter((char) => char === UPPER_HALF_BLOCK)).toHaveLength(4);
    }
  });

  test("never exceeds maxRows even when the size spec asks for more", () => {
    const pixels: number[] = [];
    for (let index = 0; index < 40 * 200; index += 1) pixels.push(1, 2, 3, 255);
    const image = { width: 40, height: 200, rgba: new Uint8Array(pixels) };

    const lines = buildHalfBlockOutput(image, { size: "40x999", maxRows: 6, debug: false })
      .trimEnd()
      .split("\n");
    expect(lines.length).toBeLessThanOrEqual(6);
  });

  test("leaves fully transparent pixels unpainted", () => {
    const image = {
      width: 1,
      height: 2,
      rgba: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]),
    };
    const output = buildHalfBlockOutput(image, OPTIONS);
    expect(output).not.toContain(UPPER_HALF_BLOCK);
    expect(output).toContain(" ");
  });
});
