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
// deleted when the last surface lets go and again on exit, so nothing is left
// in the terminal after Kunai is gone.
//
// The shell's global wipe (`d=A`, on surface changes and resizes) is not her
// concern. It deletes the placements visible on screen, and a virtual placement
// is not one: kitty 0.51 and Ghostty 1.4 both keep drawing her through it,
// checked by screenshot. Re-uploading on every wipe would be churn for nothing.

import { getTerminalCellPixels } from "@/image/cell-size";
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
  type KittyCommand,
  type RgbaFrame,
} from "@/image/kitty-animation";
import { preparePoster } from "@/image/native-image";
import { CELL_ASPECT } from "@/image/renderers/sixel";

import { companionMotion, companionPetPath, companionStripPath } from "./companion-assets";
import type { CompanionPose } from "./companion-policy";
import {
  allocKittyImageId,
  buildPlaceholder,
  kittyPlaceholderPassthrough,
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

/** Pixels per row when the terminal never reported its cell size. */
const FALLBACK_CELL_HEIGHT_PX = 20;

/**
 * Size her from the cell the terminal measured, not from a guess.
 *
 * She is square and a cell is not, so the slot is as many columns as it takes
 * to be at least as wide as it is tall. The image is then exactly the slot's
 * height in pixels, which means the terminal draws it one source pixel to one
 * screen pixel: no resampling, so no blur and no stretch. Without a measurement
 * the usual 1:2 cell is assumed and the terminal fits whatever it gets.
 */
export function kannaSlot(rows: number): KannaSlot {
  const cell = getTerminalCellPixels();
  if (!cell) {
    const cols = Math.max(2, Math.round(rows * CELL_ASPECT));
    return { rows, cols, pixels: rows * FALLBACK_CELL_HEIGHT_PX };
  }
  const pixels = rows * cell.height;
  return { rows, cols: Math.max(2, Math.ceil(pixels / cell.width)), pixels };
}

/** Whether this terminal can host her as a sprite at all. */
export function kannaSpriteAvailable(): boolean {
  return runtime.passthrough() !== undefined;
}

/**
 * One pose at one size, built once for the life of the process.
 *
 * The id is fixed with it, so the commands — and the escapes `encodeCommand`
 * memoizes for them — stay valid across a delete and a re-send. Decode, resize,
 * frame delta and deflate each happen once per entry, however often she comes
 * and goes.
 */
type SpriteBuild = {
  readonly sprite: KannaSprite;
  readonly commands: readonly KittyCommand[];
  readonly passthrough: "tmux" | undefined;
};

const builds = new Map<string, SpriteBuild>();
/** Keys whose image is in the terminal right now. */
const live = new Set<string>();
const inflight = new Map<string, Promise<KannaSprite | null>>();
let holders = 0;
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

function deleteKey(key: string): void {
  const build = builds.get(key);
  if (!build || !live.delete(key)) return;
  runtime.write(encodeCommand(deleteImageCommand(build.sprite.imageId), build.passthrough));
}

/** Delete every sprite from the terminal. Synchronous, so it is safe on exit. */
export function releaseAllKannaSprites(): void {
  // Deleting the entry being visited is safe in a Set's iterator.
  for (const key of live) deleteKey(key);
}

function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  // Unmounting the last surface deletes her, but a crash, a signal, or a lost
  // race with the force-exit timer can skip the unmount. `exit` always runs —
  // every signal handler in `main.ts` ends in `process.exit` — and a TTY write
  // is synchronous, so this is the one place that cannot be skipped.
  process.once("exit", releaseAllKannaSprites);
}

async function buildSprite(
  pose: CompanionPose,
  slot: KannaSlot,
  animated: boolean,
): Promise<SpriteBuild | null> {
  const passthrough = runtime.passthrough();
  if (passthrough === undefined) return null;

  const drawings = await loadDrawings(pose, slot.pixels, animated);
  const first = drawings?.frames[drawings.loop[0]?.frame ?? 0];
  if (!drawings || !first) return null;

  const imageId = allocKittyImageId(passthrough === "tmux");
  const commands = [
    transmitCommand(imageId, first),
    virtualPlacementCommand(imageId, slot.cols, slot.rows),
    ...animationCommands(imageId, drawings.frames, drawings.loop),
  ];
  debugImage(
    `kanna ${pose} ${slot.pixels}px: ${drawings.frames.length} drawing(s), ${commands.length} command(s)`,
  );
  return {
    sprite: {
      imageId,
      placeholder: buildPlaceholder(imageId, slot.rows, slot.cols),
      rows: slot.rows,
      cols: slot.cols,
      pixels: slot.pixels,
      animated: drawings.loop.length > 1,
    },
    commands,
    passthrough: passthrough ?? undefined,
  };
}

async function uploadSprite(
  key: string,
  pose: CompanionPose,
  slot: KannaSlot,
  animated: boolean,
): Promise<KannaSprite | null> {
  const build = builds.get(key) ?? (await buildSprite(pose, slot, animated));
  if (!build) return null;
  builds.set(key, build);
  // Every surface let go while the pixels were being prepared. Keep the build
  // for next time, but put nothing in the terminal that nobody will print.
  if (holders === 0) return null;

  hookExit();
  const ptyBytes = await sendCommands(build.commands, {
    passthrough: build.passthrough,
    write: runtime.write,
    env: runtime.env(),
  });
  live.add(key);
  debugImage(`kanna ${pose} sent: ${ptyBytes} bytes on the pty`);
  // Let go of while the commands were going out: delete what just landed.
  if (holders === 0) {
    deleteKey(key);
    return null;
  }
  return build.sprite;
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
  const ready = readyKannaSprite(pose, slot, animated);
  if (ready) return Promise.resolve(ready);
  const key = spriteKey(pose, slot, animated);
  const pending = inflight.get(key);
  if (pending) return pending;

  const task = uploadSprite(key, pose, slot, animated)
    .catch((error: unknown) => {
      debugImage(`kanna sprite failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    })
    .finally(() => {
      if (inflight.get(key) === task) inflight.delete(key);
    });
  inflight.set(key, task);
  return task;
}

/** The sprite if it is in the terminal right now — for a render with no flash. */
export function readyKannaSprite(
  pose: CompanionPose,
  slot: KannaSlot,
  animated: boolean,
): KannaSprite | null {
  const key = spriteKey(pose, slot, animated);
  return live.has(key) ? (builds.get(key)?.sprite ?? null) : null;
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

export const __testing = {
  runtime,
  sliceFrames,
  liveIds(): number[] {
    return [...live].flatMap((key) => {
      const build = builds.get(key);
      return build ? [build.sprite.imageId] : [];
    });
  },
  reset(): void {
    builds.clear();
    live.clear();
    inflight.clear();
    holders = 0;
  },
};
