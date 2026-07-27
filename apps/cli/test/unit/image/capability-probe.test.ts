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
  // The reason this work exists: Windows Terminal gained sixel in 1.22, but
  // nothing in the environment reports a version, so every WT user was handed
  // half-block. Asking the terminal is the only way to know.
  test("a Windows Terminal that reports sixel gets sixel, not half-block", () => {
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

  // Terminals the name heuristics have never heard of (foot, contour, mlterm,
  // xterm -ti vt340) were all funnelled into half-block.
  test("an unrecognised terminal that reports sixel gets sixel", () => {
    withChafa(true);
    probeTesting.setProbed({ sixel: true, kittyGraphics: false });
    expect(detectImageCapability({ TERM: "foot" }).protocol).toBe("sixel");
  });

  test("a terminal answering the kitty query gets the native renderer", () => {
    withChafa(false);
    probeTesting.setProbed({ sixel: false, kittyGraphics: true });
    const capability = detectImageCapability({ TERM: "xterm-256color" });
    expect(capability.protocol).toBe("kitty");
    expect(capability.dependency).toBe("none");
  });

  // A terminal that answers the sixel query gets sixel, encoder installed or
  // not. This used to fall back to half-block whenever chafa was missing —
  // which on Windows is essentially always, so a terminal that had just told us
  // it does sixel still got two pixels per cell. The encoder is in process now.
  test("sixel is taken on the probe answer alone, with no chafa on PATH", () => {
    withChafa(false);
    probeTesting.setProbed({ sixel: true, kittyGraphics: false });
    const capability = detectImageCapability({ WT_SESSION: "1", TERM: "xterm-256color" });
    expect(capability.protocol).toBe("sixel");
    expect(capability.renderer).toBe("sixel");
    expect(capability.dependency).toBe("none");
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
