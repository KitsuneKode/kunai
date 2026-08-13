import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { decodePng } from "@/image/decode";
import {
  MAX_POSTER_DECODED_PIXELS,
  MAX_POSTER_SOURCE_BYTES,
  preparePoster,
} from "@/image/native-image";

import {
  makeIndexedGif,
  makeRgbBmp,
  makeRgbJpeg,
  makeRgbPng,
  withExifOrientation,
} from "../../support/image-fixtures";

// ---------------------------------------------------------------------------
// `preparePoster()` reads `Bun.Image` through a call-time lookup, which is the
// seam these tests use: swap in a recording constructor to assert the exact
// native API, or leave the real one in place to assert real decode behaviour.
// ---------------------------------------------------------------------------

const bunGlobal = Bun as unknown as { Image?: unknown };
const realImageCtor = bunGlobal.Image;

afterEach(() => {
  bunGlobal.Image = realImageCtor;
});

function gradient(width: number, height: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < width * height; index += 1) {
    out.push((index * 37) % 256, (index * 91) % 256, (index * 17) % 256);
  }
  return out;
}

async function dimensionsOf(png: Uint8Array): Promise<{ width: number; height: number }> {
  const decoded = decodePng(png);
  return { width: decoded.width, height: decoded.height };
}

describe("preparePoster — native API contract", () => {
  type ConstructorCall = { bytes: Uint8Array; options: unknown };
  type ResizeCall = { width: number; height: number; options: unknown };

  let constructorCalls: ConstructorCall[];
  let resizeCalls: ResizeCall[];

  /** Installs a recording stand-in that returns `output` from `.bytes()`. */
  function installRecordingCtor(output: Uint8Array, behaviour: { throwOn?: "construct" } = {}) {
    constructorCalls = [];
    resizeCalls = [];
    class RecordingImage {
      constructor(bytes: Uint8Array, options: unknown) {
        constructorCalls.push({ bytes, options });
        if (behaviour.throwOn === "construct") {
          throw new Error("Image: input exceeds maxPixels limit");
        }
      }
      resize(width: number, height: number, options: unknown) {
        resizeCalls.push({ width, height, options });
        return this;
      }
      png() {
        return this;
      }
      bytes() {
        return Promise.resolve(output);
      }
    }
    bunGlobal.Image = RecordingImage;
  }

  test("constructs with the documented pixel ceiling and auto-orientation", async () => {
    const png = makeRgbPng(20, 10, gradient(20, 10));
    installRecordingCtor(png);
    const bytes = makeRgbPng(40, 20, gradient(40, 20));

    await preparePoster(bytes, { maxWidthPx: 20, maxHeightPx: 20 });

    expect(constructorCalls).toEqual([
      {
        bytes,
        options: {
          maxPixels: 4096 * 4096,
          autoOrient: true,
        },
      },
    ]);
    expect(MAX_POSTER_DECODED_PIXELS).toBe(4096 * 4096);
  });

  test("resizes exactly once, inside the bounds, without enlarging", async () => {
    const png = makeRgbPng(20, 10, gradient(20, 10));
    installRecordingCtor(png);

    await preparePoster(makeRgbPng(40, 20, gradient(40, 20)), {
      maxWidthPx: 20,
      maxHeightPx: 20,
    });

    expect(resizeCalls).toEqual([
      {
        width: 20,
        height: 20,
        options: {
          fit: "inside",
          withoutEnlargement: true,
        },
      },
    ]);
  });

  test("never passes the abort signal into the native call", async () => {
    installRecordingCtor(makeRgbPng(4, 4, gradient(4, 4)));
    const controller = new AbortController();

    await preparePoster(
      makeRgbPng(8, 8, gradient(8, 8)),
      { maxWidthPx: 4, maxHeightPx: 4 },
      controller.signal,
    );

    // Bun.Image takes no signal; cancellation has to surround the native work
    // rather than enter it, so nothing signal-shaped may reach these options.
    const options = JSON.stringify([constructorCalls[0]?.options, resizeCalls[0]?.options]);
    expect(options).not.toContain("signal");
    expect(options).not.toContain("abort");
  });

  test("returns null when the native constructor rejects the input", async () => {
    installRecordingCtor(new Uint8Array(), { throwOn: "construct" });

    const prepared = await preparePoster(makeRgbPng(8, 8, gradient(8, 8)), {
      maxWidthPx: 4,
      maxHeightPx: 4,
    });

    expect(prepared).toBeNull();
  });

  test("returns null when this Bun build exposes no Bun.Image", async () => {
    bunGlobal.Image = undefined;

    const prepared = await preparePoster(makeRgbPng(8, 8, gradient(8, 8)), {
      maxWidthPx: 4,
      maxHeightPx: 4,
    });

    expect(prepared).toBeNull();
  });

  test("returns null when the native side yields a PNG the decoder rejects", async () => {
    installRecordingCtor(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));

    const prepared = await preparePoster(makeRgbPng(8, 8, gradient(8, 8)), {
      maxWidthPx: 4,
      maxHeightPx: 4,
    });

    expect(prepared).toBeNull();
  });
});

