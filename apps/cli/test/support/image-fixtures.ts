// Shared image byte fixtures for poster/image tests. Building real bytes
// (rather than stubbing decoders) exercises the chunk walk, zlib round-trips,
// and the JPEG decode path end to end.

import { deflateSync } from "node:zlib";

import { encode as encodeJpeg } from "jpeg-js";

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + payload.length);
  body.set(typeBytes);
  body.set(payload, typeBytes.length);

  const chunk = new Uint8Array(4 + body.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return chunk;
}

/**
 * Encode an RGB PNG with filter type 0 on every scanline.
 * `pixels` is row-major RGB triples.
 */
export function makeRgbPng(width: number, height: number, pixels: readonly number[]): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0; // filter: None
    for (let index = 0; index < stride; index += 1) {
      raw[row * (stride + 1) + 1 + index] = pixels[row * stride + index] as number;
    }
  }

  const parts = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
    pngChunk("IEND", new Uint8Array()),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/**
 * Encode a real baseline JPEG via jpeg-js. `pixels` is row-major RGB triples.
 * This is what TMDB actually serves, so it exercises the same decode path as
 * production poster fetches.
 */
export function makeRgbJpeg(width: number, height: number, pixels: readonly number[]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let source = 0, target = 0; source < width * height * 3; source += 3, target += 4) {
    rgba[target] = pixels[source] as number;
    rgba[target + 1] = pixels[source + 1] as number;
    rgba[target + 2] = pixels[source + 2] as number;
    rgba[target + 3] = 0xff;
  }
  const encoded = encodeJpeg({ data: rgba, width, height }, 90);
  return new Uint8Array(encoded.data.buffer, encoded.data.byteOffset, encoded.data.byteLength);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/**
 * Wrap a JPEG in an EXIF APP1 segment declaring `orientation`.
 *
 * Orientation 6 means "rotate 90° clockwise to display", so an auto-orienting
 * decoder reports a W×H source as H×W. That swap is the observable proof that
 * `autoOrient` is actually on — without it, a portrait poster shot in landscape
 * renders sideways.
 */
export function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  tiff[0] = 0x49; // "II" — little endian
  tiff[1] = 0x49;
  view.setUint16(2, 0x2a, true); // TIFF magic
  view.setUint32(4, 8, true); // offset of IFD0
  view.setUint16(8, 1, true); // one entry
  view.setUint16(10, 0x0112, true); // tag: Orientation
  view.setUint16(12, 3, true); // type: SHORT
  view.setUint32(14, 1, true); // count
  view.setUint16(18, orientation, true); // inline value
  view.setUint32(22, 0, true); // no IFD1

  const header = new TextEncoder().encode("Exif\0\0");
  const segment = new Uint8Array(4 + header.length + tiff.length);
  const segmentView = new DataView(segment.buffer);
  segmentView.setUint16(0, 0xffe1); // APP1
  segmentView.setUint16(2, 2 + header.length + tiff.length); // length covers itself
  segment.set(header, 4);
  segment.set(tiff, 4 + header.length);

  // APP1 goes immediately after SOI.
  return concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

/**
 * Encode a 24-bit uncompressed BMP. `pixels` is row-major RGB triples.
 *
 * BMP stores rows bottom-up as BGR, each padded to a 4-byte boundary.
 */
export function makeRgbBmp(width: number, height: number, pixels: readonly number[]): Uint8Array {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const out = new Uint8Array(54 + pixelBytes);
  const view = new DataView(out.buffer);

  out[0] = 0x42; // "BM"
  out[1] = 0x4d;
  view.setUint32(2, out.length, true);
  view.setUint32(10, 54, true); // pixel data offset
  view.setUint32(14, 40, true); // BITMAPINFOHEADER
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive: bottom-up
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(30, 0, true); // BI_RGB
  view.setUint32(34, pixelBytes, true);

  for (let row = 0; row < height; row += 1) {
    const sourceRow = height - 1 - row; // bottom-up
    for (let column = 0; column < width; column += 1) {
      const source = (sourceRow * width + column) * 3;
      const target = 54 + row * rowStride + column * 3;
      out[target] = pixels[source + 2] as number; // B
      out[target + 1] = pixels[source + 1] as number; // G
      out[target + 2] = pixels[source] as number; // R
    }
  }
  return out;
}

/**
 * Encode a single-frame GIF89a from a palette and per-pixel indices.
 *
 * The LZW stream emits a clear code before every pixel. That is deliberately
 * the least clever encoding possible: it keeps every code at the initial width,
 * so the dictionary never grows and no code-size transition has to be tracked.
 * Fixtures only need to be decodable, not small.
 */
export function makeIndexedGif(
  width: number,
  height: number,
  palette: readonly (readonly [number, number, number])[],
  indices: readonly number[],
): Uint8Array {
  const tableEntries = 4; // 2^(1+1); the smallest table GIF allows
  const globalColorTable = new Uint8Array(tableEntries * 3);
  palette.slice(0, tableEntries).forEach((colour, slot) => {
    globalColorTable[slot * 3] = colour[0];
    globalColorTable[slot * 3 + 1] = colour[1];
    globalColorTable[slot * 3 + 2] = colour[2];
  });

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  header.set(new TextEncoder().encode("GIF89a"));
  headerView.setUint16(6, width, true);
  headerView.setUint16(8, height, true);
  header[10] = 0x81; // global table present, 4 entries
  header[11] = 0; // background colour index
  header[12] = 0; // no aspect ratio

  const descriptor = new Uint8Array(10);
  const descriptorView = new DataView(descriptor.buffer);
  descriptor[0] = 0x2c; // image separator
  descriptorView.setUint16(5, width, true);
  descriptorView.setUint16(7, height, true);

  const minCodeSize = 2;
  const codeWidth = minCodeSize + 1;
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  const bits: number[] = [];
  const pushCode = (code: number) => {
    for (let bit = 0; bit < codeWidth; bit += 1) bits.push((code >> bit) & 1);
  };
  for (const index of indices) {
    pushCode(clearCode);
    pushCode(index);
  }
  pushCode(endCode);

  const lzw = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, position) => {
    if (bit) lzw[position >> 3] = (lzw[position >> 3] as number) | (1 << (position & 7));
  });

  const blocks: Uint8Array[] = [new Uint8Array([minCodeSize])];
  for (let offset = 0; offset < lzw.length; offset += 255) {
    const chunk = lzw.subarray(offset, offset + 255);
    blocks.push(new Uint8Array([chunk.length]), chunk);
  }
  blocks.push(new Uint8Array([0x00])); // block terminator

  return concat([header, globalColorTable, descriptor, ...blocks, new Uint8Array([0x3b])]);
}
