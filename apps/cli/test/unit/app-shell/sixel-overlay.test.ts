import { afterEach, describe, expect, test } from "bun:test";

import { __testing as overlayTesting, SixelOverlayManager } from "@/app-shell/sixel-overlay";

const originalIsWindows = overlayTesting.runtime.isWindows;
const originalWrite = overlayTesting.runtime.write;
const originalSettleConPty = overlayTesting.runtime.settleConPty;

afterEach(() => {
  overlayTesting.runtime.isWindows = originalIsWindows;
  overlayTesting.runtime.write = originalWrite;
  overlayTesting.runtime.settleConPty = originalSettleConPty;
});

describe("sixel overlay placement", () => {
  test("converts Ink's zero-based rectangle to an ANSI absolute move", () => {
    expect(overlayTesting.moveTo({ x: 17, y: 8 })).toBe("\x1b[9;18H");
  });

  test("recognises only an identical rectangle as reusable", () => {
    const rect = { x: 1, y: 2, width: 3, height: 4 };
    expect(overlayTesting.sameRect(rect, { ...rect })).toBe(true);
    expect(overlayTesting.sameRect(rect, { ...rect, y: 3 })).toBe(false);
  });

  test("does not repaint an unchanged registration", async () => {
    const writes: string[] = [];
    overlayTesting.runtime.isWindows = () => false;
    overlayTesting.runtime.write = (text) => {
      writes.push(text);
    };
    const manager = new SixelOverlayManager();
    const overlay = { rect: { x: 1, y: 2, width: 3, height: 4 }, sixel: "pixels" };

    manager.register("preview", overlay);
    await Bun.sleep(5);
    manager.register("preview", overlay);
    await Bun.sleep(5);

    expect(writes).toHaveLength(1);
  });

  test("settles the ConPTY cursor without yielding between move and pixels", async () => {
    const writes: string[] = [];
    let settleCalls = 0;
    overlayTesting.runtime.isWindows = () => true;
    overlayTesting.runtime.write = (text) => {
      writes.push(text);
    };
    overlayTesting.runtime.settleConPty = () => {
      settleCalls++;
    };
    const manager = new SixelOverlayManager();
    manager.register("preview", { rect: { x: 1, y: 2, width: 3, height: 4 }, sixel: "pixels" });

    await Bun.sleep(5);

    expect(settleCalls).toBe(1);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toContain("pixels");
  });
});
