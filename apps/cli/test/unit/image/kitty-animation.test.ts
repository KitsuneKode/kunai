import { describe, expect, test } from "bun:test";
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

const ESC = "\x1b";

/** A `size` x `size` frame of one colour, with optional differently coloured pixels. */
function frame(size: number, fill: number, dots: readonly (readonly [number, number])[] = []) {
  const rgba = new Uint8Array(size * size * 4).fill(fill);
  for (const [x, y] of dots) rgba.fill(255, (y * size + x) * 4, (y * size + x) * 4 + 4);
  return { width: size, height: size, rgba } satisfies RgbaFrame;
}

/** The pixels a chunked command carries, decoded back from the wire. */
function payloadOf(escape: string): Uint8Array {
  const body = escape
    .split(`${ESC}\\`)
    .filter(Boolean)
    .map((chunk) => chunk.slice(chunk.indexOf(";") + 1))
    .join("");
  return new Uint8Array(inflateSync(Buffer.from(body, "base64")));
}

describe("frameDelta", () => {
  test("is null for the same picture", () => {
    expect(frameDelta(frame(4, 9), frame(4, 9))).toBeNull();
  });

  test("is the smallest rectangle that holds every changed pixel", () => {
    const delta = frameDelta(
      frame(8, 0),
      frame(8, 0, [
        [2, 3],
        [5, 4],
      ]),
    );
    expect(delta).toMatchObject({ x: 2, y: 3, width: 4, height: 2 });
    // Row 0 of the patch starts at the changed pixel; row 1 ends on the other.
    expect([...(delta?.rgba.subarray(0, 4) ?? [])]).toEqual([255, 255, 255, 255]);
    expect([...(delta?.rgba.subarray(28, 32) ?? [])]).toEqual([255, 255, 255, 255]);
    expect(delta?.rgba.byteLength).toBe(4 * 2 * 4);
  });

  test("a pixel that turns transparent counts as changed", () => {
    const base = frame(2, 200);
    const next = frame(2, 200);
    next.rgba[3] = 0;
    expect(frameDelta(base, next)).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe("the commands, byte for byte", () => {
  test("transmit sends without displaying, and stays quiet", () => {
    // `a=t`, never `a=T`: display is the placeholder cells' job. `q=2` matters
    // as much — a reply would arrive on stdin and be read as keystrokes.
    expect(transmitCommand(7, frame(3, 1)).keys).toBe("a=t,f=32,s=3,v=3,i=7,q=2");
  });

  test("the placement is virtual and sized in cells", () => {
    expect(encodeCommand(virtualPlacementCommand(7, 9, 4))).toBe(
      `${ESC}_Ga=p,U=1,i=7,c=9,r=4,q=2;${ESC}\\`,
    );
  });

  test("delete frees the data, not just the placement", () => {
    expect(encodeCommand(deleteImageCommand(7))).toBe(`${ESC}_Ga=d,d=I,i=7,q=2;${ESC}\\`);
  });

  test("a payload is deflated, base64'd and marked as the last chunk", () => {
    const escape = encodeCommand(transmitCommand(7, frame(2, 5)));
    expect(escape.startsWith(`${ESC}_Ga=t,f=32,s=2,v=2,i=7,q=2,o=z,t=d,m=0;`)).toBe(true);
    expect(escape.endsWith(`${ESC}\\`)).toBe(true);
    expect([...payloadOf(escape)]).toEqual(Array.from({ length: 16 }, () => 5));
  });

  test("a large payload is split, with keys on the first chunk only", () => {
    // Noise does not compress, so this is several 4096-character chunks.
    const noisy = frame(64, 0);
    let seed = 0x2545f491;
    for (let at = 0; at < noisy.rgba.length; at++) {
      // xorshift: deterministic, and incompressible enough to need chunking.
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      noisy.rgba[at] = seed & 0xff;
    }
    const chunks = encodeCommand(transmitCommand(7, noisy)).split(`${ESC}\\`).filter(Boolean);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain("a=t,f=32,s=64,v=64,i=7,q=2,o=z,t=d,m=1;");
    for (const middle of chunks.slice(1, -1)) expect(middle.startsWith(`${ESC}_Gm=1;`)).toBe(true);
    expect(chunks.at(-1)?.startsWith(`${ESC}_Gm=0;`)).toBe(true);
    expect([...payloadOf(chunks.join(`${ESC}\\`))]).toEqual([...noisy.rgba]);
  });

  test("under tmux every chunk is wrapped for passthrough", () => {
    expect(encodeCommand(deleteImageCommand(7), "tmux")).toBe(
      `${ESC}Ptmux;${ESC}${ESC}_Ga=d,d=I,i=7,q=2;${ESC}${ESC}\\${ESC}\\`,
    );
  });
});

describe("animationCommands", () => {
  const rest = frame(8, 0);
  const blink = frame(8, 0, [[3, 3]]);
  const ear = frame(8, 0, [[6, 1]]);

  test("a still has no animation at all", () => {
    expect(animationCommands(7, [rest], [])).toEqual([]);
    expect(animationCommands(7, [rest], [{ frame: 0, gapMs: 100 }])).toEqual([]);
  });

  test("the loop the terminal is handed", () => {
    const keys = animationCommands(
      7,
      [rest, blink, ear],
      [
        { frame: 0, gapMs: 3000 },
        { frame: 1, gapMs: 120 },
        { frame: 0, gapMs: 2300 },
        { frame: 2, gapMs: 150 },
      ],
    ).map((command) => command.keys);

    expect(keys).toEqual([
      // A new drawing: the first frame plus the one pixel that differs.
      "a=f,f=32,s=1,v=1,x=3,y=3,c=1,X=1,z=120,i=7,q=2",
      // Back to rest: a copy of frame 1, carrying a patch that changes nothing.
      "a=f,f=32,s=1,v=1,x=0,y=0,c=1,X=1,z=2300,i=7,q=2",
      "a=f,f=32,s=1,v=1,x=6,y=1,c=1,X=1,z=150,i=7,q=2",
      // The first frame came from the transmit and never had a gap.
      "a=a,i=7,r=1,z=3000,q=2",
      // Run, forever.
      "a=a,i=7,s=3,v=1,q=2",
    ]);
  });

  test("a drawing seen earlier is copied from the frame that already holds it", () => {
    const keys = animationCommands(
      7,
      [rest, blink],
      [
        { frame: 0, gapMs: 600 },
        { frame: 1, gapMs: 500 },
        { frame: 0, gapMs: 600 },
        { frame: 1, gapMs: 500 },
      ],
    ).map((command) => command.keys);
    // The second blink is terminal frame 4, copied from terminal frame 2.
    expect(keys[2]).toBe("a=f,f=32,s=1,v=1,x=0,y=0,c=2,X=1,z=500,i=7,q=2");
  });

  test("replaces rather than blends, so a cleared pixel clears", () => {
    for (const command of animationCommands(
      7,
      [rest, blink],
      [
        { frame: 0, gapMs: 1 },
        { frame: 1, gapMs: 1 },
      ],
    )) {
      if (command.keys.startsWith("a=f")) expect(command.keys).toContain("X=1");
    }
  });
});

describe("sendCommands", () => {
  test("writes every command in order and reports what the PTY carried", async () => {
    const written: string[] = [];
    const commands = [
      transmitCommand(7, frame(2, 5)),
      virtualPlacementCommand(7, 4, 2),
      deleteImageCommand(7),
    ];
    const bytes = await sendCommands(commands, {
      // SSH: the terminal cannot read our disk, so nothing may go by file.
      env: { SSH_CONNECTION: "1" },
      write: (text) => written.push(text),
    });
    expect(written).toEqual(commands.map((command) => encodeCommand(command)));
    expect(bytes).toBe(written.join("").length);
  });
});
