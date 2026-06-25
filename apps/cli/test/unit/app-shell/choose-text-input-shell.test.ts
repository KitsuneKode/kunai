import { expect, test } from "bun:test";

import { normalizeTextInputValue } from "@/app-shell/pickers/choose-text-input-shell";

test("normalizeTextInputValue trims and rejects empty workflow input", () => {
  expect(normalizeTextInputValue("  Weekend picks  ")).toBe("Weekend picks");
  expect(normalizeTextInputValue("")).toBeNull();
  expect(normalizeTextInputValue("   ")).toBeNull();
});
