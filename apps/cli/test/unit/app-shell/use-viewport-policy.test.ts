import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import {
  shouldSettleViewportImmediately,
  subscribeStdoutResize,
} from "@/app-shell/use-viewport-policy";

class FakeStdout extends EventEmitter {
  columns = 80;
  rows = 24;
}

describe("subscribeStdoutResize", () => {
  test("N subscribers share a single stdout resize listener", () => {
    const stdout = new FakeStdout();
    const unsubs = Array.from({ length: 15 }, () => subscribeStdoutResize(stdout, () => {}));
    expect(stdout.listenerCount("resize")).toBe(1);
    for (const unsub of unsubs) unsub();
    expect(stdout.listenerCount("resize")).toBe(0);
  });

  test("subscribers fire on a real dimension change and skip no-op resizes", () => {
    const stdout = new FakeStdout();
    const seen: string[] = [];
    subscribeStdoutResize(stdout, (next) => seen.push(`${next.cols}x${next.rows}`));

    stdout.emit("resize"); // same size — no fan-out
    expect(seen).toEqual([]);

    stdout.columns = 132;
    stdout.emit("resize");
    expect(seen).toEqual(["132x24"]);

    stdout.emit("resize"); // unchanged again
    expect(seen).toEqual(["132x24"]);
  });

  test("a detached subscriber is not called", () => {
    const stdout = new FakeStdout();
    const seen: string[] = [];
    const unsub = subscribeStdoutResize(stdout, (next) => seen.push(`${next.cols}`));
    unsub();
    stdout.columns = 200;
    stdout.emit("resize");
    expect(seen).toEqual([]);
    expect(stdout.listenerCount("resize")).toBe(0);
  });

  test("degenerate reports fall back to sane dimensions", () => {
    const stdout = new FakeStdout();
    const seen: string[] = [];
    subscribeStdoutResize(stdout, (next) => seen.push(`${next.cols}x${next.rows}`));
    stdout.columns = 140;
    stdout.emit("resize");
    stdout.columns = 0;
    stdout.rows = Number.NaN;
    stdout.emit("resize");
    expect(seen).toEqual(["140x24", "80x24"]);
  });
});

describe("shouldSettleViewportImmediately", () => {
  test("settles immediately when columns shrink", () => {
    expect(shouldSettleViewportImmediately({ cols: 140, rows: 40 }, { cols: 80, rows: 40 })).toBe(
      true,
    );
  });

  test("settles immediately when rows shrink", () => {
    expect(shouldSettleViewportImmediately({ cols: 120, rows: 40 }, { cols: 120, rows: 24 })).toBe(
      true,
    );
  });

  test("settles immediately when both dimensions shrink", () => {
    expect(shouldSettleViewportImmediately({ cols: 140, rows: 45 }, { cols: 72, rows: 24 })).toBe(
      true,
    );
  });

  test("does not settle immediately on grow-only resize", () => {
    expect(shouldSettleViewportImmediately({ cols: 80, rows: 24 }, { cols: 140, rows: 45 })).toBe(
      false,
    );
  });

  test("does not settle immediately when only rows grow", () => {
    expect(shouldSettleViewportImmediately({ cols: 100, rows: 24 }, { cols: 100, rows: 40 })).toBe(
      false,
    );
  });

  test("settles immediately when one axis shrinks and the other grows", () => {
    expect(shouldSettleViewportImmediately({ cols: 140, rows: 24 }, { cols: 100, rows: 40 })).toBe(
      true,
    );
  });
});
