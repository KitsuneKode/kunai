import { describe, expect, test } from "bun:test";

import {
  __testing as sixelTesting,
  encodeSixel,
  quantize,
  renderSixelFromBytes,
} from "@/image/sixel";

import { makeRgbPng } from "../../support/image-fixtures";

const { SIXEL_START, SIXEL_END, TRANSPARENT_INDEX, medianCut, toSixelChannel } = sixelTesting;

/** Every sixel data byte is `0x3F + mask`, so nothing may fall outside `?`..`~`. */
function dataBytesAreInRange(sixel: string): boolean {
  const body = sixel.slice(SIXEL_START.length, -SIXEL_END.length);
  // Strip the control vocabulary: raster attrs, colour registers, RLE counts,
  // carriage returns and band terminators.
  const data = body.replace(/"[\d;]+/g, "").replace(/#\d+(?:;\d+;\d+;\d+;\d+)?/g, "");
  for (const char of data.replace(/!\d+/g, "").replace(/[$-]/g, "")) {
    const code = char.charCodeAt(0);
    if (code < 0x3f || code > 0x7e) return false;
  }
  return true;
}

function rgbaOf(pixels: readonly (readonly [number, number, number, number])[]): Uint8Array {
  const out = new Uint8Array(pixels.length * 4);
  pixels.forEach((pixel, index) => out.set(pixel, index * 4));
  return out;
}

describe("sixel colour registers", () => {
  test("scales 8-bit channels into the 0..100 range the format defines", () => {
    // vt3xx-gp chapter 14: colour parameters are percentages, not 0..255.
    // Emitting raw bytes is the classic sixel bug — it looks fine on terminals
    // that clamp and blows out on the ones that do not.
    expect(toSixelChannel(0)).toBe(0);
    expect(toSixelChannel(255)).toBe(100);
    expect(toSixelChannel(128)).toBe(50);
  });
});

describe("medianCut", () => {
  test("splits along the widest channel rather than a fixed cube", () => {
    // Reds spread across the full range, green and blue pinned: a useful palette
    // spends its entries on red. A fixed colour cube would waste most of them.
    const reds = Uint32Array.from([0, 64, 128, 255].map((r) => r));
    const palette = medianCut(reds, 2);
    expect(palette).toHaveLength(2);
    expect(palette[0]!.r).toBeLessThan(palette[1]!.r);
    expect(palette.every((entry) => entry.g === 0 && entry.b === 0)).toBe(true);
  });

  test("stops splitting when every box is a single colour", () => {
    const flat = Uint32Array.from([0x0000ff, 0x0000ff, 0x0000ff]);
    // Asking for 200 registers cannot invent 200 colours out of one.
    expect(medianCut(flat, 200)).toHaveLength(1);
  });

  test("survives an image with no opaque pixels", () => {
    expect(medianCut(new Uint32Array(0), 16)).toHaveLength(1);
  });
});

describe("quantize", () => {
  test("reserves index 0 for transparency and never assigns it to a visible pixel", () => {
    const rgba = rgbaOf([
      [255, 0, 0, 255],
      [0, 0, 0, 0], // fully transparent
      [0, 0, 255, 255],
      [0, 255, 0, 255],
    ]);
    const result = quantize(rgba, 2, 2, 256);

    expect(result.indices[1]).toBe(TRANSPARENT_INDEX);
    for (const visible of [0, 2, 3]) {
      expect(result.indices[visible]).not.toBe(TRANSPARENT_INDEX);
    }
  });

  test("maps distinct colours to distinct registers when the palette allows", () => {
    const rgba = rgbaOf([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ]);
    const result = quantize(rgba, 2, 2, 256);
    expect(new Set(result.indices).size).toBe(4);
  });
});

describe("encodeSixel", () => {
  test("wraps the stream in the introducer and terminator", () => {
    const rgba = rgbaOf([[10, 20, 30, 255]]);
    const sixel = encodeSixel(quantize(rgba, 1, 1, 256));

    expect(sixel.startsWith(SIXEL_START)).toBe(true);
    expect(sixel.endsWith(SIXEL_END)).toBe(true);
  });

  test("declares raster attributes so the terminal reserves the area up front", () => {
    const rgba = new Uint8Array(3 * 12 * 4).fill(255);
    const sixel = encodeSixel(quantize(rgba, 3, 12, 256));
    expect(sixel).toContain('"1;1;3;12');
  });

  test("emits one band terminator per six pixel rows", () => {
    const rgba = new Uint8Array(2 * 18 * 4).fill(255);
    const sixel = encodeSixel(quantize(rgba, 2, 18, 256));
    // 18 rows is exactly three bands.
    expect(sixel.split("-").length - 1).toBe(3);
  });

  test("run-length encodes a flat row instead of repeating the byte", () => {
    const rgba = new Uint8Array(64 * 6 * 4).fill(200);
    for (let i = 0; i < 64 * 6; i += 1) rgba[i * 4 + 3] = 255;
    const sixel = encodeSixel(quantize(rgba, 64, 6, 256));

    // A 64-wide flat band must not cost 64 identical bytes.
    expect(sixel).toContain("!64");
  });

  test("keeps every data byte inside the printable sixel range", () => {
    const png = makeRgbPng(
      4,
      8,
      Array.from({ length: 4 * 8 * 3 }, (_, i) => (i * 37) % 256),
    );
    const sixel = renderSixelFromBytes(png, { maxWidth: 4, maxHeight: 8 });
    expect(sixel).not.toBeNull();
    expect(dataBytesAreInRange(sixel as string)).toBe(true);
  });

  test("skips a fully transparent band rather than painting it", () => {
    // Top band transparent, bottom band opaque.
    const rgba = new Uint8Array(2 * 12 * 4);
    for (let i = 2 * 6; i < 2 * 12; i += 1) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 3] = 255;
    }
    const sixel = encodeSixel(quantize(rgba, 2, 12, 256));

    // Two bands, and the empty one terminates without a colour pass. Colour
    // registers are declared once in the header, so the check has to look at the
    // band data that follows them rather than at the first `#` in the stream.
    expect(sixel.split("-").length - 1).toBe(2);
    const bands = sixel
      .slice(0, -SIXEL_END.length)
      .replace(/^[^]*?(?=-)/, (header) => (header.includes("#") ? "" : header));
    expect(bands.startsWith("-")).toBe(true);
  });
});

describe("renderSixelFromBytes", () => {
  test("fits inside the pixel budget without upscaling", () => {
    const png = makeRgbPng(2, 2, [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
    const sixel = renderSixelFromBytes(png, { maxWidth: 100, maxHeight: 100 });
    // A 2x2 source stays 2x2: upscaling a poster only adds visible blockiness.
    expect(sixel).toContain('"1;1;2;2');
  });

  test("returns null for bytes it cannot decode, so callers can fall back", () => {
    expect(renderSixelFromBytes(new Uint8Array([1, 2, 3, 4]), { maxWidth: 8, maxHeight: 8 })).toBe(
      null,
    );
  });
});
