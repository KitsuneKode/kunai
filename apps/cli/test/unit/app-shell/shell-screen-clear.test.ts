import { describe, expect, test } from "bun:test";

import {
  clearShellScreenArtifacts,
  clearRootContentTransitionFrame,
} from "@/app-shell/shell-screen-clear";

describe("shell-screen-clear", () => {
  test("clearRootContentTransitionFrame matches artifact-only cleanup (no full ANSI clear)", () => {
    // Both helpers must share the same policy: Kitty/Ghostty image cleanup only.
    // A full-frame \\x1b[2J clear caused blank flashes between mounted sessions.
    expect(clearRootContentTransitionFrame).not.toBe(clearShellScreenArtifacts);
    expect(typeof clearRootContentTransitionFrame).toBe("function");
    expect(typeof clearShellScreenArtifacts).toBe("function");
  });
});
