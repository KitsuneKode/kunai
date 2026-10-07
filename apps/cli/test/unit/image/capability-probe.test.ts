import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { __testing as capabilityTesting, detectImageCapability } from "@/image/capability";
import { __testing as probeTesting } from "@/image/probe";

const originalWhich = capabilityTesting.runtime.which;
const originalIsTty = capabilityTesting.runtime.isStdoutTty;

function withChafa(available: boolean): void {
  capabilityTesting.runtime.which = (command: string) =>
    command === "chafa" && available ? "/usr/bin/chafa" : null;
}

beforeEach(() => {
  capabilityTesting.runtime.isStdoutTty = () => true;
  probeTesting.reset();
  capabilityTesting.resetMemo();
});

afterEach(() => {
  capabilityTesting.runtime.which = originalWhich;
  capabilityTesting.runtime.isStdoutTty = originalIsTty;
  probeTesting.reset();
  capabilityTesting.resetMemo();
});

describe("image capability with a terminal probe", () => {
  test("a Windows Terminal that reports sixel selects the overlay renderer", () => {
    withChafa(true);
    const env = { WT_SESSION: "1", TERM: "xterm-256color" };

    capabilityTesting.resetMemo();
    expect(detectImageCapability(env).protocol).toBe("half-block");

    probeTesting.setProbed({ sixel: true, kittyGraphics: false });
    capabilityTesting.resetMemo();
    const probed = detectImageCapability(env);
    expect(probed.protocol).toBe("sixel");
    expect(probed.renderer).toBe("sixel");
  });

  test("an unrecognised terminal that reports sixel selects the overlay renderer", () => {
    withChafa(true);
    probeTesting.setProbed({ sixel: true, kittyGraphics: false });
    expect(detectImageCapability({ TERM: "foot" }).protocol).toBe("sixel");
  });

  test("a terminal answering the kitty query gets the native renderer", () => {
    withChafa(false);
    probeTesting.setProbed({ sixel: false, kittyGraphics: true });
    const capability = detectImageCapability({ TERM: "xterm-256color" });
    expect(capability.protocol).toBe("kitty");
  });

  test("a named terminal without placeholders takes its real best protocol, not kitty", () => {
    // WezTerm's opt-in kitty mode answers a=q but has no Unicode placeholder
    // support — claiming kitty-native demoted it to half-block, below the
    // sixel it speaks natively.
    probeTesting.setProbed({ sixel: false, kittyGraphics: true });
    const wezterm = detectImageCapability({ TERM_PROGRAM: "WezTerm", TERM: "xterm-256color" });
    expect(wezterm.renderer).toBe("sixel");

    // Same shape for iTerm2's partial kitty support: the verbatim-PNG inline
    // protocol is its real best, strictly above half-block.
    capabilityTesting.resetMemo();
    const iterm = detectImageCapability({ TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" });
    expect(iterm.renderer).toBe("iterm-inline");
  });

  test("a sixel reply selects the in-process renderer without chafa", () => {
    withChafa(false);
    probeTesting.setProbed({ sixel: true, kittyGraphics: false });
    const capability = detectImageCapability({ WT_SESSION: "1", TERM: "xterm-256color" });
    expect(capability.protocol).toBe("sixel");
    expect(capability.renderer).toBe("sixel");
  });

  test("a terminal that reports nothing keeps the previous behaviour", () => {
    withChafa(true);
    probeTesting.setProbed({ sixel: false, kittyGraphics: false });
    expect(detectImageCapability({ WT_SESSION: "1", TERM: "xterm" }).protocol).toBe("half-block");
    capabilityTesting.resetMemo();
    expect(detectImageCapability({ TERM: "xterm" }).protocol).toBe("half-block");
  });

  // An explicit override is the user's decision and must outrank the probe.
  test("KUNAI_IMAGE_PROTOCOL still wins over a probe answer", () => {
    withChafa(true);
    probeTesting.setProbed({ sixel: true, kittyGraphics: true });
    expect(
      detectImageCapability({ TERM: "xterm", KUNAI_IMAGE_PROTOCOL: "half-block" }).protocol,
    ).toBe("half-block");
    capabilityTesting.resetMemo();
    expect(detectImageCapability({ TERM: "xterm", KUNAI_IMAGE_PROTOCOL: "none" }).protocol).toBe(
      "none",
    );
  });
});

describe("image capability no-colour honesty", () => {
  test("TERM=dumb selects no renderer in auto mode", () => {
    withChafa(true);
    capabilityTesting.resetMemo();
    const capability = detectImageCapability({ TERM: "dumb" });
    expect(capability.renderer).toBe("none");
    expect(capability.available).toBe(false);
  });

  test("NO_COLOR selects no renderer in auto mode", () => {
    withChafa(true);
    capabilityTesting.resetMemo();
    const capability = detectImageCapability({ TERM: "xterm-256color", NO_COLOR: "1" });
    expect(capability.renderer).toBe("none");
  });

  test("an explicit protocol override still wins over NO_COLOR", () => {
    withChafa(true);
    capabilityTesting.resetMemo();
    const capability = detectImageCapability({
      TERM: "xterm-256color",
      NO_COLOR: "1",
      KUNAI_IMAGE_PROTOCOL: "half-block",
    });
    expect(capability.renderer).toBe("half-block");
  });
});
