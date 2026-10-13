import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { startMouseSession } from "@/app-shell/mouse/mouse-session";
import { MOUSE_TRACKING_DISABLE, MOUSE_TRACKING_ENABLE } from "@/app-shell/mouse/terminal-mouse";

function harness() {
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    read: () => null,
    setEncoding: () => {},
  });
  const writes: string[] = [];
  const stdout = {
    isTTY: true,
    write: (data: string) => {
      writes.push(data);
    },
  };
  const host = new EventEmitter();
  return { stdin, stdout, host, writes, disabled: false, term: "xterm-256color" };
}

describe("terminal mouse ownership", () => {
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
