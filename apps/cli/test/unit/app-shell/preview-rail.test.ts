import { describe, expect, test } from "bun:test";

import { getShellViewportPolicy } from "@/app-shell/layout-policy";
import {
  getPreviewPosterLabel,
  PREVIEW_RAIL_MIN_COLUMNS,
  shouldRenderPreviewRail,
  visiblePreviewFacts,
} from "@/app-shell/primitives/PreviewRail.model";

describe("PreviewRail helpers", () => {
  test("reserves poster label for loading and failed states", () => {
    expect(getPreviewPosterLabel({ title: "The Boys", posterState: "loading" })).toBe(
      "loading poster",
    );
    expect(getPreviewPosterLabel({ title: "The Boys", posterState: "failed" })).toBe("TB");
    expect(getPreviewPosterLabel({ title: "The Boys", posterState: "none" })).toBe("TB");
  });

  test("hides empty facts", () => {
    expect(
      visiblePreviewFacts([
        { label: "State", value: "available" },
        { label: "Provider", value: "" },
      ]),
    ).toEqual([{ label: "State", value: "available" }]);
  });

  test("shows the rail from the shared minimum while keeping the list usable", () => {
    expect(shouldRenderPreviewRail({ columns: PREVIEW_RAIL_MIN_COLUMNS - 1, hasModel: true })).toBe(
      false,
    );
    expect(shouldRenderPreviewRail({ columns: 100, hasModel: true })).toBe(true);
    expect(shouldRenderPreviewRail({ columns: 120, hasModel: true })).toBe(true);
    for (const columns of [100, 120]) {
      const viewport = getShellViewportPolicy("browse", columns, 40);
      const innerWidth = Math.max(24, columns - 8);
      const previewWidth =
        viewport.breakpoint === "wide"
          ? Math.max(28, Math.floor(innerWidth * 0.3))
          : Math.max(26, Math.floor(innerWidth * 0.28));
      const listWidth = Math.max(48, innerWidth - previewWidth - 4);
      expect(listWidth).toBeGreaterThanOrEqual(60);
    }
  });
});
