import { describe, expect, test } from "bun:test";

import { buildPreviewRailModelFromBrowseOption } from "@/app-shell/browse-preview-rail";
import { measureColumns } from "@/app-shell/shell-text";

describe("buildPreviewRailModelFromBrowseOption", () => {
  test("truncates a wide-column hint the .length gate used to wave through", () => {
    // 15 CJK chars: 15 code units (under the old 28-char gate) but 30 columns —
    // wide text rendered past its cell budget until the gate counted columns.
    const note = "キ" + "ー".repeat(14) + "ノート";
    const model = buildPreviewRailModelFromBrowseOption(
      { value: 1, label: "Title", previewNote: note },
      "none",
    );

    const fact = model?.facts.find((f) => f.label === "Hint");
    expect(fact).toBeDefined();
    expect(measureColumns(fact?.value ?? "")).toBeLessThanOrEqual(26);
    expect(fact?.value.endsWith("…")).toBe(true);
  });

  test("truncates a wide-column badge the same way", () => {
    const badge = "地" + "方".repeat(14) + "バッジ";
    const model = buildPreviewRailModelFromBrowseOption(
      { value: 1, label: "Title", previewBadge: badge },
      "none",
    );

    const fact = model?.facts.find((f) => f.label === "Status");
    expect(fact).toBeDefined();
    expect(measureColumns(fact?.value ?? "")).toBeLessThanOrEqual(26);
    expect(fact?.value.endsWith("…")).toBe(true);
  });
});
