// In-process sixel encoding.
//
// Sixel is a palette format from the DEC VT300 series (vt3xx-gp chapter 14):
// pixels are written in horizontal bands six rows tall, one byte per column per
// colour, where the low six bits of `byte - 0x3F` say which of those six rows
// the colour paints. A band is replayed once per colour used in it, with `$`
// returning to the left margin so the passes overlay, and `-` starting the next
// band.
//
// Kunai encodes this itself rather than shelling out to chafa. chafa remains a
// fine encoder, but it is an external binary that most users -- Windows users
// especially -- do not have, and its absence is what silently demoted capable
// terminals to the two-pixels-per-cell half-block fallback. Owning the encoder
// makes sharp posters depend on nothing but the terminal.
//
// Windows Terminal has supported sixel since 1.22; it does not implement the
// kitty graphics protocol, so this is the only true-pixel path there.

import type { DecodedImage } from "./decode";
import { fitDimensions, resampleRgba } from "./renderers/half-block";

/** Sixel introducer. `P2 = 1` makes zero bits transparent rather than background. */
const SIXEL_START = "\x1bP0;1;0q";
const SIXEL_END = "\x1b\\";

/**
 * Palette index 0 is reserved so fully transparent pixels can be *skipped*
 * rather than painted. Posters are rectangular, but overlays and rounded
 * artwork are not, and painting their transparent margin in some arbitrary
 * palette colour is worse than leaving the cell alone.
 */
const TRANSPARENT_INDEX = 0;

/** Below this alpha a pixel is absent, matching the half-block renderer. */
const ALPHA_VISIBILITY_THRESHOLD = 8;

/** Sixel colour registers are 0..100 per channel, not 0..255. */
function toSixelChannel(value: number): number {
  return Math.round((value * 100) / 255);
}

type Rgb = { r: number; g: number; b: number };

type QuantizedImage = {
  readonly width: number;
  readonly height: number;
  /** One palette index per pixel; `TRANSPARENT_INDEX` where the pixel is absent. */
  readonly indices: Uint8Array;
  readonly palette: readonly Rgb[];
};

type BoxSpread = {
  /** Widest channel spread in this box, and the channel it belongs to. */
  readonly spread: number;
  readonly channel: 0 | 1 | 2;
};

type Box = BoxSpread & {
  readonly pixels: Uint32Array;
  readonly offset: number;
  readonly length: number;
};

/**
 * Measure a box's widest channel once, at the moment it is created.
 *
 * All three channels are tracked in a single pass: the pixels are already in
 * cache, and reading them three times costs three times as much for no extra
 * information. The result is stored on the box because a split only changes the
 * two boxes it produces — re-measuring every surviving box on every iteration
 * made palette building O(colours x pixels x 3) when it is naturally linear.
 */
function measureBox(pixels: Uint32Array, offset: number, length: number): BoxSpread {
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;

  for (let p = offset; p < offset + length; p += 1) {
    const packed = pixels[p] ?? 0;
    const r = packed & 0xff;
    const g = (packed >>> 8) & 0xff;
    const b = (packed >>> 16) & 0xff;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }

  // Ties resolve to the lowest channel index, matching a plain 0,1,2 scan.
  const spreadR = maxR - minR;
  const spreadG = maxG - minG;
  const spreadB = maxB - minB;
  if (spreadR >= spreadG && spreadR >= spreadB) return { spread: spreadR, channel: 0 };
  if (spreadG >= spreadB) return { spread: spreadG, channel: 1 };
  return { spread: spreadB, channel: 2 };
}

function createBox(pixels: Uint32Array, offset: number, length: number): Box {
  const { spread, channel } = measureBox(pixels, offset, length);
  return { pixels, offset, length, spread, channel };
}

function channelAt(packed: number, channel: 0 | 1 | 2): number {
  return (packed >>> (channel * 8)) & 0xff;
}

/**
 * Median cut.
 *
 * Repeatedly splits the colour box with the widest channel spread at its median
 * along that channel, so detail is spent where the image actually varies. A
 * fixed colour cube is simpler but wastes most of its registers on colours no
 * poster contains; a poster is a photograph, and its palette is narrow and
 * unevenly distributed.
 */
