import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  __testing as capabilityTesting,
  detectImageCapability,
  selectImageCapability,
} from "@/image/capability";
import { __testing as probeTesting, parseDeviceAttributes } from "@/image/probe";

const originalWhich = capabilityTesting.runtime.which;
const originalIsTty = capabilityTesting.runtime.isStdoutTty;

describe("Kitty through tmux", () => {
  const env = { TMUX: "/tmp/posters,123,0", TERM: "tmux-256color", KITTY_WINDOW_ID: "1" };
  const tmux = {
    major: 3,
    minor: 3,
    passthrough: "on",
    clientTerm: "xterm-kitty",
    clientFeatures: [],
  } as const;
  const probe = { sixel: false, kittyGraphics: false, tmux };

  test("selects wrapped Kitty for an eligible pane with a Kitty client", () => {
    expect(selectImageCapability(env, true, probe)).toMatchObject({
      renderer: "kitty-native",
      kittyPassthrough: "tmux",
    });
    expect(
      selectImageCapability(env, true, { ...probe, tmux: { ...tmux, passthrough: "all" } })
        .kittyPassthrough,
    ).toBe("tmux");
  });

  test("accepts an outer terminal that confirmed Unicode placeholders", () => {
    const response = { ...probe, tmux: { ...tmux, clientTerm: "custom" }, kittyPlaceholders: true };
    expect(selectImageCapability({ TMUX: env.TMUX, TERM: env.TERM }, true, response).renderer).toBe(
      "kitty-native",
    );
  });

  test("falls back for old tmux, disabled passthrough, and stale Kitty variables", () => {
    for (const context of [
      { ...tmux, minor: 2 },
      { ...tmux, passthrough: "off" },
      { ...tmux, clientTerm: "foot", clientFeatures: ["sixel"] },
    ] as const) {
      expect(selectImageCapability(env, true, { ...probe, tmux: context }).renderer).toBe(
        "half-block",
      );
    }
    expect(selectImageCapability(env, true, null).renderer).toBe("half-block");
  });

  test("honors the tmux opt-out and explicit protocol overrides", () => {
    expect(selectImageCapability({ ...env, KUNAI_IMAGE_TMUX: "0" }, true, probe).renderer).toBe(
      "half-block",
    );
    expect(selectImageCapability({ ...env, STY: "screen" }, true, probe).renderer).toBe(
      "half-block",
    );
    expect(
      selectImageCapability({ ...env, KUNAI_IMAGE_PROTOCOL: "none" }, true, probe).renderer,
    ).toBe("none");
    expect(
      selectImageCapability({ ...env, KUNAI_IMAGE_PROTOCOL: "kitty" }, true, probe)
        .kittyPassthrough,
    ).toBe("tmux");
    expect(
      selectImageCapability({ ...env, KUNAI_IMAGE_PROTOCOL: "kitty" }, true, null).renderer,
    ).toBe("half-block");
  });
});

describe("native Sixel in tmux", () => {
  const env = { TMUX: "/tmp/posters,123,0", TERM: "tmux-256color", KUNAI_IMAGE_TMUX: "0" };
  const tmux = {
    major: 3,
    minor: 4,
    passthrough: "off",
    clientTerm: "foot",
    clientFeatures: ["sixel"],
  };
  const probe = { sixel: true, kittyGraphics: false, tmux };

  test("routes tmux's DA1 sixel answer to the existing overlay", () => {
    expect(selectImageCapability(env, true, probe).renderer).toBe("sixel");
  });

  test("stays on half-block without tmux 3.4 and its own sixel attribute", () => {
    expect(selectImageCapability(env, true, { ...probe, sixel: false }).renderer).toBe(
      "half-block",
    );
    expect(
      selectImageCapability(env, true, { ...probe, tmux: { ...tmux, minor: 3 } }).renderer,
    ).toBe("half-block");
    expect(selectImageCapability({ ...env, STY: "screen" }, true, probe).renderer).toBe(
      "half-block",
    );
    expect(selectImageCapability({ TERM: "tmux-256color" }, true, probe).renderer).toBe(
      "half-block",
    );
  });

  test("a client whose terminal cannot draw sixel stays on half-block", () => {
    // tmux 3.8 inside kitty 0.51 (passthrough off) still answers DA1 with
    // sixel; only client_termfeatures shows the terminal lacks it.
    const kittyClient = {
      ...tmux,
      clientTerm: "xterm-kitty",
      clientFeatures: ["bpaste", "ccolour", "clipboard", "cstyle", "focus", "RGB", "sync", "title"],
    };
    expect(selectImageCapability(env, true, { ...probe, tmux: kittyClient }).renderer).toBe(
      "half-block",
    );
    const alacritty = { ...tmux, clientTerm: "alacritty", clientFeatures: ["RGB", "title"] };
    expect(selectImageCapability(env, true, { ...probe, tmux: alacritty }).renderer).toBe(
      "half-block",
    );
  });

  test("honors a text or Kitty override ahead of automatic sixel", () => {
    expect(
      selectImageCapability({ ...env, KUNAI_IMAGE_PROTOCOL: "half-block" }, true, probe).renderer,
    ).toBe("half-block");
    expect(
      selectImageCapability({ ...env, KUNAI_IMAGE_PROTOCOL: "kitty" }, true, probe).renderer,
    ).toBe("half-block");
  });
});

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
  test.each([{ KONSOLE_VERSION: "240800" }, { TERM_PROGRAM: "WezTerm" }])(
    "selects direct Kitty placement only with a successful probe for %j",
    (env) => {
      const good = parseDeviceAttributes("\x1b_Gi=31;OK\x1b\\\x1b[?61;4c");
      const error = parseDeviceAttributes("\x1b_Gi=31;EBADF\x1b\\\x1b[?61;4c");
      expect(selectImageCapability(env, true, good).renderer).toBe("kitty-direct");
      expect(selectImageCapability(env, true, error).renderer).toBe("sixel");
      expect(selectImageCapability({ ...env, TMUX: "pane" }, true, good).renderer).toBe(
        "half-block",
      );
      expect(
        selectImageCapability({ ...env, KUNAI_IMAGE_PROTOCOL: "sixel" }, true, good).renderer,
      ).toBe("sixel");
      expect(
        selectImageCapability({ ...env, KUNAI_IMAGE_PROTOCOL: "kitty" }, true, good).renderer,
      ).toBe("kitty-direct");
    },
  );

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

  test("empty NO_COLOR is ignored per no-color.org", () => {
    withChafa(true);
    capabilityTesting.resetMemo();
    const capability = detectImageCapability({ TERM: "xterm-256color", NO_COLOR: "" });
    expect(capability.renderer).not.toBe("none");
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
