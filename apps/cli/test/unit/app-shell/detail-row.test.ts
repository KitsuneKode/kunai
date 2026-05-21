import { describe, expect, test } from "bun:test";

import { detailRowColumns } from "@/app-shell/shell-primitives";

describe("detailRowColumns", () => {
  test("pads the label to a fixed column width", () => {
    const c = detailRowColumns("Audio", "JP", 10);
    expect(c.label).toBe("Audio     ");
    expect(c.value).toBe("JP");
  });
  test("truncates an overlong label to the column", () => {
    const c = detailRowColumns("Subtitles long", "EN", 8);
    expect(c.label.length).toBe(8);
  });
});
