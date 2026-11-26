import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { startMouseSession } from "@/app-shell/mouse/mouse-session";
import { MOUSE_TRACKING_DISABLE, MOUSE_TRACKING_ENABLE } from "@/app-shell/mouse/terminal-mouse";
import { getTerminalCellPixels } from "@/image/cell-size";

function harness() {
  const input: string[] = [];
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    read: () => input.shift() ?? null,
    setEncoding: () => {},
  });
  const writes: string[] = [];
  const stdout = {
    isTTY: true,
    columns: 80,
    rows: 24,
    write: (data: string) => {
      writes.push(data);
    },
  };
  const host = new EventEmitter();
  return { stdin, stdout, host, writes, input, disabled: false, term: "xterm-256color" };
}

describe("terminal mouse ownership", () => {
  test("consumes pixel replies and re-queries on SIGWINCH with mouse tracking off", async () => {
    const options = harness();
    const session = startMouseSession({ ...options, disabled: true, measureCells: true });
    if (!session) throw new Error("expected a terminal input session");
    try {
      session.stdin.setRawMode(true);
      expect(options.writes).toEqual(["\x1b[16t\x1b[14t"]);
      options.input.push("a\x1b[6;21", ";9t\x1b[4;480;800tb");
      expect(session.stdin.read()).toBe("a");
      expect(session.stdin.read()).toBe("b");
      expect(getTerminalCellPixels()).toEqual({ width: 9, height: 21 });

      options.host.emit("SIGWINCH");
      await Promise.resolve();
      expect(options.writes).toEqual(["\x1b[16t\x1b[14t", "\x1b[16t\x1b[14t"]);
      options.input.push("\x1b[4;432;880t");
      expect(session.stdin.read()).toBeNull();
      expect(getTerminalCellPixels()).toEqual({ width: 11, height: 18 });
    } finally {
      session.dispose();
    }
    expect(options.host.listenerCount("SIGWINCH")).toBe(0);
    expect(getTerminalCellPixels()).toBeNull();
  });

  test.each(["dispose", "exit"] as const)(
    "%s removes tracking, subscriptions, and hit regions",
    (mode) => {
      const options = harness();
      const session = startMouseSession(options);
      if (!session) throw new Error("Expected a mouse session");
      session.dispatcher.register(
        "row",
        { x: 1, y: 1, width: 10, height: 1 },
        { onClick: () => {} },
      );
      expect(options.writes).toEqual([MOUSE_TRACKING_ENABLE]);
      if (mode === "exit") options.host.emit("exit");
      else session.dispose();
      session.dispose();
      expect(options.writes).toEqual([MOUSE_TRACKING_ENABLE, MOUSE_TRACKING_DISABLE]);
      expect(options.stdin.listenerCount("readable")).toBe(0);
      expect(options.host.listenerCount("exit")).toBe(0);
      expect(session.dispatcher.size).toBe(0);
    },
  );

  test.each(["input-pipe", "output-pipe", "opt-out", "dumb"] as const)(
    "%s preserves ordinary terminal input",
    (mode) => {
      const options = harness();
      if (mode === "input-pipe") options.stdin.isTTY = false;
      if (mode === "output-pipe") options.stdout.isTTY = false;
      if (mode === "opt-out") options.disabled = true;
      if (mode === "dumb") options.term = "dumb";
      expect(startMouseSession(options)).toBeNull();
      expect(options.writes).toEqual([]);
      expect(options.stdin.listenerCount("readable")).toBe(0);
      expect(options.host.listenerCount("exit")).toBe(0);
    },
  );
});
