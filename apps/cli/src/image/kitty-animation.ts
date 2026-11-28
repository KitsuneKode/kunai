// Kitty graphics animation: frames the terminal plays by itself.
//
// Everything the poster path does is a still. This is the part of the protocol
// that lets an image move with no further output from us: the frames are
// uploaded once (`a=f`), given gaps, and set looping (`a=a`). After that the
// terminal owns the clock. Nothing is re-encoded, nothing is re-sent, and Ink —
// which erases and redraws its whole frame on every render — never has to
// render at all for her to blink.
//
// It composes with Unicode placeholders: the placeholder cells name the image
// id, and every placement of an image shows that image's current frame. So the
// animation follows the cells wherever Ink puts them.
//
// Verified against kitty 0.51 and Ghostty 1.4, both of which play `a=f` frames
// through a virtual placement, honour a delta frame composed onto a base
// (`c=`), and replace rather than blend (`X=1`).

import { deflateSync } from "node:zlib";

import { canUseFileTransmission, transmitKittyTempFile, withKittyStream } from "./kitty-transport";
import { wrapTmuxPassthrough } from "./tmux";

/** Straight RGBA, row-major. One frame of one sprite. */
export type RgbaFrame = {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
};

/** One beat of a loop: which drawing, and how long it holds. */
export type AnimationStep = {
  readonly frame: number;
  readonly gapMs: number;
};

/**
 * One graphics command: its control keys, and the pixels it carries if any.
 *
 * Kept apart from the bytes on the wire so the same command can be sent as
 * base64 chunks through the PTY or as a temp file the terminal reads itself.
 */
export type KittyCommand = {
  readonly keys: string;
  readonly pixels?: Uint8Array;
};

/** The rectangle of a frame that differs from another. */
export type FrameDelta = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
};

const CHUNK_SIZE = 4096;
/** These frames are a few kilobytes of flat colour; the best ratio costs microseconds. */
const DEFLATE_LEVEL = 9;

/**
 * The smallest rectangle outside which two frames are identical, or null when
 * they are the same picture.
 *
 * A blink changes two eyes. Sending the whole frame again for that would be
 * most of the upload; sending the rectangle is a few hundred bytes.
 */
export function frameDelta(base: RgbaFrame, next: RgbaFrame): FrameDelta | null {
  const { width, height } = next;
  if (base.width !== width || base.height !== height) {
    return { x: 0, y: 0, width, height, rgba: next.rgba };
  }
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const at = row + x * 4;
      if (
        base.rgba[at] === next.rgba[at] &&
        base.rgba[at + 1] === next.rgba[at + 1] &&
        base.rgba[at + 2] === next.rgba[at + 2] &&
        base.rgba[at + 3] === next.rgba[at + 3]
      ) {
        continue;
      }
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;

  const patchWidth = right - left + 1;
  const patchHeight = bottom - top + 1;
  const rgba = new Uint8Array(patchWidth * patchHeight * 4);
  for (let y = 0; y < patchHeight; y++) {
    const from = ((top + y) * width + left) * 4;
    rgba.set(next.rgba.subarray(from, from + patchWidth * 4), y * patchWidth * 4);
  }
  return { x: left, y: top, width: patchWidth, height: patchHeight, rgba };
}

/** Transmit the image without displaying it. Placement is the cells' job. */
export function transmitCommand(imageId: number, frame: RgbaFrame): KittyCommand {
  return {
    keys: `a=t,f=32,s=${frame.width},v=${frame.height},i=${imageId},q=2`,
    pixels: frame.rgba,
  };
}

/**
 * A virtual placement: no position, only a cell box. The image appears wherever
 * placeholder cells carrying its id are printed, which is what lets Ink own the
 * layout.
 */
export function virtualPlacementCommand(imageId: number, cols: number, rows: number): KittyCommand {
  return { keys: `a=p,U=1,i=${imageId},c=${cols},r=${rows},q=2` };
}

/**
 * Every command that turns a transmitted image into a running loop.
 *
 * The transmitted image is the loop's first beat. Each later beat becomes one
 * terminal frame, built on the terminal's side from a frame it already has:
 *
 * - a drawing seen earlier in the loop is copied from that frame (`c=`) with a
 *   one-pixel patch that changes nothing — the protocol has no "same as", and
 *   a frame must carry data;
 * - a new drawing is the first frame plus the rectangle that differs, written
 *   over it (`X=1`) rather than blended, so a pixel that turns transparent
 *   actually clears.
 *
 * Gaps go on the frames (`z=`); the first frame gets its gap from an `a=a`
 * edit, because it was created by the transmit and never had one. `s=3,v=1`
 * then runs the loop forever.
 */
