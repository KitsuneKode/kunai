import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const deleteAllKittyImages = mock(() => {});

mock.module("@/app-shell/image-pane", () => ({
  deleteAllKittyImages,
}));

const { clearShellScreenArtifacts, clearRootContentTransitionFrame } =
  await import("@/app-shell/shell-screen-clear");

const SHELL_SCREEN_CLEAR_SRC = join(
  import.meta.dir,
  "../../../src/app-shell/shell-screen-clear.ts",
);

function sourceWithoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("shell-screen-clear", () => {
  const originalStdoutIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    deleteAllKittyImages.mockClear();
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTTY,
      configurable: true,
    });
  });

  test("clearRootContentTransitionFrame matches artifact-only cleanup (no full ANSI clear)", () => {
    // Both helpers must share the same policy: Kitty/Ghostty image cleanup only.
    // A full-frame \\x1b[2J clear caused blank flashes between mounted sessions.
    expect(clearRootContentTransitionFrame).not.toBe(clearShellScreenArtifacts);
    expect(typeof clearRootContentTransitionFrame).toBe("function");
    expect(typeof clearShellScreenArtifacts).toBe("function");
  });

  test("clearRootContentTransitionFrame source does not emit full ANSI clear", () => {
    const src = readFileSync(SHELL_SCREEN_CLEAR_SRC, "utf8");
    // Policy comment may mention \\x1b[2J — assert the executable body never writes it.
    const withoutComments = sourceWithoutComments(src);
    // Source may only mention the clear sequence in comments; executable text
    // must not contain the escape literal or a raw ESC+[2J write.
    expect(withoutComments.includes("\\x1b[2J")).toBe(false);
    expect(withoutComments.includes(`${String.fromCharCode(0x1b)}[2J`)).toBe(false);
    expect(withoutComments).toMatch(
      /export function clearRootContentTransitionFrame\(\): void \{\s*clearShellScreenArtifacts\(\);\s*\}/,
    );
  });

  test("clearRootContentTransitionFrame invokes the same Kitty cleanup path as artifacts", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });

    clearShellScreenArtifacts();
    expect(deleteAllKittyImages).toHaveBeenCalledTimes(1);

    clearRootContentTransitionFrame();
    expect(deleteAllKittyImages).toHaveBeenCalledTimes(2);
  });

  test("clear helpers skip Kitty cleanup when stdout is not a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });

    clearShellScreenArtifacts();
    clearRootContentTransitionFrame();
    expect(deleteAllKittyImages).not.toHaveBeenCalled();
  });
});
