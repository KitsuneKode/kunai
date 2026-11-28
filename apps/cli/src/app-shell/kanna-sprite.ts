// The companion as a Kitty sprite: uploaded once, placed by text, animated by
// the terminal.
//
// Ink erases and redraws its whole frame on every render, so anything placed by
// cursor position is wiped or misaligned by the next keystroke. This path does
// not place anything. It transmits the image under an id, declares a virtual
// placement, and hands Ink a block of placeholder cells that name that id. The
// cells are ordinary text: Ink lays them out, moves them, scrolls them and
// repaints them, and the terminal draws her wherever they land.
//
// Her motion is the terminal's too. The drawings go up as animation frames and
// the terminal loops them, so a blink costs no render and no bytes after the
// first upload.
//
// What this module owns is the lifetime of those ids: one upload per pose and
// pixel size, shared by every surface that shows her, and every one of them
// deleted when the last surface lets go — and again on a global wipe and on
// exit, so nothing is left in the terminal after Kunai is gone.

import { getTerminalCellPixels, type CellPixels } from "@/image/cell-size";
import { debugImage } from "@/image/debug";
import type { DecodedImage } from "@/image/decode";
import {
  animationCommands,
  deleteImageCommand,
  encodeCommand,
  sendCommands,
  transmitCommand,
  virtualPlacementCommand,
  type AnimationStep,
  type RgbaFrame,
} from "@/image/kitty-animation";
import { withKittyStream } from "@/image/kitty-transport";
import { preparePoster } from "@/image/native-image";
import { CELL_ASPECT } from "@/image/renderers/sixel";
import { createKeyedJoiner } from "@/infra/concurrency/keyed-joiner";

import { companionMotion, companionPetPath, companionStripPath } from "./companion-assets";
import type { CompanionPose } from "./companion-policy";
import {
  allocKittyImageId,
  buildPlaceholder,
  kittyPlaceholderPassthrough,
  onTerminalImagesWiped,
} from "./poster-renderer";

export type KannaSprite = {
  readonly imageId: number;
  /** The cells Ink prints. The image is wherever these are. */
  readonly placeholder: string;
  readonly rows: number;
  readonly cols: number;
  /** Edge of the square she was sized to, in pixels. */
  readonly pixels: number;
  readonly animated: boolean;
};

/** The cell box a pose occupies, and the pixel square that fits it exactly. */
export type KannaSlot = {
  readonly rows: number;
  readonly cols: number;
  readonly pixels: number;
};

const runtime = {
  readFile: (path: string): Promise<Uint8Array> => Bun.file(path).bytes(),
  prepare: preparePoster,
  write: (text: string): void => {
    process.stdout.write(text);
  },
  passthrough: kittyPlaceholderPassthrough,
  env: (): NodeJS.ProcessEnv => process.env,
};

/**
 * Size her from the cell the terminal measured, not from a guess.
 *
 * She is square and a cell is not, so the slot is as many columns as it takes
 * to be at least as wide as it is tall. The image is then exactly the slot's
 * height in pixels, which means the terminal draws it one source pixel to one
 * screen pixel: no resampling, so no blur and no stretch. Without a measurement
 * the usual 1:2 cell is assumed and the terminal fits whatever it gets.
 */
export function kannaSlot(
  rows: number,
  cell: CellPixels | null = getTerminalCellPixels(),
): KannaSlot {
  if (!cell) {
    const cols = Math.max(2, Math.round(rows * CELL_ASPECT));
    return { rows, cols, pixels: rows * 20 };
  }
  const pixels = rows * cell.height;
  return { rows, cols: Math.max(2, Math.ceil(pixels / cell.width)), pixels };
}

/** Whether this terminal can host her as a sprite at all. */
export function kannaSpriteAvailable(): boolean {
  return runtime.passthrough() !== undefined;
}

const sprites = new Map<string, KannaSprite>();
/**
 * Two surfaces asking for one pose share one upload. Nothing here is ever
 * abandoned on purpose — an upload that outlives its callers checks for that
 * itself and deletes what it sent — so the work always runs to the end.
 */
