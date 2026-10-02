import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { MouseSplitStdin } from "../../../../src/app-shell/mouse/mouse-stdin";
import { MouseDispatcher } from "../../../../src/app-shell/mouse/MouseRegions";
import type { MouseEvent } from "../../../../src/app-shell/mouse/terminal-mouse";

/** Real-stdin stand-in: queues bytes and signals 'readable' — the paused-mode
 *  contract Ink (and therefore our facade) actually uses on the TTY. */
class FakeSource extends EventEmitter {
  isTTY = true;
  private queue: string[] = [];
  rawModeCalls: boolean[] = [];
  encodings: string[] = [];
  refs = 0;
  unrefs = 0;
  pauses = 0;
  resumes = 0;
  feed(data: string): void {
    this.queue.push(data);
    this.emit("readable");
  }
  read(): string | null {
    return this.queue.shift() ?? null;
  }
  setEncoding(encoding: BufferEncoding): void {
    this.encodings.push(encoding);
  }
  setRawMode(mode: boolean): void {
    this.rawModeCalls.push(mode);
  }
  ref(): void {
    this.refs += 1;
  }
  unref(): void {
    this.unrefs += 1;
  }
  pause(): void {
    this.pauses += 1;
  }
  resume(): void {
    this.resumes += 1;
  }
}

function harness(writes?: string[]): {
  source: FakeSource;
  proxy: MouseSplitStdin;
  dispatcher: MouseDispatcher;
} {
  const source = new FakeSource();
  const dispatcher = new MouseDispatcher();
  const proxy = new MouseSplitStdin(source, dispatcher, {
    write: (data) => writes?.push(data),
  });
  proxy.attach();
  return { source, proxy, dispatcher };
}

function drain(proxy: MouseSplitStdin): string {
  let out = "";
  let chunk: string | null;
  while ((chunk = proxy.read()) !== null) out += chunk;
  return out;
}

describe("MouseSplitStdin", () => {
  test("mouse bytes dispatch to the dispatcher and never reach read()", () => {
    const { source, proxy, dispatcher } = harness();
    const hits: MouseEvent[] = [];
    dispatcher.register(
      "box",
      { x: 1, y: 1, width: 20, height: 10 },
      {
        onClick: (event) => hits.push(event),
      },
    );
    source.feed("\x1b[<0;5;2M\x1b[<0;5;2m");
    expect(drain(proxy)).toBe("");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ x: 5, y: 2 });
  });

  test("keyboard bytes reach read() with 'readable' emitted", () => {
    const { source, proxy } = harness();
    let readable = 0;
    proxy.on("readable", () => {
      readable += 1;
    });
    source.feed("abc");
    expect(readable).toBe(1);
    expect(drain(proxy)).toBe("abc");
  });

  test("a mixed chunk splits in order: mouse dispatched, keys delivered", () => {
    const { source, proxy, dispatcher } = harness();
    const hits: MouseEvent[] = [];
    dispatcher.register(
      "box",
      { x: 1, y: 1, width: 100, height: 50 },
      {
        onWheel: (direction, event) =>
          hits.push({ ...event, button: direction === "up" ? "wheel-up" : "wheel-down" }),
      },
    );
    source.feed("x\x1b[<64;5;5My");
    expect(drain(proxy)).toBe("xy");
    expect(hits).toHaveLength(1);
  });

  test("a sequence split across chunks still parses", () => {
    const { source, proxy, dispatcher } = harness();
    const hits: MouseEvent[] = [];
    dispatcher.register(
      "box",
      { x: 1, y: 1, width: 100, height: 50 },
      {
        onClick: (event) => hits.push(event),
      },
    );
    source.feed("\x1b[<0;7");
    source.feed(";2M\x1b[<0;7;2m");
    expect(drain(proxy)).toBe("");
    expect(hits).toHaveLength(1);
  });

  test("unshift re-queues bytes for the next read()", () => {
    const { proxy } = harness();
    proxy.unshift("leftover");
    expect(proxy.read()).toBe("leftover");
    expect(proxy.read()).toBeNull();
  });

  test("enable/disable tracking writes the ANSI toggles once each", () => {
    const writes: string[] = [];
    const { proxy } = harness(writes);
    proxy.enableTracking();
    proxy.enableTracking();
    proxy.disableTracking();
    proxy.disableTracking();
    expect(writes).toEqual([
      "\x1b[?1000h\x1b[?1002h\x1b[?1006h",
      "\x1b[?1006l\x1b[?1002l\x1b[?1000l",
    ]);
  });

  test("detach() removes the source listener and disables tracking", () => {
    const writes: string[] = [];
    const { source, proxy } = harness(writes);
    proxy.enableTracking();
    proxy.detach();
    expect(source.listenerCount("readable")).toBe(0);
    expect(writes.at(-1)).toBe("\x1b[?1006l\x1b[?1002l\x1b[?1000l");
    // Bytes fed after detach are dropped, not buffered.
    source.feed("z");
    expect(drain(proxy)).toBe("");
  });

  test("wheel over unregistered space falls back to arrow keys for Ink", () => {
    const { source, proxy } = harness();
    source.feed("\x1b[<64;5;5M"); // wheel-up
    source.feed("\x1b[<65;5;5M"); // wheel-down
    expect(drain(proxy)).toBe("\x1b[A\x1b[B");
  });

  test("wheel over a region with onWheel is consumed — no arrow fallback", () => {
    const { source, proxy, dispatcher } = harness();
    const dirs: string[] = [];
    dispatcher.register(
      "list",
      { x: 1, y: 1, width: 100, height: 50 },
      {
        onWheel: (direction) => dirs.push(direction),
      },
    );
    source.feed("\x1b[<65;5;5M");
    expect(drain(proxy)).toBe("");
    expect(dirs).toEqual(["down"]);
  });

  test("wheel over a click-only region still falls back to arrows", () => {
    const { source, proxy, dispatcher } = harness();
    dispatcher.register(
      "row",
      { x: 1, y: 1, width: 100, height: 50 },
      {
        onClick: () => {},
      },
    );
    source.feed("\x1b[<64;5;5M");
    expect(drain(proxy)).toBe("\x1b[A");
  });

  test("TTY surface methods forward to the source", () => {
    const { source, proxy } = harness();
    proxy.setEncoding("utf8");
    proxy.setRawMode(true);
    proxy.ref();
    proxy.unref();
    proxy.pause();
    proxy.resume();
    expect(source.encodings).toEqual(["utf8"]);
    expect(source.rawModeCalls).toEqual([true]);
    expect(source.refs).toBe(1);
    expect(source.unrefs).toBe(1);
    expect(source.pauses).toBe(1);
    expect(source.resumes).toBe(1);
    expect(proxy.isTTY).toBe(true);
  });
});
