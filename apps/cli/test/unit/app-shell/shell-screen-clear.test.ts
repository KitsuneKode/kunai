import { describe, expect, test } from "bun:test";

import { clearRootContentTransitionFrame } from "@/app-shell/shell-screen-clear";

describe("shell-screen-clear", () => {
  test("clearRootContentTransitionFrame is safe when stdout is not a TTY", () => {
    expect(() => clearRootContentTransitionFrame()).not.toThrow();
  });
});