const uploads = createKeyedJoiner<KannaSprite | null>({ whenAbandoned: "finish" });
const epochListeners = new Set<() => void>();
let holders = 0;
/** Bumped whenever every id went dead at once, so mounted surfaces re-acquire. */
let epoch = 0;
let exitHooked = false;

function spriteKey(pose: CompanionPose, slot: KannaSlot, animated: boolean): string {
  return `${pose}:${slot.rows}x${slot.cols}:${slot.pixels}:${animated ? "anim" : "still"}`;
}

function sliceFrames(strip: DecodedImage, count: number): RgbaFrame[] {
  const width = Math.floor(strip.width / count);
  const frames: RgbaFrame[] = [];
  for (let index = 0; index < count; index++) {
    const rgba = new Uint8Array(width * strip.height * 4);
    for (let y = 0; y < strip.height; y++) {
      const from = (y * strip.width + index * width) * 4;
      rgba.set(strip.rgba.subarray(from, from + width * 4), y * width * 4);
    }
    frames.push({ width, height: strip.height, rgba });
  }
  return frames;
}

type Drawings = { readonly frames: readonly RgbaFrame[]; readonly loop: readonly AnimationStep[] };

/**
 * Decode a pose at the size it will be drawn.
 *
 * The resize happens natively, once, on the whole strip: every drawing shares
 * one scale and one sampling phase, so a pixel that did not change between two
 * drawings is byte-identical in both and drops out of the frame delta.
 */
async function loadDrawings(
  pose: CompanionPose,
  pixels: number,
  animated: boolean,
): Promise<Drawings | null> {
  const motion = companionMotion(pose);
  if (!animated || motion.frames < 2) {
    const still = await runtime.prepare(await runtime.readFile(companionPetPath(pose)), {
      maxWidthPx: pixels,
      maxHeightPx: pixels,
    });
    return still ? { frames: [still.image], loop: [] } : null;
  }
  const strip = await runtime.prepare(await runtime.readFile(companionStripPath(pose)), {
    maxWidthPx: pixels * motion.frames,
    maxHeightPx: pixels,
  });
  if (!strip) return null;
  return {
    frames: sliceFrames(strip.image, motion.frames),
    loop: motion.loop.map(([frame, gapMs]) => ({ frame, gapMs })),
  };
}

function writeDeleteSprite(sprite: KannaSprite): void {
  const passthrough = runtime.passthrough() ?? undefined;
  runtime.write(encodeCommand(deleteImageCommand(sprite.imageId), passthrough));
}

function deleteSprite(sprite: KannaSprite, options: { readonly synchronous?: boolean } = {}): void {
  if (options.synchronous) {
    writeDeleteSprite(sprite);
    return;
  }
  // A delete is still a graphics command. Runtime cleanup queues behind any
  // chunked upload already on the stream; only process exit writes synchronously.
  void withKittyStream(async () => {
    writeDeleteSprite(sprite);
  });
}

/** Delete every sprite from the terminal. Pass `synchronous` only on exit. */
export function releaseAllKannaSprites(options: { readonly synchronous?: boolean } = {}): void {
  for (const sprite of sprites.values()) deleteSprite(sprite, options);
  sprites.clear();
}

function forgetSprites(): void {
  // A wipe took the images already; the ids are deleted again by name because
  // a virtual placement is not a visible one, and whether `d=A` reaches it is
  // the terminal's call. Deleting a dead id is free.
  releaseAllKannaSprites();
  epoch += 1;
  for (const listener of epochListeners) listener();
}

onTerminalImagesWiped(forgetSprites);

function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  // The shutdown path wipes the terminal, but a crash or a lost race with the
  // force-exit timer skips it. `exit` always runs and a TTY write is
  // synchronous, so this is the one place that cannot be skipped.
  process.once("exit", () => releaseAllKannaSprites({ synchronous: true }));
}

/** A wipe can land mid-upload more than once only if surfaces are thrashing. */
const UPLOAD_ATTEMPTS = 3;

