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

function harness(writes?: string[]) {
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
  test("idle tail release stays after the input and mouse packets preceding it", () => {
    const source = new FakeSource();
    const dispatcher = new MouseDispatcher();
    const order: string[] = [];
    let flush: (() => void) | undefined;
    dispatcher.register(
      "fixture",
      { x: 1, y: 1, width: 10, height: 10 },
      { onWheel: () => order.push("mouse") },
    );
    const proxy = new MouseSplitStdin(source, dispatcher, {
      write: () => {},
      scheduleTailFlush: (task) => {
        flush = task;
        return () => {};
      },
    });
    try {
      source.feed("a\x1b[<64;5;5M\x1b[<0;7");
      order.push(`key:${proxy.read()}`);
      flush?.();
      let input: string | null;
      while ((input = proxy.read()) !== null) order.push(`key:${input}`);
      expect(order).toEqual(["key:a", "mouse", "key:\x1b[<0;7"]);
    } finally {
      proxy.detach();
    }
  });

  test("tail expiry consumes an already buffered continuation before releasing it as keys", () => {
    const source = new FakeSource();
    const dispatcher = new MouseDispatcher();
    const events: MouseEvent[] = [];
    let flush: (() => void) | undefined;
    dispatcher.register(
      "fixture",
      { x: 1, y: 1, width: 10, height: 10 },
      { onClick: (event) => events.push(event) },
    );
    const proxy = new MouseSplitStdin(source, dispatcher, {
      write: () => {},
      scheduleTailFlush: (task) => {
        flush = task;
        return () => {};
      },
    });
    try {
      source.feed("a\x1b[<0;7");
      expect(proxy.read()).toBe("a");
      source.feed(";2M\x1b[<0;7;2m");
      flush?.();
      expect(drain(proxy)).toBe("");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ x: 7, y: 2 });
    } finally {
      proxy.detach();
    }
  });

  function scheduledHarness() {
    const source = new FakeSource();
    let task: (() => void) | undefined;
    let cancelled = 0;
    const proxy = new MouseSplitStdin(source, null, {
      write: () => {},
      scheduleTailFlush: (flush) => {
        task = flush;
        return () => {
          cancelled += 1;
          task = undefined;
        };
      },
    });
    proxy.attach();
    return { source, proxy, flush: () => task?.(), cancellations: () => cancelled };
  }

  test("an abandoned partial report releases held numeric keystrokes on idle", () => {
    const { source, proxy, flush } = scheduledHarness();
    source.feed("\x1b[<0;7");
    expect(drain(proxy)).toBe("");
    source.feed("123;");
    expect(drain(proxy)).toBe("");
    let readable = 0;
    proxy.on("readable", () => {
      readable += 1;
    });
    flush();
    expect(readable).toBe(1);
    expect(drain(proxy)).toBe("\x1b[<0;7123;");
    source.feed("next");
    expect(drain(proxy)).toBe("next");
    proxy.detach();
  });

  test.each(["\x1b", "\x1b["])("ordinary %j keyboard prefixes are released on idle", (prefix) => {
    const { source, proxy, flush } = scheduledHarness();
    source.feed(prefix);
    expect(drain(proxy)).toBe("");
    flush();
    expect(drain(proxy)).toBe(prefix);
    proxy.detach();
  });

  test("an arrow key split after its introducer reaches Ink unchanged", () => {
    const { source, proxy } = scheduledHarness();
    source.feed("\x1b[");
    expect(drain(proxy)).toBe("");
    source.feed("A");
    expect(drain(proxy)).toBe("\x1b[A");
    proxy.detach();
  });

  test("completed and detached partial reports cancel their pending idle task", () => {
    const { source, proxy, flush, cancellations } = scheduledHarness();
    source.feed("\x1b[<0;7");
    drain(proxy);
    source.feed(";2M");
    expect(drain(proxy)).toBe("");
    expect(cancellations()).toBe(1);
    flush();
    expect(drain(proxy)).toBe("");
    source.feed("\x1b[<1;");
    drain(proxy);
    proxy.detach();
    expect(cancellations()).toBe(2);
    flush();
    expect(drain(proxy)).toBe("");
  });

  test("a mouse report split at any byte boundary never becomes a keypress", () => {
    const report = "\x1b[<0;5;2M";
    for (let boundary = 1; boundary < report.length; boundary += 1) {
      const { source, proxy, dispatcher } = harness();
      let clicks = 0;
      dispatcher.register(
        "row",
        { x: 1, y: 1, width: 10, height: 3 },
        {
          onClick: () => {
            clicks += 1;
          },
        },
      );
      source.feed(report.slice(0, boundary));
      expect(drain(proxy)).toBe("");
      source.feed(report.slice(boundary) + "\x1b[<0;5;2m");
      expect(drain(proxy)).toBe("");
      expect(clicks).toBe(1);
      proxy.detach();
    }
  });

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
      "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h",
      "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l",
    ]);
  });

  test("detach() removes the source listener and disables tracking", () => {
    const writes: string[] = [];
    const { source, proxy } = harness(writes);
    proxy.enableTracking();
    proxy.detach();
    expect(source.listenerCount("readable")).toBe(0);
    expect(writes.at(-1)).toBe("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l");
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

test.each(["same chunk", "queued chunks"])(
  "keyboard and mouse are delivered in wire order: %s",
  (mode) => {
    const { source, proxy, dispatcher } = harness();
    let delivered = "";
    dispatcher.register(
      "row",
      { x: 1, y: 1, width: 10, height: 3 },
      {
        onClick: () => {
          delivered += "<click>";
        },
      },
    );
    const report = "\x1b[<0;5;2M\x1b[<0;5;2m";
    if (mode === "same chunk") source.feed("before" + report + "after");
    else {
      source.feed("before");
      source.feed(report);
      source.feed("after");
    }
    let input: string | null;
    while ((input = proxy.read()) !== null) delivered += input;
    expect(delivered).toBe("before<click>after");
    proxy.detach();
  },
);

test("unhandled wheel fallback stays between the surrounding keyboard and mouse input", () => {
  const { source, proxy, dispatcher } = harness();
  let delivered = "";
  dispatcher.register(
    "row",
    { x: 1, y: 1, width: 10, height: 3 },
    {
      onClick: () => {
        delivered += "<click>";
      },
    },
  );
  source.feed("before\x1b[<64;50;50Mafter\x1b[<0;5;2M\x1b[<0;5;2m");
  let input: string | null;
  while ((input = proxy.read()) !== null) delivered += input;
  expect(delivered).toBe("before\x1b[Aafter<click>");
  proxy.detach();
});
