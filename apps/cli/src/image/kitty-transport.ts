// =============================================================================
// kitty-transport.ts — the one Kitty graphics upload path.
//
// Both the legacy one-shot renderer and the Ink app shell upload through here.
// Payloads are prepared in-process: PNG passes through untouched, JPEG (all of
// TMDB) decodes to raw RGBA via decode.ts — ImageMagick is no longer on the
// hot path. RGBA is zlib-deflated (o=z, RFC 1950) before base64 so PTY
// traffic stays roughly PNG-sized.
//
// Local sessions can skip the PTY entirely: t=t hands the terminal a temp
// file which it reads and then deletes itself (kitty graphics spec). Remote
// sessions (SSH) must stream base64 chunks instead — the terminal cannot read
// our filesystem.
// =============================================================================

import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { detectTerminal } from "./capability";
import { debugImage } from "./debug";
import { decodeImageBytes } from "./decode";
import { isPngBytes } from "./png";

export type KittyPayload =
  | { readonly kind: "png"; readonly data: Uint8Array }
  | {
      readonly kind: "rgba";
      readonly data: Uint8Array;
      readonly width: number;
      readonly height: number;
    };

/**
 * PNG passes through untouched; anything else decodes in-process to RGBA.
 * Returns null for formats we cannot decode (WebP, AVIF, corrupt bytes) —
 * callers may still try ImageMagick as a last resort.
 */
export function prepareKittyPayload(bytes: Uint8Array): KittyPayload | null {
  if (bytes.byteLength === 0) return null;
  if (isPngBytes(bytes)) return { kind: "png", data: bytes };
  const decoded = decodeImageBytes(bytes);
  if (!decoded) return null;
  return { kind: "rgba", data: decoded.rgba, width: decoded.width, height: decoded.height };
}

const CHUNK_SIZE = 4096;
const TRANSPORT_VALUES = new Set(["auto", "file", "direct"]);

type EncodedPayload = {
  /** Format control keys for the first escape (e.g. `f=100` or `f=32,s=…,v=…,o=z`). */
  readonly format: string;
  readonly body: Uint8Array;
};

/**
 * Deflate level for RGBA sent through the PTY. Level 3 is the knee of the
 * curve: on a 780x1170 poster it costs ~33ms for 1576KB where the zlib default
 * (6) costs ~49ms for 1525KB — 3% more bytes to avoid a third of the stall.
 * This runs synchronously on the render path, so milliseconds are keypresses.
 */
const DIRECT_DEFLATE_LEVEL = 3;

/**
 * `compress: false` is for file transmission: the bytes go to local disk, not
 * through the PTY, so deflating them only buys temp-file size at the cost of a
 * synchronous 17-49ms stall on the very path that is supposed to be the fast one.
 */
function encodePayload(payload: KittyPayload, compress: boolean): EncodedPayload {
  if (payload.kind === "png") return { format: "f=100", body: payload.data };
  const dims = `s=${payload.width},v=${payload.height}`;
  if (!compress) return { format: `f=32,${dims}`, body: payload.data };
  // deflateSync emits an RFC 1950 zlib stream, which is exactly what o=z means.
  const compressed = new Uint8Array(deflateSync(payload.data, { level: DIRECT_DEFLATE_LEVEL }));
  return { format: `f=32,${dims},o=z`, body: compressed };
}

export type KittyTransmission = "file" | "direct";

export type KittyUploadResult = {
  readonly sent: boolean;
  readonly transmission: KittyTransmission;
};

export type KittyUploadOptions = {
  readonly imageId?: number;
  readonly rows?: number;
  readonly cols?: number;
  /** U=1 — virtual placement for Unicode-placeholder display inside Ink. */
  readonly unicodePlaceholder?: boolean;
  /** Prefer t=t file transmission when the session is local. Default false. */
  readonly preferFileTransmission?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  /** Yield to the event loop every N chunks (0 disables). Default 8. */
  readonly yieldEveryChunks?: number;
};

/** Long enough that no real terminal is still reading; short enough to bound the leak. */
const TEMP_FILE_SWEEP_MS = 30_000;

const runtime = {
  tmpdir: (): string => tmpdir(),
  writeFile: async (path: string, data: Uint8Array): Promise<void> => {
    await Bun.write(path, data);
  },
  removeFile: async (path: string): Promise<void> => {
    await unlink(path);
  },
  write: (text: string): void => {
    process.stdout.write(text);
  },
  yieldToEventLoop: (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve)),
};

/**
 * `t=t` is an unverifiable bet: we send `q=2`, which suppresses error replies,
 * so a terminal that does not implement file transmission fails *silently* and
 * the poster is simply never drawn. Direct chunks work on every terminal that
 * speaks the protocol at all, so file transmission is opt-in by capability
 * rather than the default everywhere:
 *
 * - SSH: the terminal cannot see our filesystem. Never.
 * - tmux/screen: escapes need passthrough wrapping we do not emit, and the
 *   file lives on whichever host the *server* runs on. Never.
 * - kitty and Ghostty: the two implementations we can name and that document
 *   `t=t`. Yes. (Ghostty has an open report about `t=t`; if it bites, users can
 *   force `KUNAI_IMAGE_TRANSPORT=direct` without a rebuild.)
 * - anything else, including probe-detected terminals answering on an unknown
 *   name: partial protocol implementations commonly support only `t=d`, so
 *   stay on chunks rather than trade a working poster for a faster blank one.
 *
 * `KUNAI_IMAGE_TRANSPORT=file|direct|auto` overrides all of it; invalid values
 * fall back to auto with a debug note.
 */