describe("preparePoster — bounds", () => {
  test("fits a landscape source inside the box, preserving aspect", async () => {
    const prepared = await preparePoster(makeRgbPng(40, 20, gradient(40, 20)), {
      maxWidthPx: 20,
      maxHeightPx: 20,
    });

    expect(prepared).not.toBeNull();
    // "inside" fits the whole image within the box; a fill/cover would have
    // produced 20x20 and cropped.
    expect(await dimensionsOf(prepared!.png)).toEqual({ width: 20, height: 10 });
    expect(prepared!.image.width).toBe(20);
    expect(prepared!.image.height).toBe(10);
  });

  test("fits a portrait source inside the box, preserving aspect", async () => {
    const prepared = await preparePoster(makeRgbPng(20, 40, gradient(20, 40)), {
      maxWidthPx: 20,
      maxHeightPx: 20,
    });

    expect(await dimensionsOf(prepared!.png)).toEqual({ width: 10, height: 20 });
  });

  test("does not enlarge a source smaller than the box", async () => {
    const prepared = await preparePoster(makeRgbPng(2, 4, gradient(2, 4)), {
      maxWidthPx: 20,
      maxHeightPx: 20,
    });

    // Upscaling a 2x4 poster to 20x40 would waste both the native pass and the
    // decode on invented pixels.
    expect(await dimensionsOf(prepared!.png)).toEqual({ width: 2, height: 4 });
  });

  test("honours EXIF orientation, swapping the fitted axes", async () => {
    const rotated = withExifOrientation(makeRgbJpeg(2, 3, gradient(2, 3)), 6);

    const prepared = await preparePoster(rotated, { maxWidthPx: 30, maxHeightPx: 30 });

    // Orientation 6 means "rotate 90° clockwise to display", so the 2x3 source
    // must present as 3x2. Without autoOrient it would stay 2x3 and render
    // sideways.
    expect(await dimensionsOf(prepared!.png)).toEqual({ width: 3, height: 2 });
  });

  test.each([
    ["zero width", { maxWidthPx: 0, maxHeightPx: 10 }],
    ["zero height", { maxWidthPx: 10, maxHeightPx: 0 }],
    ["negative width", { maxWidthPx: -10, maxHeightPx: 10 }],
    ["fractional height", { maxWidthPx: 10, maxHeightPx: 10.5 }],
    ["non-finite width", { maxWidthPx: Number.POSITIVE_INFINITY, maxHeightPx: 10 }],
    ["NaN height", { maxWidthPx: 10, maxHeightPx: Number.NaN }],
  ])("rejects %s", async (_label, bounds) => {
    expect(await preparePoster(makeRgbPng(8, 8, gradient(8, 8)), bounds)).toBeNull();
  });
});

