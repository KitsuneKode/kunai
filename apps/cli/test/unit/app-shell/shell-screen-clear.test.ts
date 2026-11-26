import { afterEach, describe, expect, test } from "bun:test";

import { setPlainModePreferenceSource } from "@/app-shell/plain-mode";
import {
  clearRootContentTransitionFrame,
  recordMountedInkScreen,
  resetMountedInkScreen,
} from "@/app-shell/shell-screen-clear";

const CLEAR_SCREEN = "\x1b[2J\x1b[H";

describe("shell-screen-clear", () => {
  const savedPlain = process.env.KUNAI_PLAIN;

  afterEach(() => {
    resetMountedInkScreen();
    setPlainModePreferenceSource(() => false);
    if (savedPlain === undefined) delete process.env.KUNAI_PLAIN;
    else process.env.KUNAI_PLAIN = savedPlain;
  });

  test("clearRootContentTransitionFrame is safe when stdout is not a TTY", () => {
    expect(() => clearRootContentTransitionFrame()).not.toThrow();
  });

  test("plain mode undisplays placements and does not erase the primary screen", () => {
    process.env.KUNAI_PLAIN = "1";
    const joined = captureStdoutWrites(() => {
      clearRootContentTransitionFrame();
    });
    expect(joined).not.toContain(CLEAR_SCREEN);
    expect(joined).not.toContain("\x1b[2J");
  });

  test("the alternate-screen shell still clears on a root-content transition", () => {
    delete process.env.KUNAI_PLAIN;
    setPlainModePreferenceSource(() => false);
    const joined = captureStdoutWrites(() => {
      clearRootContentTransitionFrame();
    });
    expect(joined).toContain(CLEAR_SCREEN);
  });

  test("a primary-screen root does not wipe after plain mode is turned off", () => {
    recordMountedInkScreen(false);
    delete process.env.KUNAI_PLAIN;
    setPlainModePreferenceSource(() => false);
    const joined = captureStdoutWrites(() => {
      clearRootContentTransitionFrame();
    });
    expect(joined).not.toContain(CLEAR_SCREEN);
    expect(joined).not.toContain("\x1b[2J");
  });

  test("an alternate-screen root still clears after plain mode is turned on", () => {
    recordMountedInkScreen(true);
    process.env.KUNAI_PLAIN = "1";
    const joined = captureStdoutWrites(() => {
      clearRootContentTransitionFrame();
    });
    expect(joined).toContain(CLEAR_SCREEN);
  });
});

function captureStdoutWrites(run: () => void): string {
  const writes: string[] = [];
  const stdout = process.stdout;
  const originalWrite = stdout.write;
  const originalIsTTY = stdout.isTTY;
  Object.defineProperty(stdout, "isTTY", { value: true, configurable: true });
  const record: typeof stdout.write = (chunk) => {
    writes.push(chunk instanceof Uint8Array ? Buffer.from(chunk).toString("utf8") : chunk);
    return true;
  };
  stdout.write = record;
  try {
    run();
  } finally {
    stdout.write = originalWrite;
    Object.defineProperty(stdout, "isTTY", { value: originalIsTTY, configurable: true });
  }
  return writes.join("");
}
