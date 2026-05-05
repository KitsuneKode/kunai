import { describe, expect, test } from "bun:test";

import { resolvePosterUrl } from "@/app-shell/image-pane";
import { buildChafaArgs } from "@/app-shell/poster-renderer";
import { isKittyCompatible } from "@/image";

describe("poster image helpers", () => {
  test("resolves TMDB poster paths to fetchable image URLs", () => {
    expect(resolvePosterUrl("/poster.jpg")).toBe("https://image.tmdb.org/t/p/w342/poster.jpg");
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

  test("uses a larger TMDB size for wider preview panes", () => {
    expect(resolvePosterUrl("/poster.jpg", { cols: 24 })).toBe(
      "https://image.tmdb.org/t/p/w500/poster.jpg",
    );
  });

  test("uses original TMDB size for detail contexts", () => {
    expect(resolvePosterUrl("/poster.jpg", { cols: 18, variant: "detail" })).toBe(
      "https://image.tmdb.org/t/p/original/poster.jpg",
    );
  });

  test("renders chafa fallback without terminal probing and with high-quality symbols", () => {
    const args = buildChafaArgs("/tmp/poster.jpg", 10, 24);

    expect(args).toContain("--probe=off");
    expect(args).toContain("--polite=on");
    expect(args).toContain("--work=9");
    expect(args).toContain("block+border+braille");
    expect(args).toContain("24x10");
  });
});
