import { describe, expect, test } from "bun:test";

import { shouldRenderVerdictRow } from "@/app-shell/diagnostics-panel-lines";

describe("verdict deduplication", () => {
  test("hides the verdict when one health row already says the same thing", () => {
    expect(
      shouldRenderVerdictRow("Could not connect to Discord IPC", [
        "Could not connect to Discord IPC",
      ]),
    ).toBe(false);
  });

  test("shows the verdict when it summarises more than one subsystem", () => {
    expect(
      shouldRenderVerdictRow("Could not connect · 35 with errors", [
        "Could not connect",
        "35 with errors",
      ]),
    ).toBe(true);
  });

  test("shows the verdict when no health row covers it", () => {
    expect(shouldRenderVerdictRow("Slow startup", ["Cache is fine"])).toBe(true);
  });

  test("an empty health row detail never counts as covering the verdict", () => {
    // `"anything".includes("")` is true, which would silently hide every
    // verdict the moment one row had no detail.
    expect(shouldRenderVerdictRow("Slow startup", ["", ""])).toBe(true);
  });

  test("an empty verdict is not worth a row", () => {
    expect(shouldRenderVerdictRow("", ["Could not connect"])).toBe(false);
  });

  test("no health rows means the verdict is the only thing to show", () => {
    expect(shouldRenderVerdictRow("Slow startup", [])).toBe(true);
  });
});