describe("preparePoster — source formats", () => {
  test("prepares a PNG source", async () => {
    const prepared = await preparePoster(makeRgbPng(30, 20, gradient(30, 20)), {
      maxWidthPx: 15,
      maxHeightPx: 15,
    });
    expect(prepared?.image.width).toBe(15);
  });

  test("prepares a JPEG source", async () => {
    const prepared = await preparePoster(makeRgbJpeg(30, 20, gradient(30, 20)), {
      maxWidthPx: 15,
      maxHeightPx: 15,
    });
    expect(prepared?.image.width).toBe(15);
  });

  test("prepares a WebP source", async () => {
    // WebP has no encoder in test support, so round-trip one through the same
    // native surface the production path uses.
    const Ctor = realImageCtor as new (
      input: Uint8Array,
      options: unknown,
    ) => {
      webp: () => { bytes: () => Promise<Uint8Array> };
    };
    const webp = new Uint8Array(
      await new Ctor(makeRgbPng(30, 20, gradient(30, 20)), {
        maxPixels: MAX_POSTER_DECODED_PIXELS,
        autoOrient: true,
      })
        .webp()
        .bytes(),
    );

    const prepared = await preparePoster(webp, { maxWidthPx: 15, maxHeightPx: 15 });
    expect(prepared?.image.width).toBe(15);
  });

  test("prepares a BMP source", async () => {
    const prepared = await preparePoster(makeRgbBmp(30, 20, gradient(30, 20)), {
      maxWidthPx: 15,
      maxHeightPx: 15,
    });
    expect(prepared?.image.width).toBe(15);
  });

  test("prepares a single-frame GIF source", async () => {
    const gif = makeIndexedGif(
      3,
      2,
      [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 0],
      ],
      [0, 1, 2, 3, 0, 1],
    );

    const prepared = await preparePoster(gif, { maxWidthPx: 30, maxHeightPx: 30 });

    // Animated-GIF frame selection is deliberately not a contract here; only
    // that a single-frame GIF prepares at all.
    expect(prepared?.image.width).toBe(3);
  });

  test("returns null for bytes that are not an image at all", async () => {
    const junk = new Uint8Array(64);
    junk.fill(0x7f);
    expect(await preparePoster(junk, { maxWidthPx: 10, maxHeightPx: 10 })).toBeNull();
  });

  test("returns null for a truncated image", async () => {
    const corrupt = makeRgbPng(20, 20, gradient(20, 20)).subarray(0, 30);
    expect(await preparePoster(corrupt, { maxWidthPx: 10, maxHeightPx: 10 })).toBeNull();
  });

  test("returns null for empty input", async () => {
    expect(await preparePoster(new Uint8Array(), { maxWidthPx: 10, maxHeightPx: 10 })).toBeNull();
  });
});

describe("preparePoster — encoded size limit", () => {
  test("accepts input at exactly the limit", async () => {
    const png = makeRgbPng(4, 4, gradient(4, 4));
    const calls: number[] = [];
    class SizedImage {
      constructor(bytes: Uint8Array) {
        calls.push(bytes.byteLength);
      }
      resize() {
        return this;
      }
      png() {
        return this;
      }
      bytes() {
        return Promise.resolve(png);
      }
    }
    bunGlobal.Image = SizedImage;

    const atLimit = new Uint8Array(MAX_POSTER_SOURCE_BYTES);
    const prepared = await preparePoster(atLimit, { maxWidthPx: 4, maxHeightPx: 4 });

    expect(calls).toEqual([MAX_POSTER_SOURCE_BYTES]);
    expect(prepared).not.toBeNull();
  });

  test("rejects one byte over the limit before constructing anything", async () => {
    let constructed = 0;
    class CountingImage {
      constructor() {
        constructed += 1;
      }
      resize() {
        return this;
      }
      png() {
        return this;
      }
      bytes() {
        return Promise.resolve(new Uint8Array());
      }
    }
    bunGlobal.Image = CountingImage;

    const overLimit = new Uint8Array(MAX_POSTER_SOURCE_BYTES + 1);
    expect(await preparePoster(overLimit, { maxWidthPx: 4, maxHeightPx: 4 })).toBeNull();

    // The point of the limit is to refuse before allocating a decode buffer.
    expect(constructed).toBe(0);
  });

  test("states the limit as 16 MiB", () => {
    expect(MAX_POSTER_SOURCE_BYTES).toBe(16 * 1024 * 1024);
  });
});