export function canUseFileTransmission(env: NodeJS.ProcessEnv = process.env): boolean {
  const override = env.KUNAI_IMAGE_TRANSPORT?.trim().toLowerCase();
  if (override === "file") return true;
  if (override === "direct") return false;
  if (override && !TRANSPORT_VALUES.has(override)) {
    debugImage(`Invalid KUNAI_IMAGE_TRANSPORT value: ${override}`);
  }
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (env.TMUX || env.STY || /^(?:screen|tmux)(?:-|$)/i.test(env.TERM ?? "")) return false;
  const terminal = detectTerminal(env);
  return terminal === "kitty" || terminal === "ghostty";
}

function buildControlKeys(encoded: EncodedPayload, options: KittyUploadOptions): string {
  // Key order is load-bearing for existing smoke checks and tests:
  // a=T,<format>,[U=1,]q=2,[i=…],[c=…],[r=…],…
  let control = `a=T,${encoded.format},`;
  if (options.unicodePlaceholder) control += "U=1,";
  control += "q=2,";
  if (options.imageId !== undefined) control += `i=${options.imageId},`;
  if (options.cols !== undefined) control += `c=${options.cols},`;
  if (options.rows !== undefined) control += `r=${options.rows},`;
  return control;
}

/**
 * t=t: the terminal reads the file and deletes it afterwards. Kitty's
 * security rule requires the string "tty-graphics-protocol" in the full path
 * and a known temp directory — os.tmpdir() (respecting TMPDIR) qualifies.
 * We never touch the file again; if a terminal ignored t=t the file simply
 * lives in tmp until the OS sweeps it.
 */
async function uploadViaTempFile(encoded: EncodedPayload, control: string): Promise<boolean> {
  const hash = createHash("sha256").update(encoded.body).digest("hex").slice(0, 16);
  const path = join(runtime.tmpdir(), `kunai-tty-graphics-protocol-${process.pid}-${hash}.bin`);
  try {
    await runtime.writeFile(path, encoded.body);
  } catch (error) {
    debugImage(
      `kitty temp-file write failed, using direct chunks: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
  const b64Path = Buffer.from(path, "utf8").toString("base64");
  runtime.write(`\x1b_G${control}t=t;${b64Path}\x1b\\`);
  scheduleTempFileSweep(path);
  return true;
}

/**
 * The terminal is supposed to delete the file itself. A terminal that ignored
 * `t=t` never will, and `q=2` means we are never told — so a long session would
 * quietly strand a multi-megabyte file per poster. Unlink well after any real
 * terminal has read it; losing the race to the terminal just fails harmlessly.
 * The timer is unref'd so a pending sweep cannot hold the process open at exit.
 */
function scheduleTempFileSweep(path: string): void {
  const timer = setTimeout(() => {
    void runtime.removeFile(path).catch(() => {
      // Expected whenever the terminal already deleted it.
    });
  }, TEMP_FILE_SWEEP_MS);
  timer.unref?.();
}

async function uploadViaDirectChunks(
  encoded: EncodedPayload,
  control: string,
  yieldEveryChunks: number,
): Promise<void> {
  const b64 = Buffer.from(encoded.body).toString("base64");
  // Chunk into <=4096-byte pieces (a multiple of 4, per spec, for all but the
  // last chunk). Yield every few chunks: a poster is tens of KB of base64 and
  // writing it in one synchronous burst blocks the event loop (TTY writes
  // don't yield), which starves stdin and stalls keypresses mid-upload. The
  // image only displays once the final chunk lands (m=0), so interleaving
  // causes no partial-render flicker.
  let chunksSinceYield = 0;
  for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
    const chunk = b64.slice(i, i + CHUNK_SIZE);
    const more = i + CHUNK_SIZE < b64.length ? 1 : 0;
    const prefix = i === 0 ? `${control}m=${more}` : `m=${more}`;
    runtime.write(`\x1b_G${prefix};${chunk}\x1b\\`);
    if (yieldEveryChunks > 0 && ++chunksSinceYield >= yieldEveryChunks) {
      chunksSinceYield = 0;
      await runtime.yieldToEventLoop();
    }
  }
}

/**
 * Upload one image to the terminal. Never throws for payload problems —
 * callers treat `sent: false` as "try the next fallback".
 */
export async function uploadKittyPayload(
  payload: KittyPayload,
  options: KittyUploadOptions = {},
): Promise<KittyUploadResult> {
  if (payload.data.byteLength === 0) return { sent: false, transmission: "direct" };
  const env = options.env ?? process.env;

  // Transport is chosen before encoding, not after: file transmission wants the
  // bytes uncompressed (local disk), direct wants them deflated (PTY). Encoding
  // once up front would force one of the two to pay for the other's tradeoff.
  if (options.preferFileTransmission && canUseFileTransmission(env)) {
    const encoded = encodePayload(payload, false);
    const sent = await uploadViaTempFile(encoded, buildControlKeys(encoded, options));
    if (sent) return { sent: true, transmission: "file" };
    // Fall through and re-encode for the PTY.
  }

  const encoded = encodePayload(payload, true);
  if (encoded.body.byteLength === 0) return { sent: false, transmission: "direct" };
  await uploadViaDirectChunks(
    encoded,
    buildControlKeys(encoded, options),
    options.yieldEveryChunks ?? 8,
  );
  return { sent: true, transmission: "direct" };
}

export const __testing = {
  runtime,
  encodePayload,
  buildControlKeys,
};