function medianCut(pixels: Uint32Array, maxColors: number): Rgb[] {
  if (pixels.length === 0) return [{ r: 0, g: 0, b: 0 }];

  const boxes: Box[] = [createBox(pixels, 0, pixels.length)];

  while (boxes.length < maxColors) {
    let target = -1;
    let targetSpread = 0;

    for (const [i, box] of boxes.entries()) {
      if (box.length < 2) continue;
      if (box.spread > targetSpread) {
        targetSpread = box.spread;
        target = i;
      }
    }

    // Every remaining box is a single colour: more registers cannot help.
    const box = boxes[target];
    if (!box || targetSpread === 0) break;
    const targetChannel = box.channel;
    const slice = box.pixels.subarray(box.offset, box.offset + box.length);
    slice.sort((a, b) => channelAt(a, targetChannel) - channelAt(b, targetChannel));

    // Replace the box in place with its two halves. Order matters: selection
    // resolves ties to the lowest index, so appending instead would change
    // which box splits next, and with it the palette.
    const half = box.length >> 1;
    boxes.splice(
      target,
      1,
      createBox(box.pixels, box.offset, half),
      createBox(box.pixels, box.offset + half, box.length - half),
    );
  }

  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let p = box.offset; p < box.offset + box.length; p += 1) {
      const packed = box.pixels[p] ?? 0;
      r += channelAt(packed, 0);
      g += channelAt(packed, 1);
      b += channelAt(packed, 2);
    }
    const n = Math.max(1, box.length);
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  });
}

/** Nearest palette entry by squared distance, memoised per distinct colour. */
function buildMapper(palette: readonly Rgb[]): (packed: number) => number {
  const cache = new Map<number, number>();
  return (packed) => {
    const hit = cache.get(packed);
    if (hit !== undefined) return hit;

    const r = channelAt(packed, 0);
    const g = channelAt(packed, 1);
    const b = channelAt(packed, 2);
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < palette.length; i += 1) {
      // The loop bounds the index to the dense palette built by medianCut.
      // oxlint-disable-next-line eslint/no-non-null-assertion
      const entry = palette[i]!;
      const dr = r - entry.r;
      const dg = g - entry.g;
      const db = b - entry.b;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    cache.set(packed, best);
    return best;
  };
}

function correctedChannel(pixel: number, error: number): number {
  return Math.min(255, Math.max(0, Math.round(pixel + error)));
}

/** Floyd–Steinberg diffusion to the next pixel and three in the next row. */
function diffuseError(
  current: Float32Array,
  next: Float32Array,
  offset: number,
  error: number,
): void {
  const weight = error / 16;
  current[offset + 3] = (current[offset + 3] ?? 0) + weight * 7;
  next[offset - 3] = (next[offset - 3] ?? 0) + weight * 3;
  next[offset] = (next[offset] ?? 0) + weight * 5;
  next[offset + 3] = (next[offset + 3] ?? 0) + weight;
}

function ditherPixels(
  rgba: Uint8Array,
  width: number,
  height: number,
  palette: readonly Rgb[],
): Uint8Array {
  const indices = new Uint8Array(width * height);
  const map = buildMapper(palette);
  // Padding catches error diffused beyond the left and right image edges.
  let current = new Float32Array((width + 2) * 3);
  let next = new Float32Array(current.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const start = pixel * 4;
      if ((rgba[start + 3] ?? 0) < ALPHA_VISIBILITY_THRESHOLD) continue;
      const offset = (x + 1) * 3;
      const r = correctedChannel(rgba[start] ?? 0, current[offset] ?? 0);
      const g = correctedChannel(rgba[start + 1] ?? 0, current[offset + 1] ?? 0);
      const b = correctedChannel(rgba[start + 2] ?? 0, current[offset + 2] ?? 0);
      const index = map(r | (g << 8) | (b << 16));
      const color = palette[index];
      if (!color) continue;
      indices[pixel] = index + 1;
      diffuseError(current, next, offset, r - color.r);
      diffuseError(current, next, offset + 1, g - color.g);
      diffuseError(current, next, offset + 2, b - color.b);
    }
    [current, next] = [next, current];
    next.fill(0);
  }
  return indices;
}

export function quantize(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxColors: number,
): QuantizedImage {
  // Packed straight into the typed array the palette builder wants. A `number[]`
  // of every opaque pixel plus a `Uint32Array.from` copy is two allocations the
  // size of the image, on a path that already blocks the shell while it runs.
  const pixelCount = width * height;
  const opaque = new Uint32Array(pixelCount);
  let opaqueCount = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    if ((rgba[i * 4 + 3] ?? 0) < ALPHA_VISIBILITY_THRESHOLD) continue;
    opaque[opaqueCount] =
      (rgba[i * 4] ?? 0) | ((rgba[i * 4 + 1] ?? 0) << 8) | ((rgba[i * 4 + 2] ?? 0) << 16);
    opaqueCount += 1;
  }

  // One register is spent on transparency, so the palette gets the rest.
  // `subarray` is a view, and median cut sorts its ranges in place — which is
  // exactly what it wants, and why this must not be a copy.
  const palette = medianCut(opaque.subarray(0, opaqueCount), Math.max(1, maxColors - 1));
  return { width, height, indices: ditherPixels(rgba, width, height, palette), palette };
}

