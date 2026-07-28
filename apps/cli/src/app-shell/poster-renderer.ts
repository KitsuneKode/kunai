import { detectImageCapability } from "@/image";
import type { TerminalId } from "@/image";
import { ensurePngBytes } from "@/image/convert";
import { debugImage } from "@/image/debug";
import {
  prepareKittyPayload,
  uploadKittyPayload,
  type KittyPayload,
} from "@/image/kitty-transport";
import { decodeToRgba, encodeNativePng } from "@/image/native-image";
import { getProbedGraphicsSupport } from "@/image/probe";
import { buildHalfBlockOutput } from "@/image/renderers/half-block";
import { pixelBudgetForCells } from "@/image/renderers/sixel";
import { renderSixelFromBytes } from "@/image/sixel";

import {
  clearKittyPlacementRegistry,
  registerKittyPlacement,
  releaseKittySlot,
  setKittyPlacementDeleteFn,
  type KittyPlacementSlot,
} from "./kitty-placement-registry";
import type { PosterResult } from "./poster-types";

type ChafaSpawnOptions = {
  readonly stdin: "pipe";
  readonly stdout: "pipe";
  readonly stderr: "pipe";
};

type PosterRuntime = {
  detectImageCapability: typeof detectImageCapability;
  which: (command: string) => string | null;
  spawn: (command: string[], options: ChafaSpawnOptions) => Bun.Subprocess;
};

const runtime: PosterRuntime = {
  detectImageCapability: () => detectImageCapability(),
  which: (command) => Bun.which(command),
  spawn: (command, options) => Bun.spawn(command, options),
};

// Interactive overlays are encoded on the JS thread and replayed through the
// PTY after Ink frames. 256 colours roughly doubles both encode time and bytes
// on the wire without a meaningful gain at terminal-poster dimensions.
const APP_SHELL_SIXEL_MAX_COLORS = 64;

let nextId = 1;
function allocId(): number {
  const id = nextId;
  nextId = (nextId % 65534) + 1;
  return id;
}

function canRenderKitty(): boolean {
  const capability = runtime.detectImageCapability();
  return capability.renderer === "kitty-native";
}

export function deleteKittyImage(imageId: number): void {
  if (!canRenderKitty()) return;
  process.stdout.write(`\x1b_Ga=d,d=I,i=${imageId};\x1b\\`);
}

setKittyPlacementDeleteFn(deleteKittyImage);

export function deleteAllTerminalImages(): void {
  if (!canRenderKitty()) {
    clearKittyPlacementRegistry();
    return;
  }
  process.stdout.write("\x1b_Ga=d,d=A;\x1b\\");
  clearKittyPlacementRegistry();
}

