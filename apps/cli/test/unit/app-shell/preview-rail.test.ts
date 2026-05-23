import { describe, expect, test } from "bun:test";

import {
  getPreviewPosterLabel,
  shouldRenderPreviewRail,
  visiblePreviewFacts,
} from "@/app-shell/primitives/PreviewRail";

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

  test("collapses rail before list on narrow terminals", () => {
    expect(shouldRenderPreviewRail({ columns: 100, hasModel: true })).toBe(false);
    expect(shouldRenderPreviewRail({ columns: 132, hasModel: true })).toBe(true);
  });
});