/** Emit one band row for a colour, run-length encoding repeated masks. */
function appendRun(out: string[], mask: number, count: number): void {
  const char = String.fromCharCode(0x3f + mask);
  // `!n` costs three characters minimum, so it only pays from four repeats up.
  if (count > 3) {
    out.push(`!${count}${char}`);
    return;
  }
  out.push(char.repeat(count));
}

/**
 * Encode a quantised image as a sixel data stream.
 *
 * Bands are walked colour-by-colour rather than pixel-by-pixel: a band is
 * replayed once per colour it contains, and `$` returns to the left margin so
 * the passes overlay. Writing one row at a time instead is simpler but emits six
 * times the carriage returns and defeats run-length encoding, which matters when
 * a poster is a few hundred kilobytes of escape sequence on every repaint.
 */
export function encodeSixel(image: QuantizedImage): string {
  const { width, height, indices, palette } = image;
  const out: string[] = [SIXEL_START];

  // Aspect ratio 1:1, then the pixel dimensions, so the terminal reserves the
  // right area before any data arrives.
  out.push(`"1;1;${width};${height}`);

  for (const [i, { r, g, b }] of palette.entries()) {
    out.push(`#${i + 1};2;${toSixelChannel(r)};${toSixelChannel(g)};${toSixelChannel(b)}`);
  }

  const bandCount = Math.ceil(height / 6);
  for (let band = 0; band < bandCount; band += 1) {
    const top = band * 6;
    const rows = Math.min(6, height - top);

    // Which colours appear in this band at all — replaying a colour that does
    // not is pure output with no pixels.
    const present = new Set<number>();
    for (let row = 0; row < rows; row += 1) {
      const base = (top + row) * width;
      for (let x = 0; x < width; x += 1) {
        const index = indices[base + x] ?? TRANSPARENT_INDEX;
        if (index !== TRANSPARENT_INDEX) present.add(index);
      }
    }
    if (present.size === 0) {
      out.push("-");
      continue;
    }

    let first = true;
    for (const colorIndex of present) {
      if (!first) out.push("$");
      first = false;
      out.push(`#${colorIndex}`);

      let runMask = -1;
      let runLength = 0;
      for (let x = 0; x < width; x += 1) {
        let mask = 0;
        for (let row = 0; row < rows; row += 1) {
          if (indices[(top + row) * width + x] === colorIndex) mask |= 1 << row;
        }
        if (mask === runMask) {
          runLength += 1;
          continue;
        }
        if (runLength > 0) appendRun(out, runMask, runLength);
        runMask = mask;
        runLength = 1;
      }
      if (runLength > 0) appendRun(out, runMask, runLength);
    }

    out.push("-");
  }

  out.push(SIXEL_END);
  return out.join("");
}

export type SixelRenderOptions = {
  /** Target size in pixels; the image is fitted inside without upscaling. */
  readonly maxWidth: number;
  readonly maxHeight: number;
  /** Palette size including the transparent register. Sixel allows at most 256. */
  readonly maxColors?: number;
  /**
   * PTY-flood guard: fail closed to null past this many encoded bytes. The
   * output is ASCII, so string length is the byte count. Callers that replay
   * the stream after Ink frames (every repaint re-sends every byte) must set
   * this; unbounded replays on ConPTY-class terminals are visible flicker.
   */
  readonly maxBytes?: number;
};

/** Degrade steps before giving up: halve colours, then shrink dimensions. */
const SIXEL_DEGRADE_ATTEMPTS = 4;

export function renderSixelFromImage(
  decoded: DecodedImage,
  options: SixelRenderOptions,
  signal?: AbortSignal,
): string | null {
  if (decoded.width === 0 || decoded.height === 0) return null;
  if (signal?.aborted) return null;

  let width = options.maxWidth;
  let height = options.maxHeight;
  let colors = Math.min(256, Math.max(2, options.maxColors ?? 256));
  for (let attempt = 0; attempt < SIXEL_DEGRADE_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) return null;
    const fitted = fitDimensions(decoded, width, height);
    const resampled = resampleRgba(decoded, fitted.width, fitted.height);
    const sixel = encodeSixel(quantize(resampled, fitted.width, fitted.height, colors));
    if (options.maxBytes === undefined || sixel.length <= options.maxBytes) return sixel;
    if (signal?.aborted) return null;
    // Over budget: colours first (halving the palette roughly halves the
    // per-band passes), then dimensions. Either step alone may suffice, and
    // the loop bounds the extra encode work on the failure path.
    if (colors > 2) {
      colors = Math.max(2, Math.floor(colors / 2));
    } else {
      width = Math.max(1, Math.floor(width * 0.75));
      height = Math.max(1, Math.floor(height * 0.75));
    }
  }
  return null;
}

export const __testing = {
  TRANSPARENT_INDEX,
  SIXEL_START,
  SIXEL_END,
  medianCut,
  toSixelChannel,
};
