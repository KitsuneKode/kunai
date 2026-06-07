import { describe, expect, test } from "bun:test";

import { formatPickerOptionRow } from "@/app-shell/overlay-picker-row.model";

describe("formatPickerOptionRow", () => {
  test("concatenates label and detail for string output", () => {
    const result = formatPickerOptionRow({
      label: "HiAnime",
      detail: "Anime provider",
      width: 40,
    });
    expect(result.text).toContain("HiAnime");
    expect(result.text).toContain("Anime provider");
  });

  test("truncates when content exceeds width", () => {
    const result = formatPickerOptionRow({
      label: "A very long provider name that exceeds",
      detail: "long detail",
      width: 20,
    });
    expect(result.text.length).toBeLessThanOrEqual(20);
  });

  test("badge is kept separate from text", () => {
    const result = formatPickerOptionRow({
      label: "HiAnime",
      badge: "✓",
      width: 40,
    });
    expect(result.badgeSuffix).toBe("  ✓");
  });
});
