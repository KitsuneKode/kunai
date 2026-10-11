import { describe, expect, it } from "bun:test";

import { bootSurface } from "./frame-match";

describe("interactive boot readiness", () => {
  it("accepts an offline library without a brand header", () => {
    expect(bootSurface("No offline titles yet\n[Tab] Downloads\nLibrary")).toBe("Library");
  });

  it("accepts the active search surface after typing", () => {
    expect(bootSurface("Search title\n[enter] search\nSearch")).toBe("Search");
  });

  it("accepts a fresh wizard with visible input hints", () => {
    expect(bootSurface("Kunai · welcome  setup 1⁄7\n[enter] continue\nSetup")).toBe("Setup");
  });

  it("rejects brand-only startup output and unrecognized screens", () => {
    expect(bootSurface("Kunai\nloading…")).toBeNull();
    expect(bootSurface("Kunai\n[debug] fatal exception")).toBeNull();
    expect(bootSurface("Library")).toBeNull();
  });
});
