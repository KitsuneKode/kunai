import { describe, expect, test } from "bun:test";

import { PREVIEW_POSTER_ROWS, resolvePreviewPosterGeometry } from "@/app-shell/browse-shell-view";

describe("resolvePreviewPosterGeometry", () => {
  test("returns 20 rows and 27 columns for ultra-tall / 1440p+ viewports (>= 52 rows)", () => {
    const geometry = resolvePreviewPosterGeometry(55, 50);
    expect(geometry.rows).toBe(20);
    // 2:3 aspect ratio: 20 rows * 2 = 40px height, 40 * (2/3) ≈ 27 cols
    expect(geometry.cols).toBe(27);
  });

  test("returns 16 rows and 21 columns for large / fullscreen viewports (>= 42 rows)", () => {
    const geometry = resolvePreviewPosterGeometry(45, 50);
    expect(geometry.rows).toBe(16);
    // 2:3 aspect ratio: 16 rows * 2 = 32px height, 32 * (2/3) ≈ 21 cols
    expect(geometry.cols).toBe(21);
  });

  test("returns 13 rows and 17 columns for medium-tall viewports (34 to 41 rows)", () => {
    const geometry = resolvePreviewPosterGeometry(36, 36);
    expect(geometry.rows).toBe(13);
    // 13 rows * 2 = 26px height, 26 * (2/3) ≈ 17 cols
    expect(geometry.cols).toBe(17);
  });

  test("returns 11 rows and 15 columns for standard desktop viewports (28 to 33 rows)", () => {
    const geometry = resolvePreviewPosterGeometry(30, 32);
    expect(geometry.rows).toBe(11);
    // 11 rows * 2 = 22px height, 22 * (2/3) ≈ 15 cols
    expect(geometry.cols).toBe(15);
  });

  test("falls back to PREVIEW_POSTER_ROWS (9) for compact viewports (< 28 rows)", () => {
    const geometry = resolvePreviewPosterGeometry(24, 28);
    expect(geometry.rows).toBe(PREVIEW_POSTER_ROWS);
    expect(geometry.cols).toBe(14);
  });

  test("clamps columns to available preview rail width minus margin", () => {
    // Even if rows = 16 (natural cols = 21), a narrow previewWidth of 20 clamps to 16
    const geometry = resolvePreviewPosterGeometry(45, 20);
    expect(geometry.rows).toBe(16);
    expect(geometry.cols).toBe(16);
  });

  test("enforces a minimum column width of 14", () => {
    const geometry = resolvePreviewPosterGeometry(20, 12);
    expect(geometry.rows).toBe(9);
    expect(geometry.cols).toBe(14);
  });
});
