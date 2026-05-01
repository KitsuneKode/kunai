import { describe, expect, test } from "bun:test";

import { resolvePosterUrl } from "@/app-shell/image-pane";
import { isKittyCompatible } from "@/image";

describe("poster image helpers", () => {
  test("resolves TMDB poster paths to fetchable image URLs", () => {
    expect(resolvePosterUrl("/poster.jpg")).toBe("https://image.tmdb.org/t/p/original/poster.jpg");
  });

  test("preserves absolute poster URLs", () => {
    expect(resolvePosterUrl("https://cdn.example.test/poster.jpg")).toBe(
      "https://cdn.example.test/poster.jpg",
    );
  });

  test("detects Kitty and Ghostty terminal graphics support", () => {
    expect(isKittyCompatible({ KITTY_WINDOW_ID: "1" })).toBe(true);
    expect(isKittyCompatible({ TERM_PROGRAM: "Ghostty" })).toBe(true);
    expect(isKittyCompatible({ TERM_PROGRAM: "xterm-256color" })).toBe(false);
  });
});