const DIACRITICS: readonly number[] = [
  0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f, 0x0346, 0x034a, 0x034b, 0x034c,
  0x0350, 0x0351, 0x0352, 0x0357, 0x035b, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
  0x036a, 0x036b, 0x036c, 0x036d, 0x036e, 0x036f, 0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592,
  0x0593, 0x0594, 0x0595, 0x0596, 0x0597, 0x0598, 0x0599, 0x059c, 0x059d, 0x059e, 0x059f, 0x05a0,
  0x05a1, 0x05a8, 0x05a9, 0x05ab, 0x05ac, 0x05af, 0x05c4, 0x0610, 0x0611, 0x0612, 0x0613, 0x0614,
  0x0615, 0x0616, 0x0617, 0x0657, 0x0658, 0x0659, 0x065a, 0x065b, 0x065d, 0x065e, 0x06d6, 0x06d7,
  0x06d8, 0x06d9, 0x06da, 0x06db, 0x06dc, 0x06df, 0x06e0, 0x06e1, 0x06e2, 0x06e4, 0x06e7, 0x06e8,
  0x06eb, 0x06ec, 0x0730, 0x0732, 0x0733, 0x0735, 0x0736, 0x073a, 0x073d, 0x073f, 0x0740, 0x0741,
  0x0743, 0x0745, 0x0747, 0x0749, 0x074a, 0x07eb, 0x07ec, 0x07ed, 0x07ee, 0x07ef, 0x07f0, 0x07f1,
  0x07f3, 0x0816, 0x0817, 0x0818, 0x0819, 0x081b, 0x081c, 0x081d, 0x081e, 0x081f, 0x0820, 0x0821,
  0x0822, 0x0823, 0x0825, 0x0826, 0x0827, 0x0829, 0x082a, 0x082b, 0x082c, 0x082d, 0x0951, 0x0953,
  0x0954, 0x0f82, 0x0f83, 0x0f86, 0x0f87, 0x135d, 0x135e, 0x135f, 0x17dd, 0x193a, 0x1a17, 0x1a75,
  0x1a76, 0x1a77, 0x1a78, 0x1a79, 0x1a7a, 0x1a7b, 0x1a7c, 0x1b6b, 0x1b6d, 0x1b6e, 0x1b6f, 0x1b70,
  0x1b71, 0x1b72, 0x1b73, 0x1cd0, 0x1cd1, 0x1cd2, 0x1cda, 0x1cdb, 0x1ce0, 0x1ce8, 0x1ced, 0x1cf4,
  0x1cf8, 0x1cf9, 0x1dc0, 0x1dc1, 0x1dc3, 0x1dc4, 0x1dc5, 0x1dc6, 0x1dc7, 0x1dc8, 0x1dc9, 0x1dcb,
  0x1dcc, 0x1dd1, 0x1dd2, 0x1dd3, 0x1dd4, 0x1dd5, 0x1dd6, 0x1dd7, 0x1dd8, 0x1dd9, 0x1dda, 0x1ddb,
  0x1ddc, 0x1ddd, 0x1dde, 0x1ddf, 0x1de0, 0x1de1, 0x1de2, 0x1de3, 0x1de4, 0x1de5, 0x1de6, 0x1dfe,
  0x20d0, 0x20d1, 0x20d4, 0x20d5, 0x20d6, 0x20d7, 0x20db, 0x20dc, 0x20e1, 0x20e7, 0x20e9, 0x20f0,
  0x2cef, 0x2cf0, 0x2cf1, 0x2de0, 0x2de1, 0x2de2, 0x2de3, 0x2de4, 0x2de5, 0x2de6, 0x2de7, 0x2de8,
  0x2de9, 0x2dea, 0x2deb, 0x2dec, 0x2ded, 0x2dee, 0x2def, 0x2df0, 0x2df1, 0x2df2, 0x2df3, 0x2df4,
  0x2df5, 0x2df6, 0x2df7, 0x2df8, 0x2df9, 0x2dfa, 0x2dfb, 0x2dfc, 0x2dfd, 0x2dfe, 0x2dff, 0xa66f,
  0xa67c, 0xa67d, 0xa6f0, 0xa6f1, 0xa8e0, 0xa8e1, 0xa8e2, 0xa8e3, 0xa8e4, 0xa8e5, 0xa8e6, 0xa8e7,
  0xa8e8, 0xa8e9, 0xa8ea, 0xa8eb, 0xa8ec, 0xa8ed, 0xa8ee, 0xa8ef, 0xa8f0, 0xa8f1,
];

function encodeByte(b: number): string {
  const cp = DIACRITICS[b & 0xff] ?? 0x0305;
  return String.fromCodePoint(cp);
}

function buildPlaceholder(imageId: number, rows: number, cols: number): string {
  const cell = "\u{10EEEE}";
  const color = `\x1b[38;2;${(imageId >> 16) & 0xff};${(imageId >> 8) & 0xff};${imageId & 0xff}m`;
  const highIdByte = imageId > 0xffffff ? encodeByte((imageId >> 24) & 0xff) : "";
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const rowEnc = encodeByte(r);
    const cells: string[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push(cell + rowEnc + encodeByte(c) + highIdByte);
    }
    lines.push(`${color}${cells.join("")}\x1b[39m`);
  }
  return lines.join("\n");
}

