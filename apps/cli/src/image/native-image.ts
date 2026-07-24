// =============================================================================
// native-image.ts — Bun.Image seam for off-thread decode and resize.
//
// The in-process decoder in `decode.ts` is synchronous, and on a render path
// that matters: decoding one w780 TMDB poster with jpeg-js starves the event
// loop outright (measured 102.7ms during which a 2ms interval fired zero
// times). That is the same stall-then-burst shape that made calendar
// navigation feel blocked.
//
// Bun.Image does the work natively and asynchronously — the same poster takes
// ~14ms with the loop still ticking. It also resizes, so the full-size bitmap
// never reaches JS: we ask for the exact cell geometry we are about to draw and
// decode only that.
//
// Bun.Image has no raw-pixel output (`bytes({format:"raw"})` still returns an
// encoded image), so the bridge back to pixels is PNG. That is deliberate and
// cheap: decoding a ~40x120 PNG is trivial next to a 780x1170 JPEG, and for the
// Kitty path the PNG *is* the payload, which drops both ImageMagick and the
// deflate step.
//
// Everything here degrades to `null` so callers keep the synchronous decoder as
// their floor — the package supports `bun >= 1.3.9` and Bun.Image may not exist
// there.
// =============================================================================

import { debugImage } from "./debug";
import { decodeImageBytes, type DecodedImage } from "./decode";

/** The slice of the Bun.Image surface this module relies on. */
type NativeImage = {
  resize: (width: number, height: number) => NativeImage;
  png: () => NativeImage;
  bytes: () => Promise<Uint8Array>;
};

type NativeImageCtor = new (input: Uint8Array) => NativeImage;

export type PixelTarget = {
  readonly width: number;
  readonly height: number;
};

function nativeImageCtor(): NativeImageCtor | null {
  const candidate = (Bun as unknown as { Image?: unknown }).Image;
  return typeof candidate === "function" ? (candidate as NativeImageCtor) : null;
}

/** True when this Bun build exposes `Bun.Image`. */
export function hasNativeImage(): boolean {
  return nativeImageCtor() !== null;
}

/**
 * Re-encode to PNG natively, optionally resizing first. Returns null when
 * Bun.Image is unavailable or the input cannot be read, so callers fall back.
 *
 * `target` should be the pixel geometry actually being drawn. Resizing here is
 * what keeps the full-size bitmap out of the process entirely.
 */
export async function encodeNativePng(
  bytes: Uint8Array,
  target?: PixelTarget,
): Promise<Uint8Array | null> {
  const Ctor = nativeImageCtor();
  if (!Ctor || bytes.byteLength === 0) return null;
  try {
    const base = new Ctor(bytes);
    const sized =
      target && target.width > 0 && target.height > 0
        ? base.resize(Math.max(1, Math.round(target.width)), Math.max(1, Math.round(target.height)))
        : base;
    const out = await sized.png().bytes();
    return out.byteLength > 0 ? out : null;
  } catch (error) {
    debugImage(
      `Bun.Image encode failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Decode to RGBA at (at most) `target`, off the main thread when possible.
 *
 * The native path resizes first, so the PNG this decodes is already cell-sized.
 * Falls back to the synchronous decoder — which blocks — only when Bun.Image is
 * missing or fails; that is strictly better than today's unconditional block.
 */
export async function decodeToRgba(
  bytes: Uint8Array,
  target?: PixelTarget,
): Promise<DecodedImage | null> {
  const png = await encodeNativePng(bytes, target);
  if (png) {
    const decoded = decodeImageBytes(png);
    if (decoded) return decoded;
    debugImage("Bun.Image produced a PNG the decoder rejected; using the synchronous path");
  }
  return decodeImageBytes(bytes);
}
