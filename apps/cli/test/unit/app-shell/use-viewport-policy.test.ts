import { describe, expect, test } from "bun:test";

import { shouldSettleViewportImmediately } from "@/app-shell/use-viewport-policy";

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