/**
 * Unicode placeholders only work on terminals that implement them — kitty and
 * Ghostty (name-verified) do. Probe-detected kitty terminals on an "unknown"
 * name are treated as placeholder-safe (kitty-over-SSH keeps working);
 * WezTerm's opt-in kitty mode and Konsole answer the probe but have no
 * placeholder support, so Ink-embedded rendering must stay on text there.
 */
function supportsKittyPlaceholders(terminal: TerminalId): boolean {
  if (terminal === "kitty" || terminal === "ghostty") return true;
  if (terminal === "unknown") return getProbedGraphicsSupport()?.kittyGraphics === true;
  return false;
}

/**
 * Universal in-process text renderer: two pixels per cell via U+2580 with
 * truecolour SGR. Needs no external binary — this is what keeps posters alive
 * on Windows Terminal, iTerm2, and any chafa-less machine.
 */
async function renderHalfBlockText(
  data: ArrayBuffer,
  rows: number,
  cols: number,
): Promise<PosterResult> {
  // Decode straight to the cell geometry we are about to draw: two pixels per
  // cell row is what the half-block trick encodes. Bun.Image does the resize
  // natively and off-thread, so the full-size bitmap never enters JS and the
  // event loop keeps ticking; without it this falls back to a blocking decode.
  const image = await decodeToRgba(new Uint8Array(data), { width: cols, height: rows * 2 });
  if (!image) return { kind: "none" };
  const text = buildHalfBlockOutput(image, {
    size: `${cols}x${rows}`,
    maxRows: rows,
    debug: false,
  }).trimEnd();
  if (!text) return { kind: "none" };
  return { kind: "text", placeholder: text, rows, cols };
}

/**
 * Sixel is an overlay, not Ink text.
 *
 * This returns a `sixel` PosterResult rather than escape bytes: `SixelPosterPane`
 * reserves and measures an empty Ink rectangle, and the overlay manager writes
 * the pixels after Ink's frame has committed. Sixel bytes placed into the Ink
 * frame itself would be measured as text and corrupt the layout.
 */
function renderSixelOverlay(
  data: ArrayBuffer,
  rows: number,
  cols: number,
  placementSlot?: KittyPlacementSlot,
): PosterResult {
  const sixel = renderSixelFromBytes(new Uint8Array(data), {
    ...pixelBudgetForCells(cols, rows),
    maxColors: APP_SHELL_SIXEL_MAX_COLORS,
  });
  if (!sixel) return { kind: "none" };
  return {
    kind: "sixel",
    sixel,
    rows,
    cols,
    overlayId: placementSlot ?? `sixel-${allocId()}`,
  };
}

async function renderKitty(
  data: ArrayBuffer,
  rows: number,
  cols: number,
  placementSlot?: KittyPlacementSlot,
  signal?: AbortSignal,
): Promise<PosterResult> {
  if (data.byteLength === 0) return { kind: "none" };
  if (signal?.aborted) return { kind: "none" };
  const bytes = new Uint8Array(data);
  // Native PNG first: Bun.Image encodes off-thread, and an f=100 PNG is both
  // smaller on the wire than deflated RGBA and skips the synchronous
  // decode-then-deflate pair entirely. In-process decode is the fallback, and
  // ImageMagick stays the last resort for formats neither can read (WebP, …).
  const nativePng = await encodeNativePng(bytes);
  let payload: KittyPayload | null = nativePng
    ? { kind: "png", data: nativePng }
    : prepareKittyPayload(bytes);
  if (!payload) {
    const png = await ensurePngBytes(bytes);
    if (png) payload = { kind: "png", data: png };
  }
  if (signal?.aborted) return { kind: "none" };
  if (!payload) {
    // Undecodable even with ImageMagick: fall back to text renderers and
    // release any prior Kitty for this slot so it does not ghost underneath.
    debugImage("kitty payload preparation failed; falling back to text renderers");
    if (placementSlot) releaseKittySlot(placementSlot);
    return await renderTextPoster(data, rows, cols);
  }
  const imageId = allocId();
  await uploadKittyPayload(payload, {
    imageId,
    rows,
    cols,
    unicodePlaceholder: true,
    preferFileTransmission: true,
  });
  if (signal?.aborted) {
    // Upload finished after cancel — delete the orphan so it cannot clobber a winner.
    deleteKittyImage(imageId);
    return { kind: "none" };
  }
  if (placementSlot) {
    registerKittyPlacement(placementSlot, imageId);
  }
  return {
    kind: "kitty",
    placeholder: buildPlaceholder(imageId, rows, cols),
    rows,
    cols,
    imageId,
  };
}