export function animationCommands(
  imageId: number,
  frames: readonly RgbaFrame[],
  loop: readonly AnimationStep[],
): KittyCommand[] {
  const [first, ...later] = loop;
  const root = first ? frames[first.frame] : undefined;
  if (!first || !root || later.length === 0) return [];

  const commands: KittyCommand[] = [];
  for (const [index, step] of later.entries()) {
    const drawing = frames[step.frame];
    if (!drawing) continue;
    // Terminal frames are 1-based and the transmit made frame 1, so loop beat
    // `n` (0-based) lives in terminal frame `n + 1`.
    const earlier = loop.findIndex((beat, at) => at <= index && beat.frame === step.frame);
    const delta = earlier === -1 ? frameDelta(root, drawing) : null;
    if (delta) {
      commands.push({
        keys: `a=f,f=32,s=${delta.width},v=${delta.height},x=${delta.x},y=${delta.y},c=1,X=1,z=${step.gapMs},i=${imageId},q=2`,
        pixels: delta.rgba,
      });
      continue;
    }
    commands.push({
      keys: `a=f,f=32,s=1,v=1,x=0,y=0,c=${earlier === -1 ? 1 : earlier + 1},X=1,z=${step.gapMs},i=${imageId},q=2`,
      pixels: drawing.rgba.slice(0, 4),
    });
  }
  commands.push({ keys: `a=a,i=${imageId},r=1,z=${first.gapMs},q=2` });
  commands.push({ keys: `a=a,i=${imageId},s=3,v=1,q=2` });
  return commands;
}

/** Delete the image and free its data, every frame included. */
export function deleteImageCommand(imageId: number): KittyCommand {
  return { keys: `a=d,d=I,i=${imageId},q=2` };
}

/**
 * A command as base64 chunks through the PTY — the transport every terminal
 * that speaks the protocol accepts, and the only one that works over SSH.
 *
 * Pixels are zlib-deflated (`o=z`). Only the first chunk carries the keys and
 * every chunk but the last says `m=1`. Under tmux the whole command is wrapped
 * for passthrough, one wrap per chunk.
 */
export function encodeCommand(command: KittyCommand, passthrough?: "tmux"): string {
  const wrap = (escape: string) => (passthrough ? wrapTmuxPassthrough(escape) : escape);
  if (!command.pixels) return wrap(`\x1b_G${command.keys};\x1b\\`);

  const body = Buffer.from(deflateSync(command.pixels, { level: DEFLATE_LEVEL })).toString(
    "base64",
  );
  let out = "";
  for (let at = 0; at < body.length; at += CHUNK_SIZE) {
    const more = at + CHUNK_SIZE < body.length ? 1 : 0;
    const continuation = command.keys.startsWith("a=f,") ? `a=f,m=${more}` : `m=${more}`;
    const keys = at === 0 ? `${command.keys},o=z,t=d,m=${more}` : continuation;
    out += wrap(`\x1b_G${keys};${body.slice(at, at + CHUNK_SIZE)}\x1b\\`);
  }
  return out;
}

/** How many bytes a command puts on the PTY when sent as chunks. */
export function encodedByteLength(command: KittyCommand): number {
  return Buffer.byteLength(encodeCommand(command), "latin1");
}

export type SendOptions = {
  readonly passthrough?: "tmux";
  readonly env?: NodeJS.ProcessEnv;
  readonly write?: (text: string) => void;
};

/**
 * Below this many raw bytes a frame goes through the PTY even on a local
 * session. A blink's patch deflates to a couple of hundred bytes; a temp file
 * for it is a write, an open, a read and an unlink to avoid one short escape.
 */
const FILE_TRANSMISSION_FLOOR_BYTES = 16 * 1024;

/**
 * Send commands in order, choosing a transport per command.
 *
 * On a local kitty or Ghostty a large frame is handed over as a temp file
 * (`t=t`): the terminal reads it from disk and deletes it, so the pixels never
 * cross the PTY and are never deflated or base64'd. Everything else — SSH,
 * tmux, a small patch, a terminal we cannot name — is chunked.
 *
 * Resolves to the bytes written to the PTY, which is what a remote session pays.
 */
export async function sendCommands(
  commands: readonly KittyCommand[],
  options: SendOptions = {},
): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const local = !options.passthrough && canUseFileTransmission(options.env ?? process.env);
  // One turn of the stream for the whole batch: the frames only mean anything
  // in order, and a poster's chunks must not land between them.
  return withKittyStream(async () => {
    let ptyBytes = 0;
    for (const command of commands) {
      if (
        local &&
        command.pixels &&
        command.pixels.byteLength >= FILE_TRANSMISSION_FLOOR_BYTES &&
        (await transmitKittyTempFile(`${command.keys},`, command.pixels))
      ) {
        continue;
      }
      const escape = encodeCommand(command, options.passthrough);
      ptyBytes += Buffer.byteLength(escape, "latin1");
      write(escape);
    }
    return ptyBytes;
  });
}
