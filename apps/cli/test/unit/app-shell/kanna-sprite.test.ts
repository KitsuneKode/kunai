import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { companionMotion } from "@/app-shell/companion-assets";
import {
  __testing,
  acquireKannaSprite,
  holdKannaSprites,
  readyKannaSprite,
  releaseAllKannaSprites,
} from "@/app-shell/kanna-sprite";

// The sprite's whole contract is lifetime: transmit once, place by text,
// delete by id when the last surface lets go and on exit. Every test here reads
// the bytes that reached the terminal, because that is the only place a leaked
// image or a second upload is visible.

const original = { ...__testing.runtime };
const slot = { rows: 4, cols: 9, pixels: 92 } as const;

let writes: string[];
let prepares: number;

/** A decoded strip of `count` flat drawings, each with one pixel of its own. */
function fakeStrip(count: number, edge: number) {
  const width = edge * count;
  const rgba = new Uint8Array(width * edge * 4).fill(40);
  for (let index = 1; index < count; index++) {
    rgba.set([255, 255, 255, 255], (index * edge + index) * 4);
  }
  return { png: new Uint8Array(), image: { width, height: edge, rgba } };
}

beforeEach(() => {
  __testing.reset();
  writes = [];
  prepares = 0;
  __testing.runtime.readFile = async () => new Uint8Array([1]);
  __testing.runtime.prepare = async (_bytes, bounds) => {
    prepares += 1;
    const count = Math.round(bounds.maxWidthPx / bounds.maxHeightPx);
    return fakeStrip(count, bounds.maxHeightPx);
  };
  __testing.runtime.write = (text) => writes.push(text);
  __testing.runtime.passthrough = () => null;
  // Not a local kitty: everything goes through the PTY, where the test sees it.
  __testing.runtime.env = () => ({});
});

afterEach(() => {
  Object.assign(__testing.runtime, original);
  __testing.reset();
});

const graphics = () => writes.join("");
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("kanna sprite", () => {
  test("transmits, places virtually, then hands the terminal the loop", async () => {
    const release = holdKannaSprites();
    const sprite = await acquireKannaSprite("idle", slot, true);
    expect(sprite).not.toBeNull();
    const id = sprite?.imageId;
    const out = graphics();
    expect(out).toContain(`\x1b_Ga=t,f=32,s=92,v=92,i=${id},q=2,o=z,t=d,`);
    expect(out).toContain(`\x1b_Ga=p,U=1,i=${id},c=9,r=4,z=-1,q=2;\x1b\\`);
    expect(out).toContain(`a=f,f=32,`);
    expect(out).toContain(`\x1b_Ga=a,i=${id},s=3,v=1,q=2;\x1b\\`);
    // The cells Ink prints name the same id in their foreground colour.
    expect(sprite?.placeholder).toContain(`\x1b[38;2;0;0;${id}m\u{10EEEE}`);
    expect(sprite?.placeholder.split("\n")).toHaveLength(4);
    release();
  });

  test("transmit once, place as often as needed", async () => {
    const release = holdKannaSprites();
    const first = await acquireKannaSprite("seek", slot, true);
    const sent = writes.length;
    const again = await acquireKannaSprite("seek", slot, true);
    expect(again).toBe(first);
    expect(readyKannaSprite("seek", slot, true)).toBe(first);
    expect(writes.length).toBe(sent);
    release();
  });

  test("the last surface letting go deletes every id it uploaded", async () => {
    const release = holdKannaSprites();
    const seek = await acquireKannaSprite("seek", slot, true);
    const oops = await acquireKannaSprite("oops", slot, true);
    writes = [];
    release();
    await settle();
    expect(graphics()).toBe(
      `\x1b_Ga=d,d=I,i=${seek?.imageId},q=2;\x1b\\\x1b_Ga=d,d=I,i=${oops?.imageId},q=2;\x1b\\`,
    );
    expect(__testing.liveIds()).toEqual([]);
    expect(readyKannaSprite("seek", slot, true)).toBeNull();
  });

  test("a pose swap does not delete what the next mount is about to reuse", async () => {
    // Unmount then mount in the same tick is a pose change, not a goodbye.
    const first = holdKannaSprites();
    await acquireKannaSprite("seek", slot, true);
    first();
    const second = holdKannaSprites();
    await settle();
    expect(graphics()).not.toContain("a=d");
    second();
  });

  test("coming back re-sends the same bytes without decoding or encoding again", async () => {
    const release = holdKannaSprites();
    await acquireKannaSprite("nap", slot, true);
    const firstUpload = graphics();
    release();
    await settle();

    writes = [];
    const back = holdKannaSprites();
    await acquireKannaSprite("nap", slot, true);
    expect(graphics()).toBe(firstUpload);
    expect(prepares).toBe(1);
    back();
  });

  test("reduced motion sends one drawing and no frames", async () => {
    const release = holdKannaSprites();
    const sprite = await acquireKannaSprite("idle", slot, false);
    expect(sprite?.animated).toBe(false);
    expect(graphics()).not.toContain("a=f");
    expect(graphics()).not.toContain("a=a");
    release();
  });

  test("every animated pose has more than one drawing", () => {
    // A strip with one drawing would upload the loop machinery for a still.
    for (const pose of ["idle", "wait", "seek", "go", "watch", "oops", "nap", "peek"] as const) {
      expect(companionMotion(pose).frames, pose).toBeGreaterThan(1);
    }
  });

  test("under tmux every escape is wrapped for passthrough", async () => {
    __testing.runtime.passthrough = () => "tmux";
    const release = holdKannaSprites();
    await acquireKannaSprite("go", slot, true);
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(write.startsWith("\x1bPtmux;")).toBe(true);
    release();
    await settle();
    expect(writes.at(-1)?.startsWith("\x1bPtmux;\x1b\x1b_Ga=d,d=I,i=")).toBe(true);
  });

  test("a terminal without placeholders gets no sprite and no bytes", async () => {
    __testing.runtime.passthrough = () => undefined;
    const release = holdKannaSprites();
    expect(await acquireKannaSprite("idle", slot, true)).toBeNull();
    expect(writes).toEqual([]);
    release();
  });

  test("nothing is uploaded for a surface that is already gone", async () => {
    // Held, then released before the pixels were ready: nobody will print the
    // cells, so nothing may land in the terminal.
    const release = holdKannaSprites();
    const pending = acquireKannaSprite("watch", slot, true);
    release();
    expect(await pending).toBeNull();
    expect(graphics()).not.toContain("a=t");
  });

  test("exit deletes whatever is still up, and is registered for it", async () => {
    const release = holdKannaSprites();
    const sprite = await acquireKannaSprite("peek", slot, true);
    expect(process.listeners("exit")).toContain(releaseAllKannaSprites);
    writes = [];
    releaseAllKannaSprites();
    expect(graphics()).toBe(`\x1b_Ga=d,d=I,i=${sprite?.imageId},q=2;\x1b\\`);
    // A second exit pass has nothing left to delete.
    writes = [];
    releaseAllKannaSprites();
    expect(writes).toEqual([]);
    release();
  });
});