async function uploadSprite(
  key: string,
  pose: CompanionPose,
  slot: KannaSlot,
  animated: boolean,
): Promise<KannaSprite | null> {
  const passthrough = runtime.passthrough();
  if (passthrough === undefined) return null;

  const drawings = await loadDrawings(pose, slot.pixels, animated);
  const first = drawings?.frames[drawings.loop[0]?.frame ?? 0];
  if (!drawings || !first) return null;
  hookExit();

  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
    const startedAt = epoch;
    const imageId = allocKittyImageId(passthrough === "tmux");
    const commands = [
      transmitCommand(imageId, first),
      virtualPlacementCommand(imageId, slot.cols, slot.rows),
      ...animationCommands(imageId, drawings.frames, drawings.loop),
    ];
    const ptyBytes = await sendCommands(commands, {
      passthrough: passthrough ?? undefined,
      env: runtime.env(),
      write: runtime.write,
    });
    const sprite: KannaSprite = {
      imageId,
      placeholder: buildPlaceholder(imageId, slot.rows, slot.cols),
      rows: slot.rows,
      cols: slot.cols,
      pixels: slot.pixels,
      animated: drawings.loop.length > 1,
    };
    debugImage(
      `kanna ${pose} ${slot.pixels}px: ${drawings.frames.length} drawing(s), ${commands.length} command(s), ${ptyBytes} bytes on the pty`,
    );
    // Let go of by every surface while the upload was in flight: the id would
    // never be printed, so it must not be left behind.
    if (holders === 0) {
      deleteSprite(sprite);
      return null;
    }
    if (startedAt === epoch) {
      // Cache in the same synchronous critical section as the epoch check. A
      // wipe cannot run between the two here, so no dead id can enter the map.
      sprites.set(key, sprite);
      return sprite;
    }
    // A global wipe landed mid-upload and took this image with it. Everyone
    // waiting on this upload still wants her, so it is sent again here rather
    // than handing them a dead id — or a null that leaves them on the glyph.
    deleteSprite(sprite);
  }
  return null;
}

/**
 * The sprite for a pose, uploading it the first time it is asked for.
 *
 * Later calls for the same pose and size return the same id without touching
 * the terminal — transmit once, place as often as needed.
 */
export function acquireKannaSprite(
  pose: CompanionPose,
  slot: KannaSlot,
  animated: boolean,
): Promise<KannaSprite | null> {
  const key = spriteKey(pose, slot, animated);
  const ready = sprites.get(key);
  if (ready) return Promise.resolve(ready);
  // One upload per pose and size, whatever happens around it. A wipe that
  // lands mid-flight is the upload's own problem to recover from; a second
  // upload racing the first would leave one of the two ids owned by nobody.
  return uploads.join(key, async () => {
    try {
      return uploadSprite(key, pose, slot, animated);
    } catch (error) {
      debugImage(`kanna sprite failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  });
}

/** The sprite if it is already uploaded — for a first render with no flash. */
export function readyKannaSprite(
  pose: CompanionPose,
  slot: KannaSlot,
  animated: boolean,
): KannaSprite | null {
  return sprites.get(spriteKey(pose, slot, animated)) ?? null;
}

/**
 * Declare that a surface is showing her. Returns the release.
 *
 * Sprites outlive a single pose so that a surface moving `seek` → `oops` →
 * `seek` uploads each once. They do not outlive the last surface: when nothing
 * is showing her, every id is deleted. The check is deferred a tick because a
 * pose change is an unmount followed at once by a mount, and deleting between
 * the two would throw away the upload the next line is about to reuse.
 */
export function holdKannaSprites(): () => void {
  holders += 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders -= 1;
    queueMicrotask(() => {
      if (holders === 0) releaseAllKannaSprites();
    });
  };
}

export function subscribeKannaEpoch(listener: () => void): () => void {
  epochListeners.add(listener);
  return () => {
    epochListeners.delete(listener);
  };
}

export function kannaEpoch(): number {
  return epoch;
}

export const __testing = {
  runtime,
  sliceFrames,
  get sprites() {
    return sprites;
  },
  reset(): void {
    sprites.clear();
    holders = 0;
  },
};
