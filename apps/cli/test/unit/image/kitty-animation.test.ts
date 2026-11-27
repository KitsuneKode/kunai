import { afterEach, describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";

import {
  animationCommands,
  deleteImageCommand,
  encodeCommand,
  frameDelta,
  sendCommands,
  transmitCommand,
  virtualPlacementCommand,
  type RgbaFrame,
} from "@/image/kitty-animation";
import { __testing as transportTesting } from "@/image/kitty-transport";

// Byte-exact goldens for the escapes Kanna puts on the wire. kitty 0.51 and
// Ghostty 1.4 were checked by screenshot against exactly these bytes; a change
// here is a change to what those terminals were shown to accept.

const ESC = "\x1b";
/** One APC graphics escape: its keys, and its payload. */
const CHUNK = new RegExp(`${ESC}_G([^;]*);([^${ESC}]*)${ESC}\\\\`, "gu");

/** A flat frame, with one pixel painted, so deltas have something to find. */
function frame(width: number, height: number, paint?: { x: number; y: number }): RgbaFrame {
  const rgba = new Uint8Array(width * height * 4).fill(10);
  if (paint) rgba.set([255, 0, 0, 255], (paint.y * width + paint.x) * 4);
  return { width, height, rgba };
}

/** The deflated payload of a chunked command, reassembled. */
function payloadOf(escape: string): Uint8Array {
  const body = [...escape.matchAll(CHUNK)].map((m) => m[2]).join("");
  return new Uint8Array(inflateSync(Buffer.from(body, "base64")));
}

const originalWriteFile = transportTesting.runtime.writeFile;
const originalWrite = transportTesting.runtime.write;
afterEach(() => {
  transportTesting.runtime.writeFile = originalWriteFile;
  transportTesting.runtime.write = originalWrite;
});

describe("commands", () => {
  test("transmit stores the image without displaying it", () => {
    expect(transmitCommand(7, frame(3, 2)).keys).toBe("a=t,f=32,s=3,v=2,i=7,q=2");
  });

  test("the virtual placement is a cell box under the text, with no position", () => {
    // U=1 is the Unicode-placeholder path: the image appears wherever cells
    // naming id 7 are printed. z=-1 keeps any text above her.
    expect(encodeCommand(virtualPlacementCommand(7, 9, 4))).toBe(
      `${ESC}_Ga=p,U=1,i=7,c=9,r=4,z=-1,q=2;${ESC}\\`,
    );
  });

  test("delete frees the image data and every frame", () => {
    // Upper-case I: delete the placements AND free the stored image.
    expect(encodeCommand(deleteImageCommand(7))).toBe(`${ESC}_Ga=d,d=I,i=7,q=2;${ESC}\\`);
  });
});

describe("encodeCommand", () => {
  test("pixels go up deflated, base64, keys on the first chunk only", () => {
    const pixels = frame(3, 2);
    const escape = encodeCommand(transmitCommand(7, pixels));
    expect(escape.startsWith(`${ESC}_Ga=t,f=32,s=3,v=2,i=7,q=2,o=z,t=d,m=0;`)).toBe(true);
    expect(payloadOf(escape)).toEqual(pixels.rgba);
  });

  test("a large payload splits into m=1 chunks of 4096", () => {
    // Noise does not deflate, so this crosses several chunk boundaries.
    const noisy = frame(64, 64);
    let seed = 0x9e3779b9;
    for (let at = 0; at < noisy.rgba.length; at++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      noisy.rgba[at] = seed & 0xff;
    }
    const escape = encodeCommand(transmitCommand(9, noisy));
    const chunks = [...escape.matchAll(CHUNK)];
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]?.[1]).toBe("a=t,f=32,s=64,v=64,i=9,q=2,o=z,t=d,m=1");
    for (const chunk of chunks.slice(1, -1)) expect(chunk[1]).toBe("m=1");
    expect(chunks.at(-1)?.[1]).toBe("m=0");
    for (const chunk of chunks.slice(0, -1)) expect(chunk[2]?.length).toBe(4096);
    expect(payloadOf(escape)).toEqual(noisy.rgba);
  });

  test("under tmux every chunk is wrapped for passthrough", () => {
    const escape = encodeCommand(virtualPlacementCommand(7, 9, 4), "tmux");
    expect(escape).toBe(
      `${ESC}Ptmux;${ESC}${ESC}_Ga=p,U=1,i=7,c=9,r=4,z=-1,q=2;${ESC}${ESC}\\${ESC}\\`,
    );
  });

  test("encodes a command once, however often it is sent", () => {
    // A re-send after a delete must not re-deflate: the cost is the encode.
    const command = transmitCommand(7, frame(8, 8));
    const first = encodeCommand(command);
    expect(encodeCommand(command)).toBe(first);
    // A different passthrough is a different escape, memoized separately.
    expect(encodeCommand(command, "tmux")).not.toBe(first);
  });
});

