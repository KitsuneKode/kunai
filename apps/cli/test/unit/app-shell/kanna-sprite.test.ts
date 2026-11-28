import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { companionMotion } from "@/app-shell/companion-assets";
import {
  __testing,
  acquireKannaSprite,
  holdKannaSprites,
  kannaEpoch,
  kannaSlot,
  kannaSpriteAvailable,
  releaseAllKannaSprites,
} from "@/app-shell/kanna-sprite";
import { deleteAllTerminalImages } from "@/app-shell/poster-renderer";
import { setTerminalCellPixels } from "@/image/cell-size";
import { __testing as transportTesting, uploadKittyPayload } from "@/image/kitty-transport";

const ESC = "\x1b";
const { runtime } = __testing;
const original = { ...runtime };
let written: string[] = [];

/** Every graphics command written so far, as its control keys. */
function commands(): string[] {
  return written
    .join("")
    .split(`${ESC}\\`)
    .filter((chunk) => chunk.startsWith(`${ESC}_G`))
    .map((chunk) => chunk.slice(3, chunk.indexOf(";")));
}

const count = (prefix: string) => commands().filter((keys) => keys.startsWith(prefix)).length;
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const ticks = async (microtasks: number) => {
  for (let index = 0; index < microtasks; index++) await tick();
};

beforeEach(() => {
  written = [];
  runtime.write = (text) => void written.push(text);
  // A direct session on a terminal that draws placeholders, reached over SSH:
  // nothing is wrapped for tmux and nothing may be handed over as a temp file.
  runtime.passthrough = () => null;
  runtime.env = () => ({ SSH_CONNECTION: "1" });
  setTerminalCellPixels({ width: 10, height: 20 });
  __testing.reset();
});

afterEach(() => {
  Object.assign(runtime, original);
  setTerminalCellPixels(null);
  __testing.reset();
});

describe("the slot", () => {
  test("is sized from the measured cell so the image is drawn one pixel to one", () => {
    setTerminalCellPixels({ width: 10, height: 22 });
    // Four rows are 88px tall; nine columns is the fewest that are as wide.
    expect(kannaSlot(4)).toEqual({ rows: 4, cols: 9, pixels: 88 });
  });

  test("falls back to the usual 1:2 cell when nothing was measured", () => {
    setTerminalCellPixels(null);
    expect(kannaSlot(4)).toEqual({ rows: 4, cols: 8, pixels: 80 });
  });

  test("a terminal without placeholder support hosts no sprite", () => {
    runtime.passthrough = () => undefined;
    expect(kannaSpriteAvailable()).toBe(false);
  });
});

