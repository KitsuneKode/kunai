// =============================================================================
// sixel.ts — in-process sixel encoding.
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
// =============================================================================

import { decodeImageBytes, type DecodedImage } from "./decode";
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

type Box = {
  readonly pixels: Uint32Array;
  readonly offset: number;
  readonly length: number;
};

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

  let boxes: Box[] = [{ pixels, offset: 0, length: pixels.length }];

  while (boxes.length < maxColors) {
    let target = -1;
    let targetSpread = 0;
    let targetChannel: 0 | 1 | 2 = 0;

    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i] as Box;
      if (box.length < 2) continue;
      for (const channel of [0, 1, 2] as const) {
        let min = 255;
        let max = 0;
        for (let p = box.offset; p < box.offset + box.length; p += 1) {
          const value = channelAt(box.pixels[p] as number, channel);
          if (value < min) min = value;
          if (value > max) max = value;
        }
        const spread = max - min;
        if (spread > targetSpread) {
          targetSpread = spread;
          target = i;
          targetChannel = channel;
        }
      }
    }

    // Every remaining box is a single colour: more registers cannot help.
    if (target === -1 || targetSpread === 0) break;

    const box = boxes[target] as Box;
    const slice = box.pixels.subarray(box.offset, box.offset + box.length);
    slice.sort((a, b) => channelAt(a, targetChannel) - channelAt(b, targetChannel));

    const half = box.length >> 1;
    boxes = [
      ...boxes.slice(0, target),
      { pixels: box.pixels, offset: box.offset, length: half },
      { pixels: box.pixels, offset: box.offset + half, length: box.length - half },
      ...boxes.slice(target + 1),
    ];
  }

  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let p = box.offset; p < box.offset + box.length; p += 1) {
      const packed = box.pixels[p] as number;
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
      const entry = palette[i] as Rgb;
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

export function quantize(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxColors: number,
): QuantizedImage {
  const opaque: number[] = [];
  for (let i = 0; i < width * height; i += 1) {
    if ((rgba[i * 4 + 3] as number) < ALPHA_VISIBILITY_THRESHOLD) continue;
    opaque.push(
      (rgba[i * 4] as number) |
        ((rgba[i * 4 + 1] as number) << 8) |
        ((rgba[i * 4 + 2] as number) << 16),
    );
  }

  // One register is spent on transparency, so the palette gets the rest.
  const palette = medianCut(Uint32Array.from(opaque), Math.max(1, maxColors - 1));
  const map = buildMapper(palette);

  const indices = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    if ((rgba[i * 4 + 3] as number) < ALPHA_VISIBILITY_THRESHOLD) {
      indices[i] = TRANSPARENT_INDEX;
      continue;
    }
    const packed =
      (rgba[i * 4] as number) |
      ((rgba[i * 4 + 1] as number) << 8) |
      ((rgba[i * 4 + 2] as number) << 16);
    // +1 because index 0 belongs to transparency.
    indices[i] = map(packed) + 1;
  }

  return { width, height, indices, palette };
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

  for (let i = 0; i < palette.length; i += 1) {
    const { r, g, b } = palette[i] as Rgb;
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
        const index = indices[base + x] as number;
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
          if ((indices[(top + row) * width + x] as number) === colorIndex) mask |= 1 << row;
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
};

/**
 * Decode, downscale, quantise, and encode — the whole path from poster bytes to
 * a sixel string. Returns null for bytes we cannot decode, so callers fall back
 * to a text renderer rather than emitting a broken escape sequence.
 */
export function renderSixelFromBytes(
  bytes: Uint8Array,
  options: SixelRenderOptions,
): string | null {
  const decoded = decodeImageBytes(bytes);
  if (!decoded) return null;
  return renderSixelFromImage(decoded, options);
}

export function renderSixelFromImage(
  decoded: DecodedImage,
  options: SixelRenderOptions,
): string | null {
  if (decoded.width === 0 || decoded.height === 0) return null;

  const fitted = fitDimensions(decoded, options.maxWidth, options.maxHeight);
  const resampled = resampleRgba(decoded, fitted.width, fitted.height);
  const maxColors = Math.min(256, Math.max(2, options.maxColors ?? 256));

  return encodeSixel(quantize(resampled, fitted.width, fitted.height, maxColors));
}

export const __testing = {
  TRANSPARENT_INDEX,
  SIXEL_START,
  SIXEL_END,
  medianCut,
  toSixelChannel,
};
