import { describe, expect, test } from "bun:test";

import {
  clearInteractiveShellMounted,
  isInteractiveShellMounted,
  markInteractiveShellMounted,
} from "@/app-shell/interactive-shell-state";

describe("interactive-shell-state", () => {
  test("tracks whether the persistent Ink shell owns the terminal", () => {
    clearInteractiveShellMounted();
    expect(isInteractiveShellMounted()).toBe(false);

    markInteractiveShellMounted();
    expect(isInteractiveShellMounted()).toBe(true);

    clearInteractiveShellMounted();
    expect(isInteractiveShellMounted()).toBe(false);
  });
});