describe("upload", () => {
  test("transmits once, places virtually, then hands the loop to the terminal", async () => {
    const release = holdKannaSprites();
    const sprite = await acquireKannaSprite("idle", kannaSlot(4), true);
    release();

    expect(sprite).not.toBeNull();
    const keys = commands();
    expect(keys[0]).toMatch(/^a=t,f=32,s=80,v=80,i=\d+,q=2,o=z,t=d,m=[01]$/u);
    expect(count(`a=p,U=1,i=${sprite?.imageId},c=8,r=4,q=2`)).toBe(1);
    // One terminal frame per beat after the first, then the two `a=a` edits.
    expect(count("a=f,")).toBe(companionMotion("idle").loop.length - 1);
    expect(keys).toContain(`a=a,i=${sprite?.imageId},s=3,v=1,q=2`);
    expect(sprite?.animated).toBe(true);
    // Nothing is displayed by the transmit itself: placement is the cells' job.
    expect(count("a=T")).toBe(0);
  });

  test("the cells it hands Ink name that image", async () => {
    const release = holdKannaSprites();
    const sprite = await acquireKannaSprite("peek", kannaSlot(3), true);
    release();
    const id = sprite?.imageId ?? 0;
    const lines = sprite?.placeholder.split("\n") ?? [];
    expect(lines).toHaveLength(3);
    // The image id travels as the foreground colour of the placeholder cells.
    expect(lines[0]).toStartWith(
      `${ESC}[38;2;${(id >> 16) & 255};${(id >> 8) & 255};${id & 255}m\u{10EEEE}`,
    );
    expect([...(lines[0] ?? "")].filter((char) => char === "\u{10EEEE}")).toHaveLength(6);
  });

  test("a second request for the same pose touches the terminal not at all", async () => {
    const release = holdKannaSprites();
    const first = await acquireKannaSprite("seek", kannaSlot(4), true);
    const sent = written.length;
    const second = await acquireKannaSprite("seek", kannaSlot(4), true);
    release();
    expect(second).toBe(first);
    expect(written.length).toBe(sent);
  });

  test("reduced motion uploads one drawing and no frames", async () => {
    const release = holdKannaSprites();
    const sprite = await acquireKannaSprite("idle", kannaSlot(4), false);
    release();
    expect(count("a=t,")).toBe(1);
    expect(count("a=p,U=1")).toBe(1);
    expect(count("a=f,")).toBe(0);
    expect(count("a=a,")).toBe(0);
    expect(sprite?.animated).toBe(false);
  });

  test("under tmux every command is wrapped for passthrough", async () => {
    runtime.passthrough = () => "tmux";
    const release = holdKannaSprites();
    await acquireKannaSprite("nap", kannaSlot(4), false);
    release();
    for (const chunk of written) expect(chunk).toStartWith(`${ESC}Ptmux;${ESC}${ESC}_G`);
  });
});

