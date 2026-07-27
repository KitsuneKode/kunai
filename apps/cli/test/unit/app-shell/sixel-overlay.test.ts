import { afterEach, describe, expect, test } from "bun:test";

import { suppressPosterWhileNavigating } from "@/app-shell/poster-types";
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
  test("suppresses sixel while navigating but leaves Kitty placement-owned", () => {
    expect(
      suppressPosterWhileNavigating({
        kind: "sixel",
        sixel: "pixels",
        rows: 4,
        cols: 8,
        overlayId: "browse-preview",
      }),
    ).toBe(true);
    expect(
      suppressPosterWhileNavigating({
        kind: "kitty",
        placeholder: "placeholder",
        rows: 4,
        cols: 8,
        imageId: 1,
      }),
    ).toBe(false);
  });

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

  test("repaints a collision-sensitive overlay after an Ink frame", async () => {
    const writes: string[] = [];
    overlayTesting.runtime.isWindows = () => false;
    overlayTesting.runtime.write = (text) => {
      writes.push(text);
    };
    const manager = new SixelOverlayManager();
    const overlay = { rect: { x: 1, y: 2, width: 3, height: 4 }, sixel: "pixels" };

    manager.register("playing-rail", overlay);
    await Bun.sleep(5);
    manager.afterInkRender();
    await Bun.sleep(5);

    expect(writes).toHaveLength(2);
  });

  test("does not repaint a high-frequency overlay after unrelated Ink frames", async () => {
    const writes: string[] = [];
    overlayTesting.runtime.isWindows = () => false;
    overlayTesting.runtime.write = (text) => {
      writes.push(text);
    };
    const manager = new SixelOverlayManager();
    const overlay = {
      rect: { x: 1, y: 2, width: 3, height: 4 },
      sixel: "pixels",
      repaintAfterInkRender: false,
    };

    manager.register("playing-rail", overlay);
    await Bun.sleep(5);
    manager.afterInkRender();
    await Bun.sleep(5);

    expect(writes).toHaveLength(1);
  });

  test("repaints an unchanged slot when its owning Ink pane commits", async () => {
    const writes: string[] = [];
    overlayTesting.runtime.isWindows = () => false;
    overlayTesting.runtime.write = (text) => {
      writes.push(text);
    };
    const manager = new SixelOverlayManager();
    const overlay = { rect: { x: 1, y: 2, width: 3, height: 4 }, sixel: "pixels" };

    manager.commit("playing-rail", overlay);
    await Bun.sleep(5);
    writes.length = 0;
    manager.commit("playing-rail", overlay);
    await Bun.sleep(5);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("pixels");
    expect(writes[0]).not.toContain("   ");
  });

  test("clears a changed image before repainting the same slot without releasing the cursor", async () => {
    const writes: string[] = [];
    overlayTesting.runtime.isWindows = () => false;
    overlayTesting.runtime.write = (text) => {
      writes.push(text);
    };
    const manager = new SixelOverlayManager();
    const rect = { x: 1, y: 2, width: 3, height: 2 };

    manager.register("preview", { rect, sixel: "old-pixels" });
    await Bun.sleep(5);
    writes.length = 0;
    manager.register("preview", { rect, sixel: "new-pixels" });
    await Bun.sleep(5);

    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain("old-pixels");
    expect(writes[0]).toContain("   ");
    expect(writes[0]).toContain("\x1b[4;2H");
    expect(writes[0]).toContain("new-pixels");
  });

  test("does not erase through the Ink frame that removed an overlay", async () => {
    const writes: string[] = [];
    overlayTesting.runtime.isWindows = () => false;
    overlayTesting.runtime.write = (text) => {
      writes.push(text);
    };
    const manager = new SixelOverlayManager();
    manager.register("preview", {
      rect: { x: 1, y: 2, width: 3, height: 4 },
      sixel: "pixels",
    });
    await Bun.sleep(5);
    writes.length = 0;

    manager.unregister("preview");
    await Bun.sleep(5);

    expect(writes).toHaveLength(0);
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
