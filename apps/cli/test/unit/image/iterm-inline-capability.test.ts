import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { __testing as capabilityTesting, detectImageCapability } from "@/image/capability";
import { detectTerminal } from "@/image/capability";
import { __testing as probeTesting } from "@/image/probe";

const originalWhich = capabilityTesting.runtime.which;
const originalIsTty = capabilityTesting.runtime.isStdoutTty;

beforeEach(() => {
  capabilityTesting.runtime.isStdoutTty = () => true;
  capabilityTesting.runtime.which = () => null;
  probeTesting.reset();
  capabilityTesting.resetMemo();
});

afterEach(() => {
  capabilityTesting.runtime.which = originalWhich;
  capabilityTesting.runtime.isStdoutTty = originalIsTty;
  probeTesting.reset();
  capabilityTesting.resetMemo();
});

function capabilityFor(env: Record<string, string>) {
  capabilityTesting.resetMemo();
  return detectImageCapability(env as NodeJS.ProcessEnv);
}

describe("detectTerminal — iTerm2", () => {
  test("detects iTerm2 via TERM_PROGRAM", () => {
    expect(detectTerminal({ TERM_PROGRAM: "iTerm.app" } as NodeJS.ProcessEnv)).toBe("iterm2");
    expect(detectTerminal({ TERM_PROGRAM: "iterm.app" } as NodeJS.ProcessEnv)).toBe("iterm2");
  });

  test("detects iTerm2 via LC_TERMINAL, which survives ssh", () => {
    // iTerm2 forwards LC_TERMINAL through ssh where TERM_PROGRAM is lost, and a
    // remote session renders inline images just as well as a local one.
    expect(detectTerminal({ LC_TERMINAL: "iTerm2" } as NodeJS.ProcessEnv)).toBe("iterm2");
  });

  test("prefers a kitty-compatible terminal over an inherited LC_TERMINAL", () => {
    expect(
      detectTerminal({ KITTY_WINDOW_ID: "1", LC_TERMINAL: "iTerm2" } as NodeJS.ProcessEnv),
    ).toBe("kitty");
  });
});

describe("image capability — iTerm2 inline images", () => {
  test("iTerm2 gets a real image protocol rather than the text floor", () => {
    // Before this, iTerm2 was not detected at all: it fell through to "unknown"
    // and rendered half-block ASCII despite having first-class image support.
    const capability = capabilityFor({ TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" });

    expect(capability.terminal).toBe("iterm2");
    expect(capability.protocol).toBe("iterm-inline");
    expect(capability.renderer).toBe("iterm-inline");
    expect(capability.available).toBe(true);
  });

  test("iTerm2 inside tmux stays on text, because we emit no passthrough", () => {
    const capability = capabilityFor({
      TERM_PROGRAM: "iTerm.app",
      TMUX: "/tmp/tmux-1000/default,123,0",
    });

    expect(capability.renderer).toBe("half-block");
  });

  test("a recent VSCode terminal gets inline images", () => {
    const capability = capabilityFor({
      TERM_PROGRAM: "vscode",
      TERM_PROGRAM_VERSION: "1.85.2",
      TERM: "xterm-256color",
    });

    expect(capability.terminal).toBe("vscode");
    expect(capability.renderer).toBe("iterm-inline");
  });

  test("an older VSCode terminal stays on text rather than emitting garbage", () => {
    // VSCode only learned the protocol in 1.80. Emitting it to an older build
    // dumps raw escape bytes across the UI, so an unverifiable version is
    // treated the same way Windows Terminal sixel already is.
    const capability = capabilityFor({
      TERM_PROGRAM: "vscode",
      TERM_PROGRAM_VERSION: "1.74.0",
      TERM: "xterm-256color",
    });

    expect(capability.renderer).toBe("half-block");
  });

  test("a VSCode terminal with no version reported stays on text", () => {
    const capability = capabilityFor({ TERM_PROGRAM: "vscode", TERM: "xterm-256color" });

    expect(capability.renderer).toBe("half-block");
  });

  test("a probed kitty terminal still wins over inline images", () => {
    // Kitty's own protocol supports Unicode placeholders, which sit inside Ink's
    // frame instead of needing a measured overlay — strictly better where present.
    const capability = capabilityFor({ KITTY_WINDOW_ID: "1", TERM: "xterm-kitty" });

    expect(capability.renderer).toBe("kitty-native");
  });

  test("KUNAI_IMAGE_PROTOCOL=iterm forces inline images", () => {
    const capability = capabilityFor({ KUNAI_IMAGE_PROTOCOL: "iterm", TERM: "xterm-256color" });

    expect(capability.renderer).toBe("iterm-inline");
  });

  test("a non-TTY stdout renders nothing regardless of terminal", () => {
    capabilityTesting.runtime.isStdoutTty = () => false;

    expect(capabilityFor({ TERM_PROGRAM: "iTerm.app" }).renderer).toBe("none");
  });
});