describe("lifetime", () => {
  test("the last surface to let go deletes every image by id", async () => {
    const release = holdKannaSprites();
    const seek = await acquireKannaSprite("seek", kannaSlot(4), true);
    const oops = await acquireKannaSprite("oops", kannaSlot(4), true);
    expect(count("a=d,")).toBe(0);

    release();
    await ticks(4);
    expect(commands()).toContain(`a=d,d=I,i=${seek?.imageId},q=2`);
    expect(commands()).toContain(`a=d,d=I,i=${oops?.imageId},q=2`);
    expect(__testing.sprites.size).toBe(0);
  });

  test("a pose change on one surface keeps what is already uploaded", async () => {
    // A pose change is an unmount followed at once by a mount. Deleting between
    // the two would throw away the upload the next line is about to reuse.
    const first = holdKannaSprites();
    await acquireKannaSprite("seek", kannaSlot(4), true);
    first();
    const second = holdKannaSprites();
    await tick();
    expect(count("a=d,")).toBe(0);
    second();
    await tick();
    expect(count("a=d,")).toBe(1);
  });

  test("an upload that finishes after everyone left is not left behind", async () => {
    const release = holdKannaSprites();
    const pending = acquireKannaSprite("watch", kannaSlot(4), true);
    release();
    expect(await pending).toBeNull();
    expect(count("a=t,")).toBe(1);
    expect(count("a=d,")).toBe(1);
    expect(__testing.sprites.size).toBe(0);
  });

  test("a global wipe forgets every id and tells mounted surfaces to re-acquire", async () => {
    const release = holdKannaSprites();
    const sprite = await acquireKannaSprite("go", kannaSlot(4), true);
    const before = kannaEpoch();
    deleteAllTerminalImages();
    expect(kannaEpoch()).toBe(before + 1);
    await ticks(2);
    // Deleted by name as well: whether `d=A` reaches a virtual placement is the
    // terminal's call, and deleting a dead id is free.
    expect(commands()).toContain(`a=d,d=I,i=${sprite?.imageId},q=2`);
    expect(__testing.sprites.size).toBe(0);
    release();
  });

  test("a wipe that lands mid-upload is recovered from, not handed on", async () => {
    // The wipe took the image the upload was building. Whoever is waiting still
    // wants her: they get a live id, the dead one is deleted by name, and there
    // is exactly one upload in the end — never two racing for one surface.
    const release = holdKannaSprites();
    let wiped = false;
    const write = runtime.write;
    runtime.write = (text) => {
      write(text);
      if (!wiped && text.includes("a=a,") && text.includes("s=3")) {
        wiped = true;
        deleteAllTerminalImages();
      }
    };
    const sprite = await acquireKannaSprite("seek", kannaSlot(4), true);
    const transmits = commands().filter((keys) => keys.startsWith("a=t,"));
    expect(transmits).toHaveLength(2);
    const dead = /i=(\d+)/u.exec(transmits[0] ?? "")?.[1];
    expect(Number(dead)).not.toBe(sprite?.imageId);
    expect(commands()).toContain(`a=d,d=I,i=${dead},q=2`);
    expect(commands()).not.toContain(`a=d,d=I,i=${sprite?.imageId},q=2`);
    expect(__testing.sprites.size).toBe(1);
    release();
  });

  test("a wipe queued before the upload continuation never leaves a dead sprite cached", async () => {
    const release = holdKannaSprites();
    let queued = false;
    const write = runtime.write;
    runtime.write = (text) => {
      write(text);
      if (!queued && text.includes("a=a,") && text.includes("s=3")) {
        queued = true;
        queueMicrotask(() => deleteAllTerminalImages());
      }
    };

    const sprite = await acquireKannaSprite("seek", kannaSlot(4), true);
    const transmits = commands().filter((keys) => keys.startsWith("a=t,"));
    expect(sprite).not.toBeNull();
    expect(transmits).toHaveLength(2);
    const dead = /i=(\d+)/u.exec(transmits[0] ?? "")?.[1];
    expect(Number(dead)).not.toBe(sprite?.imageId);
    expect(__testing.sprites.size).toBe(1);
    release();
  });

  test("runtime deletion queues behind an interrupted chunked poster upload", async () => {
    const release = holdKannaSprites();
    const sprite = await acquireKannaSprite("wait", kannaSlot(4), false);
    expect(sprite).not.toBeNull();

    const noisy = new Uint8Array(128 * 128 * 4);
    let seed = 0x2545f491;
    for (let at = 0; at < noisy.length; at++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      noisy[at] = seed & 0xff;
    }
    const originalTransportWrite = transportTesting.runtime.write;
    const originalYield = transportTesting.runtime.yieldToEventLoop;
    transportTesting.runtime.write = runtime.write;
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    transportTesting.runtime.yieldToEventLoop = () => gate;
    try {
      const upload = uploadKittyPayload(
        { kind: "rgba", data: noisy, width: 128, height: 128 },
        { env: { SSH_CONNECTION: "1" }, yieldEveryChunks: 2 },
      );
      await tick();
      await tick();
      expect(written.join("")).toContain("m=1;");
      expect(commands().some((keys) => keys.startsWith("a=d,"))).toBe(false);

      release();
      await tick();
      // The upload is still mid-chunk. Kitty forbids any other graphics command
      // here, so her delete must wait for the stream rather than splice into it.
      expect(commands().some((keys) => keys.startsWith("a=d,"))).toBe(false);

      openGate();
      await upload;
      await tick();
      const all = written.join("");
      expect(all.indexOf("m=0;")).toBeLessThan(all.indexOf(`a=d,d=I,i=${sprite?.imageId},q=2`));
    } finally {
      transportTesting.runtime.write = originalTransportWrite;
      transportTesting.runtime.yieldToEventLoop = originalYield;
    }
  });

  test("two surfaces asking at once share one upload", async () => {
    const first = holdKannaSprites();
    const second = holdKannaSprites();
    const [a, b] = await Promise.all([
      acquireKannaSprite("idle", kannaSlot(4), true),
      acquireKannaSprite("idle", kannaSlot(4), true),
    ]);
    expect(a).toBe(b);
    expect(count("a=t,")).toBe(1);
    first();
    second();
  });

  test("exit deletes whatever is still held, synchronously", async () => {
    const release = holdKannaSprites();
    const sprite = await acquireKannaSprite("wait", kannaSlot(4), true);
    releaseAllKannaSprites({ synchronous: true });
    expect(commands().at(-1)).toBe(`a=d,d=I,i=${sprite?.imageId},q=2`);
    release();
  });
});
