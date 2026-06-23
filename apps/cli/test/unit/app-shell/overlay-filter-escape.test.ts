import { describe, expect, test } from "bun:test";

import { resolveOverlayFilterEscape } from "@/app-shell/overlay-filter-escape";

describe("resolveOverlayFilterEscape", () => {
  test("first Esc clears a non-empty filter", () => {
    expect(resolveOverlayFilterEscape("dun")).toBe("clear-filter");
    expect(resolveOverlayFilterEscape(" ")).toBe("clear-filter");
  });

  test("Esc on an empty filter closes the overlay", () => {
    expect(resolveOverlayFilterEscape("")).toBe("close");
  });
});
