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
