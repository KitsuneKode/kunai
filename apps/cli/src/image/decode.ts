// =============================================================================
// decode.ts — pixel access without an external binary.
//
// Every renderer except kitty-native used to shell out to `chafa`, which is
// effectively never installed on Windows. That left Windows users with no
// posters at all. Half-block output needs real pixels, so we decode here:
// JPEG through jpeg-js (TMDB serves `t/p/w342` as JPEG) and PNG inline, since
// PNG is only DEFLATE plus five scanline filters and pulling a second decoder
// dependency for that is not worth it.
// =============================================================================

import { inflateSync } from "node:zlib";

import { decode as decodeJpegBytes } from "jpeg-js";

import { debugImage } from "./debug";
import { isPngBytes } from "./png";

/** Straight (non-premultiplied) 8-bit RGBA, row-major, `width * height * 4` bytes. */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

const PNG_HEADER_BYTES = 8;
const CHUNK_LENGTH_BYTES = 4;
const CHUNK_TYPE_BYTES = 4;
const CHUNK_CRC_BYTES = 4;

/** Channels per pixel for each PNG colour type; palette entries expand later. */
const CHANNELS_BY_COLOR_TYPE: Readonly<Record<number, number>> = {
  0: 1, // greyscale
  2: 3, // truecolour
  3: 1, // palette index
  4: 2, // greyscale + alpha
  6: 4, // truecolour + alpha
};

type PngHeader = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlace: number;
};

function readPngHeader(view: DataView): PngHeader {
  // IHDR is always the first chunk, so its payload starts at a fixed offset.
  const base = PNG_HEADER_BYTES + CHUNK_LENGTH_BYTES + CHUNK_TYPE_BYTES;
  return {
    width: view.getUint32(base),
    height: view.getUint32(base + 4),
    bitDepth: view.getUint8(base + 8),
    colorType: view.getUint8(base + 9),
    interlace: view.getUint8(base + 12),
  };
}

type PngChunks = {
  readonly idat: Uint8Array;
  readonly palette: Uint8Array | null;
  readonly transparency: Uint8Array | null;
};

function readPngChunks(bytes: Uint8Array, view: DataView): PngChunks {
  const idatParts: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  let offset = PNG_HEADER_BYTES;

  while (offset + CHUNK_LENGTH_BYTES + CHUNK_TYPE_BYTES <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4] as number,
      bytes[offset + 5] as number,
      bytes[offset + 6] as number,
      bytes[offset + 7] as number,
    );
    const dataStart = offset + CHUNK_LENGTH_BYTES + CHUNK_TYPE_BYTES;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    if (type === "IDAT") idatParts.push(bytes.subarray(dataStart, dataEnd));
    else if (type === "PLTE") palette = bytes.subarray(dataStart, dataEnd);
    else if (type === "tRNS") transparency = bytes.subarray(dataStart, dataEnd);
    else if (type === "IEND") break;

    offset = dataEnd + CHUNK_CRC_BYTES;
  }

  return { idat: concatBytes(idatParts), palette, transparency };
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    merged.set(part, cursor);
    cursor += part.length;
  }
  return merged;
}

function paethPredictor(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const distLeft = Math.abs(estimate - left);
  const distAbove = Math.abs(estimate - above);
  const distUpperLeft = Math.abs(estimate - upperLeft);
  if (distLeft <= distAbove && distLeft <= distUpperLeft) return left;
  if (distAbove <= distUpperLeft) return above;
  return upperLeft;
}

/**
 * Reverse the per-scanline filters (PNG spec 9.2) in place-ish, returning the
 * raw sample bytes with the leading filter byte of each row stripped.
 */
function unfilterScanlines(
  inflated: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
): Uint8Array {
  const stride = width * bytesPerPixel;
  const output = new Uint8Array(stride * height);

  for (let row = 0; row < height; row += 1) {
    const filterOffset = row * (stride + 1);
    const filter = inflated[filterOffset] as number;
    const rowStart = row * stride;
    const priorStart = (row - 1) * stride;

    for (let index = 0; index < stride; index += 1) {
      const raw = inflated[filterOffset + 1 + index] as number;
      const left =
        index >= bytesPerPixel ? (output[rowStart + index - bytesPerPixel] as number) : 0;
      const above = row > 0 ? (output[priorStart + index] as number) : 0;
      const upperLeft =
        row > 0 && index >= bytesPerPixel
          ? (output[priorStart + index - bytesPerPixel] as number)
          : 0;

      let value: number;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + above;
          break;
        case 3:
          value = raw + ((left + above) >> 1);
          break;
        case 4:
          value = raw + paethPredictor(left, above, upperLeft);
          break;
        default:
          throw new Error(`unsupported PNG filter type ${filter}`);
      }
      output[rowStart + index] = value & 0xff;
    }
  }

  return output;
}