describe("frameDelta", () => {
  test("is the smallest rectangle that differs", () => {
    const delta = frameDelta(frame(10, 10), frame(10, 10, { x: 4, y: 6 }));
    expect(delta).toMatchObject({ x: 4, y: 6, width: 1, height: 1 });
    expect([...(delta?.rgba ?? [])]).toEqual([255, 0, 0, 255]);
  });

  test("is null for the same picture", () => {
    expect(frameDelta(frame(4, 4), frame(4, 4))).toBeNull();
  });
});

describe("animationCommands", () => {
  // The idle loop from motion.json: rest, blink, rest, ear flick.
  const drawings = [frame(10, 10), frame(10, 10, { x: 3, y: 2 }), frame(10, 10, { x: 7, y: 1 })];
  const loop = [
    { frame: 0, gapMs: 3000 },
    { frame: 1, gapMs: 120 },
    { frame: 0, gapMs: 2300 },
    { frame: 2, gapMs: 150 },
  ];

  test("builds every beat on the terminal's side, then loops forever", () => {
    expect(animationCommands(5, drawings, loop).map((command) => command.keys)).toEqual([
      // Beat 2: a new drawing, sent as the rectangle that differs from frame 1.
      "a=f,f=32,s=1,v=1,x=3,y=2,c=1,X=1,z=120,i=5,q=2",
      // Beat 3: rest again — copied from frame 1, the patch changes nothing.
      "a=f,f=32,s=1,v=1,x=0,y=0,c=1,X=1,z=2300,i=5,q=2",
      // Beat 4: the ear flick, again only its rectangle.
      "a=f,f=32,s=1,v=1,x=7,y=1,c=1,X=1,z=150,i=5,q=2",
      // Frame 1 was made by the transmit and has no gap until this edit.
      "a=a,i=5,r=1,z=3000,q=2",
      // Run, and loop forever.
      "a=a,i=5,s=3,v=1,q=2",
    ]);
  });

  test("a still has no animation at all", () => {
    // Reduced motion and terminals that cannot animate get exactly one drawing.
    expect(animationCommands(5, [drawings[0] as RgbaFrame], [])).toEqual([]);
    expect(animationCommands(5, drawings, [{ frame: 0, gapMs: 1000 }])).toEqual([]);
  });

  test("a frame identical to rest costs one pixel, not a frame", () => {
    const commands = animationCommands(5, drawings, loop);
    expect(commands[1]?.pixels?.byteLength).toBe(4);
  });
});

describe("sendCommands", () => {
  test("chunks everything when the session is not local kitty or Ghostty", async () => {
    const writes: string[] = [];
    const bytes = await sendCommands(
      [transmitCommand(7, frame(4, 4)), virtualPlacementCommand(7, 2, 1)],
      { env: {}, write: (text) => writes.push(text) },
    );
    expect(writes).toHaveLength(2);
    expect(writes[0]?.startsWith(`${ESC}_Ga=t,`)).toBe(true);
    expect(bytes).toBe(writes.join("").length);
  });

  test("a large frame on local kitty goes as a temp file and never crosses the PTY", async () => {
    const files: Uint8Array[] = [];
    const fileEscapes: string[] = [];
    transportTesting.runtime.writeFile = async (_path, data) => {
      files.push(data);
    };
    transportTesting.runtime.write = (text) => fileEscapes.push(text);
    const ptyWrites: string[] = [];
    const big = frame(128, 128);
    const bytes = await sendCommands([transmitCommand(7, big), virtualPlacementCommand(7, 9, 4)], {
      env: { KITTY_WINDOW_ID: "1" },
      write: (text) => ptyWrites.push(text),
    });
    // The pixels went to disk raw — no deflate, no base64.
    expect(files).toEqual([big.rgba]);
    expect(fileEscapes[0]?.startsWith(`${ESC}_Ga=t,f=32,s=128,v=128,i=7,q=2,t=t;`)).toBe(true);
    // Only the placement crossed the PTY.
    expect(ptyWrites).toEqual([`${ESC}_Ga=p,U=1,i=7,c=9,r=4,z=-1,q=2;${ESC}\\`]);
    expect(bytes).toBe(ptyWrites[0]?.length);
  });
});
