import { detectImageCapability } from "@/image";
import type { TerminalId } from "@/image";
import { debugImage } from "@/image/debug";
import { uploadKittyPayload } from "@/image/kitty-transport";
import { type PosterPixelBounds, type PreparedPoster } from "@/image/native-image";
import { getProbedGraphicsSupport } from "@/image/probe";
import { buildHalfBlockOutput } from "@/image/renderers/half-block";
import { buildItermInlineImage } from "@/image/renderers/iterm-inline";
import { pixelBudgetForCells } from "@/image/renderers/sixel";
import { renderSixelFromImage } from "@/image/sixel";

import {
  clearKittyPlacementRegistry,
  registerKittyPlacement,
  setKittyPlacementDeleteFn,
  type KittyPlacementSlot,
} from "./kitty-placement-registry";
import type { PosterResult } from "./poster-types";

type PosterRuntime = {
  detectImageCapability: typeof detectImageCapability;
};

const runtime: PosterRuntime = {
  detectImageCapability: () => detectImageCapability(),
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

// ── Prepared-poster pipeline ────────────────────────────────────────────────
//
// One plan decides renderer *and* target pixel bounds before any source is
// fetched, so preparation is done once at the geometry that will actually be
// drawn. The renderers then consume the prepared poster: Kitty takes the PNG,
// Sixel and half-block take the decoded RGBA. Nothing here re-decodes.

export type PosterRenderer = "kitty-native" | "iterm-inline" | "sixel" | "half-block";

export type PosterRenderPlan = {
  readonly renderer: PosterRenderer;
  readonly bounds: PosterPixelBounds;
};

/**
 * A Kitty image that has been uploaded but has not claimed its slot yet.
 *
 * Upload and placement are deliberately separate: by the time an upload
 * finishes, the caller may have been superseded, and registering the slot inside
 * rendering would let a stale poster replace a live one. The caller commits only
 * after it has confirmed it is still current.
 */
export type UncommittedKittyPoster = {
  readonly kind: "kitty-upload";
  readonly placeholder: string;
  readonly rows: number;
  readonly cols: number;
  readonly imageId: number;
};

export type RenderedPosterCandidate =
  | UncommittedKittyPoster
  | Exclude<PosterResult, { readonly kind: "kitty" }>;

export type PreparedRenderOptions = {
  readonly rows: number;
  readonly cols: number;
  readonly allowKitty?: boolean;
  readonly allowSixel?: boolean;
  readonly inkEmbedded?: boolean;
  readonly placementSlot?: KittyPlacementSlot;
  readonly signal?: AbortSignal;
};

/**
 * Which renderer will draw, and the pixel box to prepare for it.
 *
 * Returns null when nothing can render, so callers skip source acquisition
 * entirely rather than fetching bytes they cannot use.
 */
export function resolvePosterRenderPlan(options: PreparedRenderOptions): PosterRenderPlan | null {
  const { rows, cols, allowKitty = true, allowSixel = true, inkEmbedded = false } = options;
  if (rows <= 0 || cols <= 0) return null;

  // Inside Ink, a placement would fight the layout, so text is the only option.
  if (inkEmbedded) return { renderer: "half-block", bounds: halfBlockBounds(rows, cols) };
  if (!allowKitty) return null;

  const capability = runtime.detectImageCapability();
  if (!capability.available || capability.renderer === "none") return null;

  if (capability.renderer === "kitty-native" && supportsKittyPlaceholders(capability.terminal)) {
    const budget = pixelBudgetForCells(cols, rows);
    return {
      renderer: "kitty-native",
      bounds: { maxWidthPx: budget.maxWidth, maxHeightPx: budget.maxHeight },
    };
  }
  // Gated on allowSixel for the same reason sixel is: both are measured
  // overlays written outside Ink's frame, so a surface that repaints constantly
  // suppresses them together.
  if (capability.renderer === "iterm-inline" && allowSixel) {
    const budget = pixelBudgetForCells(cols, rows);
    return {
      renderer: "iterm-inline",
      bounds: { maxWidthPx: budget.maxWidth, maxHeightPx: budget.maxHeight },
    };
  }
  if (capability.renderer === "sixel" && allowSixel) {
    const budget = pixelBudgetForCells(cols, rows);
    return {
      renderer: "sixel",
      bounds: { maxWidthPx: budget.maxWidth, maxHeightPx: budget.maxHeight },
    };
  }
  // Everything else — half-block, chafa-symbols, a Kitty build without Unicode
  // placeholders, Sixel with the overlay suppressed — lands on the universal
  // text floor.
  return { renderer: "half-block", bounds: halfBlockBounds(rows, cols) };
}

/** Half-block encodes two pixels per cell row, so height doubles. */
function halfBlockBounds(rows: number, cols: number): PosterPixelBounds {
  return { maxWidthPx: cols, maxHeightPx: rows * 2 };
}

/**
 * Draw a prepared poster. Kitty returns an uncommitted upload; everything else
 * returns a finished result, having no terminal resource to release.
 */
export async function renderPreparedPoster(
  poster: PreparedPoster,
  plan: PosterRenderPlan,
  options: PreparedRenderOptions,
): Promise<RenderedPosterCandidate> {
  const { rows, cols, placementSlot, signal } = options;
  try {
    if (signal?.aborted) return { kind: "none" };
    if (plan.renderer === "kitty-native") {
      return await uploadPreparedKitty(poster, rows, cols, signal);
    }
    if (plan.renderer === "iterm-inline") {
      const escapes = buildItermInlineImage(poster.png, { rows, cols });
      if (!escapes) return { kind: "none" };
      // Carried as a sixel result because it is the same kind of thing: escape
      // bytes the overlay manager writes at a measured rect, erased the same way.
      return {
        kind: "sixel",
        sixel: escapes,
        rows,
        cols,
        overlayId: placementSlot ?? `iterm-${allocId()}`,
      };
    }
    if (plan.renderer === "sixel") {
      const sixel = renderSixelFromImage(poster.image, {
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
    return renderPreparedHalfBlock(poster, rows, cols);
  } catch (error) {
    debugImage(`poster render failed: ${error instanceof Error ? error.message : String(error)}`);
    return { kind: "none" };
  }
}

function renderPreparedHalfBlock(
  poster: PreparedPoster,
  rows: number,
  cols: number,
): RenderedPosterCandidate {
  const text = buildHalfBlockOutput(poster.image, {
    size: `${cols}x${rows}`,
    maxRows: rows,
    debug: false,
  }).trimEnd();
  if (!text) return { kind: "none" };
  return { kind: "text", placeholder: text, rows, cols };
}

async function uploadPreparedKitty(
  poster: PreparedPoster,
  rows: number,
  cols: number,
  signal?: AbortSignal,
): Promise<RenderedPosterCandidate> {
  if (poster.png.byteLength === 0) return { kind: "none" };
  const imageId = allocId();
  // The prepared PNG *is* the payload: no deflate, no RGBA transport, no
  // external conversion.
  await uploadKittyPayload(
    { kind: "png", data: poster.png },
    {
      imageId,
      rows,
      cols,
      unicodePlaceholder: true,
      preferFileTransmission: true,
    },
  );
  if (signal?.aborted) {
    // Upload finished after cancel — delete the orphan so it cannot clobber a
    // winner. Direct deletion, not a registry release: it owns no slot yet.
    deleteKittyImage(imageId);
    return { kind: "none" };
  }
  return {
    kind: "kitty-upload",
    placeholder: buildPlaceholder(imageId, rows, cols),
    rows,
    cols,
    imageId,
  };
}

/** Claim the slot for a confirmed-current upload, replacing any prior image. */
export function commitKittyPlacementCandidate(
  candidate: UncommittedKittyPoster,
  placementSlot?: KittyPlacementSlot,
): PosterResult {
  if (placementSlot) registerKittyPlacement(placementSlot, candidate.imageId);
  return {
    kind: "kitty",
    placeholder: candidate.placeholder,
    rows: candidate.rows,
    cols: candidate.cols,
    imageId: candidate.imageId,
  };
}

/**
 * Drop a stale or aborted upload.
 *
 * Direct deletion is load-bearing: an uncommitted id has no registry ownership,
 * so releasing it through the registry would disturb bookkeeping for whichever
 * image legitimately holds the slot.
 */
export function deleteUncommittedKittyCandidate(candidate: UncommittedKittyPoster): void {
  deleteKittyImage(candidate.imageId);
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