function samplesToRgba(
  samples: Uint8Array,
  header: PngHeader,
  chunks: PngChunks,
  sampleStep: number,
): Uint8Array {
  const { width, height, colorType } = header;
  const channels = CHANNELS_BY_COLOR_TYPE[colorType] as number;
  const rgba = new Uint8Array(width * height * 4);
  const pixelStride = channels * sampleStep;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    // For 16-bit depth we read only the high byte of each sample, which is a
    // visually lossless narrowing at the sizes a terminal cell can show.
    const source = pixel * pixelStride;
    const target = pixel * 4;

    switch (colorType) {
      case 0: {
        const grey = samples[source] as number;
        rgba[target] = grey;
        rgba[target + 1] = grey;
        rgba[target + 2] = grey;
        rgba[target + 3] = 0xff;
        break;
      }
      case 2: {
        rgba[target] = samples[source] as number;
        rgba[target + 1] = samples[source + sampleStep] as number;
        rgba[target + 2] = samples[source + 2 * sampleStep] as number;
        rgba[target + 3] = 0xff;
        break;
      }
      case 3: {
        const index = samples[source] as number;
        const palette = chunks.palette;
        if (!palette) throw new Error("indexed PNG is missing its PLTE chunk");
        rgba[target] = palette[index * 3] as number;
        rgba[target + 1] = palette[index * 3 + 1] as number;
        rgba[target + 2] = palette[index * 3 + 2] as number;
        rgba[target + 3] = (chunks.transparency?.[index] as number | undefined) ?? 0xff;
        break;
      }
      case 4: {
        const grey = samples[source] as number;
        rgba[target] = grey;
        rgba[target + 1] = grey;
        rgba[target + 2] = grey;
        rgba[target + 3] = samples[source + sampleStep] as number;
        break;
      }
      case 6: {
        rgba[target] = samples[source] as number;
        rgba[target + 1] = samples[source + sampleStep] as number;
        rgba[target + 2] = samples[source + 2 * sampleStep] as number;
        rgba[target + 3] = samples[source + 3 * sampleStep] as number;
        break;
      }
      default:
        throw new Error(`unsupported PNG colour type ${colorType}`);
    }
  }

  return rgba;
}

export function decodePng(bytes: Uint8Array): DecodedImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = readPngHeader(view);

  if (header.interlace !== 0) {
    // Adam7 needs seven sub-image passes. Posters are not interlaced in
    // practice, so we fail loudly rather than carry that code untested.
    throw new Error("interlaced PNG is not supported");
  }
  if (header.bitDepth !== 8 && header.bitDepth !== 16) {
    throw new Error(`unsupported PNG bit depth ${header.bitDepth}`);
  }

  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  if (channels === undefined) {
    throw new Error(`unsupported PNG colour type ${header.colorType}`);
  }

  const chunks = readPngChunks(bytes, view);
  if (chunks.idat.length === 0) throw new Error("PNG has no IDAT data");

  const sampleStep = header.bitDepth === 16 ? 2 : 1;
  const bytesPerPixel = channels * sampleStep;
  const inflated = new Uint8Array(inflateSync(chunks.idat));
  const samples = unfilterScanlines(inflated, header.width, header.height, bytesPerPixel);

  return {
    width: header.width,
    height: header.height,
    rgba: samplesToRgba(samples, header, chunks, sampleStep),
  };
}

export function decodeJpeg(bytes: Uint8Array): DecodedImage {
  // `useTArray` keeps the result a Uint8Array instead of a Node Buffer, and
  // `maxMemoryUsageInMB` bounds a hostile or corrupt file rather than letting
  // it exhaust the process.
  const decoded = decodeJpegBytes(bytes, {
    useTArray: true,
    maxMemoryUsageInMB: 64,
    formatAsRGBA: true,
  });
  return {
    width: decoded.width,
    height: decoded.height,
    rgba: new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
  };
}

/** Decode by content sniffing, not file extension — cached posters are named by URL hash. */
export function decodeImageBytes(bytes: Uint8Array): DecodedImage | null {
  if (bytes.byteLength === 0) return null;
  try {
    return isPngBytes(bytes) ? decodePng(bytes) : decodeJpeg(bytes);
  } catch (error) {
    debugImage(`image decode failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
