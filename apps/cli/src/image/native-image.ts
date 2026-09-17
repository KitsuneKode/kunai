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
// `bun >= 1.3.14` is the supported floor, so Bun.Image is expected to exist and
// the native path is the only one — there is no longer a JavaScript decoder to
// fall back to. The capability check and the `null` returns remain as a safety
// net (engines is advisory, and a compiled binary embeds whichever Bun built
// it), so a build without Bun.Image degrades to text posters rather than
// crashing. `decode.ts` is not made redundant by any of this: Bun.Image has no
// raw-pixel output, so `decodePng` is what turns the resized PNG back into
// pixels.
// =============================================================================

import { debugImage } from "./debug";
import { decodePng, type DecodedImage } from "./decode";

/**
 * Largest encoded poster we will even hand to the decoder.
 *
 * Checked before construction, so a hostile or mis-sized source is rejected
 * without allocating a decode buffer for it.
 */
export const MAX_POSTER_SOURCE_BYTES = 16 * 1024 * 1024;

/**
 * Decoded-pixel ceiling handed to Bun.Image.
 *
 * This is the guard that a small encoded file cannot turn into a huge bitmap:
 * `maxPixels` makes the native side refuse rather than allocate.
 */
export const MAX_POSTER_DECODED_PIXELS = 4096 * 4096;

type NativeImageOptions = {
  readonly maxPixels: number;
  readonly autoOrient: boolean;
};

type NativeResizeOptions = {
  readonly fit: "inside";
  readonly withoutEnlargement: true;
};

/** The slice of the Bun.Image surface this module relies on. */
type NativeImage = {
  resize: (width: number, height: number, options: NativeResizeOptions) => NativeImage;
  png: () => NativeImage;
  bytes: () => Promise<Uint8Array> | Uint8Array;
};

type NativeImageCtor = new (input: Uint8Array, options: NativeImageOptions) => NativeImage;

function nativeImageCtor(): NativeImageCtor | null {
  const candidate = (Bun as { Image?: unknown }).Image;
  return typeof candidate === "function" ? (candidate as NativeImageCtor) : null;
}

const NATIVE_OPTIONS: NativeImageOptions = {
  maxPixels: MAX_POSTER_DECODED_PIXELS,
  autoOrient: true,
};

const RESIZE_OPTIONS: NativeResizeOptions = {
  fit: "inside",
  withoutEnlargement: true,
};

/** The pixel box a prepared poster must fit inside. */
export type PosterPixelBounds = {
  readonly maxWidthPx: number;
  readonly maxHeightPx: number;
};

/**
 * One poster, prepared once, in both forms the renderers need.
 *
 * Kitty and iTerm2 send `png` verbatim; Sixel and half-block consume `image`.
 * Preparing both together is what lets a single native pass serve every renderer.
 */
export type PreparedPoster = {
  readonly png: Uint8Array;
  readonly image: DecodedImage;
};

/**
 * Why a preparation returned null. Categories only — never a URL, path, native
 * exception string, or image bytes, all of which can carry user data into logs.
 */
type PosterPrepareFailure =
  | "input-too-large"
  | "invalid-bounds"
  | "pixel-limit"
  | "unsupported-format"
  | "invalid-image"
  | "png-bridge-failed"
  | "native-failure";

function reportPrepareFailure(category: PosterPrepareFailure): null {
  debugImage(`poster preparation failed: ${category}`);
  return null;
}

function isValidBounds(bounds: PosterPixelBounds): boolean {
  return (
    Number.isInteger(bounds.maxWidthPx) &&
    Number.isInteger(bounds.maxHeightPx) &&
    bounds.maxWidthPx > 0 &&
    bounds.maxHeightPx > 0
  );
}

/**
 * Map a native throw onto a stable category.
 *
 * Bun.Image reports both "unrecognised format" and the maxPixels breach as
 * plain errors, and those two mean different things to a caller: one is a bad
 * source, the other is a source too large to trust.
 */
function classifyNativeFailure(error: unknown): PosterPrepareFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("maxPixels")) return "pixel-limit";
  if (message.includes("unrecognised") || message.includes("unsupported")) {
    return "unsupported-format";
  }
  return "invalid-image";
}

/**
 * Prepare one poster for every renderer: bounded, oriented, fitted, decoded.
 *
 * The single seam from encoded source bytes to drawable pixels. It resizes
 * before anything reaches JS, so a w780 TMDB poster never exists here as a
 * full-size bitmap — only as the cell-sized PNG we are about to draw.
 *
 * Cancellation surrounds the native calls rather than entering them: Bun.Image
 * takes no signal, so we check before starting and after every terminal, and a
 * superseded caller simply discards the result. Returns null on every failure,
 * so a poster problem degrades to text rather than breaking navigation.
 */
export async function preparePoster(
  bytes: Uint8Array,
  bounds: PosterPixelBounds,
  signal?: AbortSignal,
): Promise<PreparedPoster | null> {
  if (bytes.byteLength > MAX_POSTER_SOURCE_BYTES) return reportPrepareFailure("input-too-large");
  if (!isValidBounds(bounds)) return reportPrepareFailure("invalid-bounds");
  if (bytes.byteLength === 0) return reportPrepareFailure("invalid-image");
  if (signal?.aborted) return null;

  const Ctor = nativeImageCtor();
  if (!Ctor) return reportPrepareFailure("native-failure");

  let png: Uint8Array;
  try {
    const image = new Ctor(bytes, NATIVE_OPTIONS);
    if (signal?.aborted) return null;

    const resized = image.resize(bounds.maxWidthPx, bounds.maxHeightPx, RESIZE_OPTIONS);
    if (signal?.aborted) return null;

    const encoded = resized.png();
    if (signal?.aborted) return null;

    png = new Uint8Array(await encoded.bytes());
    if (signal?.aborted) return null;
  } catch (error) {
    // The native message can carry a path or the source URL, so it is
    // classified and dropped rather than logged.
    return reportPrepareFailure(classifyNativeFailure(error));
  }

  if (png.byteLength === 0) return reportPrepareFailure("png-bridge-failed");

  try {
    const image = decodePng(png);
    if (signal?.aborted) return null;
    return { png, image };
  } catch {
    return reportPrepareFailure("png-bridge-failed");
  }
}
