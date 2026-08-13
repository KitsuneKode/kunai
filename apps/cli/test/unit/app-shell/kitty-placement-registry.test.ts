import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  __testing as registryTesting,
  clearKittyPlacementRegistry,
  getKittyPlacement,
  listKittyPlacementSlots,
  registerKittyPlacement,
  releaseKittyImageId,
  releaseKittySlot,
  setKittyPlacementDeleteFn,
} from "@/app-shell/kitty-placement-registry";

beforeEach(() => {
  registryTesting.reset();
});

afterEach(() => {
  registryTesting.reset();
});

describe("kitty placement registry", () => {
  test("releasing slot A does not delete slot B", () => {
    const deleted: number[] = [];
    setKittyPlacementDeleteFn((id) => {
      deleted.push(id);
    });

    registerKittyPlacement("postplay-hero", 10);
    registerKittyPlacement("postplay-prev", 15);
    registerKittyPlacement("postplay-next", 16);
    registerKittyPlacement("postplay-discovery-0", 20);

    releaseKittySlot("postplay-hero");

    expect(deleted).toEqual([10]);
    expect(getKittyPlacement("postplay-hero")).toBeUndefined();
    expect(getKittyPlacement("postplay-prev")).toBe(15);
    expect(getKittyPlacement("postplay-next")).toBe(16);
    expect(getKittyPlacement("postplay-discovery-0")).toBe(20);
    expect(listKittyPlacementSlots()).toEqual([
      "postplay-prev",
      "postplay-next",
      "postplay-discovery-0",
    ]);
  });

  test("registering a new imageId for a slot deletes the previous one", () => {
    const deleted: number[] = [];
    setKittyPlacementDeleteFn((id) => {
      deleted.push(id);
    });

    registerKittyPlacement("browse-preview", 1);
    registerKittyPlacement("browse-preview", 2);

    expect(deleted).toEqual([1]);
    expect(getKittyPlacement("browse-preview")).toBe(2);
  });

  /**
   * The download manager rail is a sibling of the browse preview, not a
   * replacement for it. Replacing or releasing one slot must never evict the
   * other, or navigating between surfaces orphans a live on-screen image.
   */
  test("the download-manager rail owns a slot independent of browse-preview", () => {
    const deleted: number[] = [];
    setKittyPlacementDeleteFn((id) => {
      deleted.push(id);
    });

    registerKittyPlacement("browse-preview", 11);
    registerKittyPlacement("download-manager-preview", 12);
    expect(deleted).toEqual([]);

    registerKittyPlacement("download-manager-preview", 13);
    expect(deleted).toEqual([12]);
    expect(getKittyPlacement("browse-preview")).toBe(11);

    releaseKittyImageId(13);
    expect(getKittyPlacement("download-manager-preview")).toBeUndefined();
    expect(getKittyPlacement("browse-preview")).toBe(11);
  });

  test("releaseKittyImageId clears the owning slot", () => {
    const deleted: number[] = [];
    setKittyPlacementDeleteFn((id) => {
      deleted.push(id);
    });

    registerKittyPlacement("postplay-rail", 42);
    releaseKittyImageId(42);

    expect(deleted).toEqual([42]);
    expect(getKittyPlacement("postplay-rail")).toBeUndefined();
  });

  test("clearKittyPlacementRegistry drops bookkeeping without calling delete", () => {
    const deleted: number[] = [];
    setKittyPlacementDeleteFn((id) => {
      deleted.push(id);
    });

    registerKittyPlacement("postplay-hero", 7);
    clearKittyPlacementRegistry();

    expect(deleted).toEqual([]);
    expect(listKittyPlacementSlots()).toEqual([]);
  });
});
