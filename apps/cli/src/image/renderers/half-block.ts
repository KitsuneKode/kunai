// =============================================================================
// half-block.ts — poster output that needs no external binary.
//
// Each character cell carries two pixels: U+2580 UPPER HALF BLOCK painted with
// the top pixel as foreground and the bottom pixel as background. A terminal
// cell is roughly twice as tall as it is wide, so half a cell is close to
// square and the image keeps its aspect ratio without correction.
//
// This is the universal fallback. Only kitty-native and chafa beat it, and both
// are conditional; this path always works on any truecolour terminal.
// =============================================================================

import { decodeImageBytes, type DecodedImage } from "../decode";
import type { ImageRenderOptions } from "../types";

const UPPER_HALF_BLOCK = "▀";
const RESET = "[0m";

/** Below this alpha a pixel is treated as absent rather than blended to black. */
const ALPHA_VISIBILITY_THRESHOLD = 8;

type Rgb = { readonly r: number; readonly g: number; readonly b: number };

/** A transparent pixel, distinguished from a black one so we can leave the cell bare. */
const TRANSPARENT: Rgb | null = null;

export function parseSizeSpec(size: string): { columns: number; rows: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!match) return null;
  const columns = Number.parseInt(match[1] as string, 10);
  const rows = Number.parseInt(match[2] as string, 10);
  if (columns <= 0 || rows <= 0) return null;
  return { columns, rows };
}

/**
 * Fit `source` inside `maxWidth * maxHeight` preserving aspect ratio.
 * Never upscales: a poster smaller than the cell budget stays its own size
 * rather than turning into visible blocky artefacts.
 */
export function fitDimensions(
  source: { width: number; height: number },
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(maxWidth / source.width, maxHeight / source.height, 1);
  return {
    width: Math.max(1, Math.floor(source.width * scale)),
    height: Math.max(1, Math.floor(source.height * scale)),
  };
}

/**
 * Box-average downscale. Averaging every source pixel that lands in a target
 * cell keeps fine poster detail (text, faces) legible where nearest-neighbour
 * sampling would alias it into noise.
 */
export function resampleRgba(
  image: DecodedImage,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  const output = new Uint8Array(targetWidth * targetHeight * 4);
  const xRatio = image.width / targetWidth;
  const yRatio = image.height / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceTop = Math.floor(y * yRatio);
    const sourceBottom = Math.max(sourceTop + 1, Math.floor((y + 1) * yRatio));

    for (let x = 0; x < targetWidth; x += 1) {
      const sourceLeft = Math.floor(x * xRatio);
      const sourceRight = Math.max(sourceLeft + 1, Math.floor((x + 1) * xRatio));

      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let samples = 0;

      for (let sy = sourceTop; sy < sourceBottom && sy < image.height; sy += 1) {
        for (let sx = sourceLeft; sx < sourceRight && sx < image.width; sx += 1) {
          const offset = (sy * image.width + sx) * 4;
          red += image.rgba[offset] as number;
          green += image.rgba[offset + 1] as number;
          blue += image.rgba[offset + 2] as number;
          alpha += image.rgba[offset + 3] as number;
          samples += 1;
        }
      }

      const target = (y * targetWidth + x) * 4;
      const divisor = samples === 0 ? 1 : samples;
      output[target] = Math.round(red / divisor);
      output[target + 1] = Math.round(green / divisor);
      output[target + 2] = Math.round(blue / divisor);
      output[target + 3] = Math.round(alpha / divisor);
    }
  }

  return output;
}

function pixelAt(rgba: Uint8Array, width: number, x: number, y: number): Rgb | null {
  const offset = (y * width + x) * 4;
  const alpha = rgba[offset + 3] as number;
  if (alpha < ALPHA_VISIBILITY_THRESHOLD) return TRANSPARENT;
  return {
    r: rgba[offset] as number,
    g: rgba[offset + 1] as number,
    b: rgba[offset + 2] as number,
  };
}

/**
 * Build the escape-sequence body. Pure and exported so tests can assert on the
 * emitted colours without touching a real terminal.
 */
export function buildHalfBlockOutput(image: DecodedImage, options: ImageRenderOptions): string {
  const spec = parseSizeSpec(options.size) ?? { columns: 30, rows: options.maxRows };
  const cellRows = Math.max(1, Math.min(spec.rows, options.maxRows));
  // Two vertical pixels per cell row is what makes the half-block trick work.
  const fitted = fitDimensions(image, spec.columns, cellRows * 2);
  // An odd pixel height would leave a half-painted final row, so round up to a
  // whole cell and let the bottom pixel fall through as transparent.
  const pixelHeight = fitted.height + (fitted.height % 2);
  const resampled = resampleRgba(image, fitted.width, pixelHeight);

  const lines: string[] = [];
  for (let y = 0; y < pixelHeight; y += 2) {
    let line = "";
    let activeTop: Rgb | null | undefined;
    let activeBottom: Rgb | null | undefined;

    for (let x = 0; x < fitted.width; x += 1) {
      const top = pixelAt(resampled, fitted.width, x, y);
      const bottom = y + 1 < pixelHeight ? pixelAt(resampled, fitted.width, x, y + 1) : TRANSPARENT;

      if (top === null && bottom === null) {
        if (activeTop !== undefined || activeBottom !== undefined) {
          line += RESET;
          activeTop = undefined;
          activeBottom = undefined;
        }
        line += " ";
        continue;
      }

      // Only re-emit an SGR sequence when the colour actually changes; a poster
      // has large flat regions and this roughly halves the bytes written.
      if (!sameColor(top, activeTop)) {
        line += top === null ? "[39m" : `[38;2;${top.r};${top.g};${top.b}m`;
        activeTop = top;
      }
      if (!sameColor(bottom, activeBottom)) {
        line += bottom === null ? "[49m" : `[48;2;${bottom.r};${bottom.g};${bottom.b}m`;
        activeBottom = bottom;
      }
      line += UPPER_HALF_BLOCK;
    }

    lines.push(`${line}${RESET}`);
  }

  return `${lines.join("\n")}\n`;
}

function sameColor(a: Rgb | null, b: Rgb | null | undefined): boolean {
  if (b === undefined) return false;
  if (a === null || b === null) return a === b;
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

const runtime = {
  readFile: (filePath: string): Promise<ArrayBuffer> => Bun.file(filePath).arrayBuffer(),
  write: (text: string): void => {
    process.stdout.write(text);
  },
};

export async function renderHalfBlock(
  filePath: string,
  options: ImageRenderOptions,
): Promise<void> {
  const bytes = new Uint8Array(await runtime.readFile(filePath));
  const image = decodeImageBytes(bytes);
  if (!image) throw new Error("poster could not be decoded for half-block output");
  runtime.write(buildHalfBlockOutput(image, options));
}

export const __testing = {
  runtime,
};
