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
    registerKittyPlacement("postplay-discovery-0", 20);

    releaseKittySlot("postplay-hero");

    expect(deleted).toEqual([10]);
    expect(getKittyPlacement("postplay-hero")).toBeUndefined();
    expect(getKittyPlacement("postplay-discovery-0")).toBe(20);
    expect(listKittyPlacementSlots()).toEqual(["postplay-discovery-0"]);
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