describe("preparePoster — cancellation", () => {
  test("does no native work at all when already aborted", async () => {
    let constructed = 0;
    class CountingImage {
      constructor() {
        constructed += 1;
      }
      resize() {
        return this;
      }
      png() {
        return this;
      }
      bytes() {
        return Promise.resolve(new Uint8Array());
      }
    }
    bunGlobal.Image = CountingImage;
    const controller = new AbortController();
    controller.abort();

    const prepared = await preparePoster(
      makeRgbPng(8, 8, gradient(8, 8)),
      { maxWidthPx: 4, maxHeightPx: 4 },
      controller.signal,
    );

    expect(prepared).toBeNull();
    expect(constructed).toBe(0);
  });

  test("discards a result aborted while the PNG bytes were pending", async () => {
    const controller = new AbortController();
    const png = makeRgbPng(4, 4, gradient(4, 4));
    class SlowImage {
      resize() {
        return this;
      }
      png() {
        return this;
      }
      async bytes() {
        // Abort lands while the native encode is still outstanding, which is
        // the realistic case: the user navigated on during preparation.
        controller.abort();
        return png;
      }
    }
    bunGlobal.Image = SlowImage;

    const prepared = await preparePoster(
      makeRgbPng(8, 8, gradient(8, 8)),
      { maxWidthPx: 4, maxHeightPx: 4 },
      controller.signal,
    );

    expect(prepared).toBeNull();
  });

  test("returns a prepared poster when the signal never fires", async () => {
    const controller = new AbortController();

    const prepared = await preparePoster(
      makeRgbPng(40, 20, gradient(40, 20)),
      { maxWidthPx: 20, maxHeightPx: 20 },
      controller.signal,
    );

    expect(prepared).not.toBeNull();
    expect(controller.signal.aborted).toBe(false);
  });
});

describe("preparePoster — failure logging", () => {
  const logs: string[] = [];
  const realLog = console.log;
  const realFlag = process.env.KUNAI_IMAGE_DEBUG;

  beforeEach(() => {
    logs.length = 0;
    process.env.KUNAI_IMAGE_DEBUG = "1";
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = realLog;
    if (realFlag === undefined) delete process.env.KUNAI_IMAGE_DEBUG;
    else process.env.KUNAI_IMAGE_DEBUG = realFlag;
  });

  test("logs a bare category and never the native exception text", async () => {
    class LeakyImage {
      constructor() {
        throw new Error("secret-poster-path /home/someone/Pictures/leak.png failed");
      }
      resize() {
        return this;
      }
      png() {
        return this;
      }
      bytes() {
        return Promise.resolve(new Uint8Array());
      }
    }
    bunGlobal.Image = LeakyImage;

    await preparePoster(makeRgbPng(8, 8, gradient(8, 8)), { maxWidthPx: 4, maxHeightPx: 4 });

    const combined = logs.join("\n");
    expect(combined).toContain("[kunai:image]");
    // A poster path or native message in a log is a privacy leak, and these
    // logs are what users paste into issues.
    expect(combined).not.toContain("secret-poster-path");
    expect(combined).not.toContain("leak.png");
  });

  test("logs the oversize category without the byte payload", async () => {
    await preparePoster(new Uint8Array(MAX_POSTER_SOURCE_BYTES + 1), {
      maxWidthPx: 4,
      maxHeightPx: 4,
    });

    expect(logs.join("\n")).toContain("input-too-large");
  });

  test("logs the invalid-bounds category", async () => {
    await preparePoster(makeRgbPng(8, 8, gradient(8, 8)), { maxWidthPx: 0, maxHeightPx: 0 });

    expect(logs.join("\n")).toContain("invalid-bounds");
  });
});