function isWritableStream(value: unknown): value is WritableStream<Uint8Array> {
  return Boolean(value && typeof (value as WritableStream<Uint8Array>).getWriter === "function");
}

/** Bun's `FileSink`, which is what a spawned child's piped stdin actually is. */
type ChildStdinSink = {
  write: (chunk: Uint8Array) => unknown;
  end: () => unknown;
};

function isFileSink(value: unknown): value is ChildStdinSink {
  const sink = value as ChildStdinSink | null;
  return Boolean(sink && typeof sink.write === "function" && typeof sink.end === "function");
}

/**
 * Send the encoder its image and close the pipe.
 *
 * Bun hands a spawned child's piped stdin back as a `FileSink` (`write`/`end`),
 * not a `WritableStream` (`getWriter`). Testing only for `getWriter` meant this
 * silently wrote nothing and, worse, never closed the pipe -- chafa sat waiting
 * on stdin that would never end, `proc.exited` never settled, and the poster
 * stayed in its loading state forever. The spinner ran until the user quit, and
 * only on machines that *had* chafa: without it the code returns early and the
 * half-block fallback paints normally, so installing the better encoder was what
 * broke posters entirely.
 *
 * Closing is the part that must not be skipped, so it happens in `finally`.
 */
async function writeImageToEncoder(stdin: unknown, data: ArrayBuffer): Promise<boolean> {
  const bytes = new Uint8Array(data);
  try {
    if (isWritableStream(stdin)) {
      const writer = stdin.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        await writer.close().catch(() => {});
      }
      return true;
    }
    if (isFileSink(stdin)) {
      try {
        stdin.write(bytes);
      } finally {
        stdin.end();
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * How long the shell will wait on the external encoder before painting without
 * it. A poster is decoration; the UI must never be hostage to a child process
 * that does not exit. On timeout the caller falls through to the in-process
 * half-block renderer, which needs no subprocess at all.
 */
const CHAFA_RENDER_TIMEOUT_MS = 3_000;

async function renderChafaSymbols(
  data: ArrayBuffer,
  rows: number,
  cols: number,
): Promise<PosterResult> {
  if (!runtime.which("chafa")) return { kind: "none" };
  const proc = runtime.spawn(
    [
      "chafa",
      "--format",
      "symbols",
      "--size",
      `${cols}x${rows}`,
      "--animate",
      "off",
      "--polite",
      "on",
      "--colors",
      "full",
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );

  if (!(await writeImageToEncoder(proc.stdin, data))) {
    // Never leave a child blocked on a pipe we are not going to write.
    proc.kill();
    debugImage("chafa symbols: could not write image to encoder stdin");
    return { kind: "none" };
  }

  const collected = await Promise.race([
    Promise.all([
      new Response(proc.stdout as ReadableStream | null).arrayBuffer(),
      new Response(proc.stderr as ReadableStream | null).arrayBuffer(),
      proc.exited,
    ]),
    Bun.sleep(CHAFA_RENDER_TIMEOUT_MS).then(() => null),
  ]);

  if (!collected) {
    proc.kill();
    debugImage(`chafa symbols timed out after ${CHAFA_RENDER_TIMEOUT_MS}ms; using half-block`);
    return { kind: "none" };
  }

  const [stdoutBuf, stderrBuf, exitCode] = collected;

  if (exitCode !== 0) {
    const stderrText = stderrBuf.byteLength ? new TextDecoder().decode(stderrBuf).trim() : "";
    debugImage(`chafa symbols failed (code ${exitCode})${stderrText ? `: ${stderrText}` : ""}`);
    return { kind: "none" };
  }

  const text = stdoutBuf.byteLength ? new TextDecoder().decode(stdoutBuf).trimEnd() : "";
  if (!text) return { kind: "none" };

  return { kind: "text", placeholder: text, rows, cols };
}

/**
 * Text poster chain: chafa symbols when chafa resolves (higher fidelity:
 * symbol selection + dithering), otherwise the in-process half-block
 * renderer. Never spawns a process on the half-block path.
 */
async function renderTextPoster(
  data: ArrayBuffer,
  rows: number,
  cols: number,
): Promise<PosterResult> {
  const viaChafa = await renderChafaSymbols(data, rows, cols);
  if (viaChafa.kind !== "none") return viaChafa;
  return await renderHalfBlockText(data, rows, cols);
}

export async function renderPoster(
  data: ArrayBuffer,
  {
    rows,
    cols,
    allowKitty = true,
    allowSixel = true,
    inkEmbedded = false,
    placementSlot,
    signal,
  }: {
    rows: number;
    cols: number;
    allowKitty?: boolean;
    allowSixel?: boolean;
    inkEmbedded?: boolean;
    placementSlot?: KittyPlacementSlot;
    signal?: AbortSignal;
  },
): Promise<PosterResult> {
  try {
    if (signal?.aborted) return { kind: "none" };
    if (inkEmbedded) {
      return await renderTextPoster(data, rows, cols);
    }
    if (!allowKitty) return { kind: "none" };
    const capability = runtime.detectImageCapability();
    if (!capability.available || capability.renderer === "none") return { kind: "none" };
    if (capability.renderer === "kitty-native") {
      if (supportsKittyPlaceholders(capability.terminal)) {
        return await renderKitty(data, rows, cols, placementSlot, signal);
      }
      // The probe found kitty graphics but the terminal has no Unicode
      // placeholders (WezTerm's opt-in kitty mode, Konsole). A real placement
      // would fight Ink's layout, so stay on text renderers.
      debugImage(
        `kitty Unicode placeholders unsupported on terminal "${capability.terminal}"; using text renderers`,
      );
      return await renderTextPoster(data, rows, cols);
    }
    if (capability.renderer === "chafa-symbols") {
      return await renderTextPoster(data, rows, cols);
    }
    if (capability.renderer === "sixel") {
      if (!allowSixel) return await renderTextPoster(data, rows, cols);
      return renderSixelOverlay(data, rows, cols, placementSlot);
    }
    // half-block: capability-faithful in-process rendering, no chafa spawn.
    const viaHalfBlock = await renderHalfBlockText(data, rows, cols);
    if (viaHalfBlock.kind !== "none") return viaHalfBlock;
    // Undecodable in-process (e.g. WebP): chafa may still manage it.
    return await renderChafaSymbols(data, rows, cols);
  } catch (error) {
    debugImage(`poster render failed: ${error instanceof Error ? error.message : String(error)}`);
    return { kind: "none" };
  }
}

export type { KittyPlacementSlot };

type PosterFallbackColor = "amber" | "teal" | "purple" | "pink";
const POSTER_COLORS: readonly PosterFallbackColor[] = ["amber", "teal", "purple", "pink"];

export function hashTitleToColor(title: string): PosterFallbackColor {
  let hash = 5381;
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) + hash) ^ title.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return POSTER_COLORS[hash % POSTER_COLORS.length]!;
}

export const __testing = {
  APP_SHELL_SIXEL_MAX_COLORS,
  runtime,
};
