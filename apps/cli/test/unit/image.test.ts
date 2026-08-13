import { afterEach, describe, expect, test } from "bun:test";

import {
  __testing as capabilityTesting,
  detectImageCapability,
  detectTerminal,
} from "@/image/capability";
import { isPngBytes } from "@/image/png";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStdoutIsTTY = process.stdout.isTTY;
const originalWhich = capabilityTesting.runtime.which;

function mockStdoutIsTty(value: boolean): () => void {
  Object.defineProperty(process.stdout, "isTTY", {
    value,
    configurable: true,
  });
  return () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTTY,
      configurable: true,
    });
  };
}

function mockBunWhich(result: string | null): () => void {
  capabilityTesting.runtime.which = (cmd: string) => (cmd === "chafa" ? result : Bun.which(cmd));
  return () => {
    capabilityTesting.runtime.which = originalWhich;
  };
}

function setEnv(vars: Record<string, string | undefined>): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

afterEach(() => {
  capabilityTesting.resetMemo();
  globalThis.fetch = originalFetch;
  Object.defineProperty(process.stdout, "isTTY", {
    value: originalStdoutIsTTY,
    configurable: true,
  });
  capabilityTesting.runtime.which = originalWhich;
  process.stdout.write = originalStdoutWrite;
});

describe("detectTerminal", () => {
  test("detects kitty via KITTY_WINDOW_ID", () => {
    expect(detectTerminal({ KITTY_WINDOW_ID: "1" } as NodeJS.ProcessEnv)).toBe("kitty");
  });

  test("detects ghostty via TERM_PROGRAM", () => {
    expect(detectTerminal({ TERM_PROGRAM: "ghostty" } as NodeJS.ProcessEnv)).toBe("ghostty");
    expect(detectTerminal({ TERM_PROGRAM: "Ghostty" } as NodeJS.ProcessEnv)).toBe("ghostty");
  });

  test("detects Windows Terminal via WT_SESSION", () => {
    expect(detectTerminal({ WT_SESSION: "abc" } as NodeJS.ProcessEnv)).toBe("windows-terminal");
  });

  test("detects WezTerm via TERM_PROGRAM", () => {
    expect(detectTerminal({ TERM_PROGRAM: "WezTerm" } as NodeJS.ProcessEnv)).toBe("wezterm");
  });

  test("detects WezTerm via WEZTERM_EXECUTABLE", () => {
    expect(detectTerminal({ WEZTERM_EXECUTABLE: "/path/to/wezterm" } as NodeJS.ProcessEnv)).toBe(
      "wezterm",
    );
  });

  test("detects vscode via TERM_PROGRAM", () => {
    expect(detectTerminal({ TERM_PROGRAM: "vscode" } as NodeJS.ProcessEnv)).toBe("vscode");
  });

  test("defaults to unknown", () => {
    expect(detectTerminal({} as NodeJS.ProcessEnv)).toBe("unknown");
  });
});

describe("detectImageCapability", () => {
  test("probes no binary on PATH and memoizes the result", () => {
    const restoreTty = mockStdoutIsTty(true);
    let whichCalls = 0;
    capabilityTesting.runtime.which = () => {
      whichCalls += 1;
      return "/usr/bin/anything";
    };
    capabilityTesting.resetMemo();
    try {
      const env = { TERM_PROGRAM: "WezTerm" } as NodeJS.ProcessEnv;
      const first = detectImageCapability(env);
      detectImageCapability(env);
      const third = detectImageCapability(env);

      // The zero-install claim in one assertion: capability no longer depends on
      // anything being installed, so it must not consult PATH at all. This used
      // to assert chafa lookup was memoized to exactly one call.
      expect(whichCalls).toBe(0);
      expect(third).toBe(first);
    } finally {
      restoreTty();
    }
  });

  test("returns none when stdout is not a TTY", () => {
    const restoreTty = mockStdoutIsTty(false);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({} as NodeJS.ProcessEnv);
      expect(capability.available).toBe(false);
      expect(capability.renderer).toBe("none");
      expect(capability.reason).toBe("stdout is not a TTY");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("returns none when KUNAI_POSTER=0", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({ KUNAI_POSTER: "0" } as NodeJS.ProcessEnv);
      expect(capability.available).toBe(false);
      expect(capability.reason).toBe("poster rendering disabled by KUNAI_POSTER");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("returns none when KUNAI_POSTER=false", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({ KUNAI_POSTER: "false" } as NodeJS.ProcessEnv);
      expect(capability.available).toBe(false);
      expect(capability.reason).toBe("poster rendering disabled by KUNAI_POSTER");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("respects KUNAI_IMAGE_PROTOCOL=none", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({
        KUNAI_IMAGE_PROTOCOL: "none",
      } as NodeJS.ProcessEnv);
      expect(capability.available).toBe(false);
      expect(capability.renderer).toBe("none");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("selects kitty-native for Kitty", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich(null);
    try {
      const capability = detectImageCapability({ KITTY_WINDOW_ID: "1" } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("kitty-native");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("selects kitty-native for Ghostty", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich(null);
    try {
      const capability = detectImageCapability({ TERM_PROGRAM: "ghostty" } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("kitty-native");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  // Windows Terminal only gained sixel in 1.22 and reports no version through
  // the environment, so auto-detection must not gamble on it — an older build
  // renders the escape bytes as literal text across the UI.
  test("selects half-block for Windows Terminal even when chafa is available", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({ WT_SESSION: "abc" } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("half-block");
      expect(capability.available).toBe(true);
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  // The original Windows bug: no chafa meant no posters at all. chafa is
  // effectively never installed on Windows, so this was every Windows user.
  test("still shows posters on Windows Terminal when chafa is missing", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich(null);
    try {
      const capability = detectImageCapability({ WT_SESSION: "abc" } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("half-block");
      expect(capability.available).toBe(true);
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("selects sixel for WezTerm", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({ TERM_PROGRAM: "WezTerm" } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("sixel");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  // half-block is the universal last resort: one code path, no external binary,
  // it looks better than chafa's symbol mode on photographic posters.
  test("selects half-block for unknown terminals regardless of chafa", () => {
    const restoreTty = mockStdoutIsTty(true);
    for (const chafaPath of ["/usr/bin/chafa", null]) {
      const restoreWhich = mockBunWhich(chafaPath);
      try {
        const capability = detectImageCapability({} as NodeJS.ProcessEnv);
        expect(capability.renderer).toBe("half-block");
        expect(capability.available).toBe(true);
      } finally {
        restoreWhich();
      }
    }
    restoreTty();
  });

  test("forces sixel when KUNAI_IMAGE_PROTOCOL=sixel", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({
        KUNAI_IMAGE_PROTOCOL: "sixel",
      } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("sixel");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("still forces sixel without chafa, because the encoder is in process", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich(null);
    try {
      const capability = detectImageCapability({
        KUNAI_IMAGE_PROTOCOL: "sixel",
      } as NodeJS.ProcessEnv);
      // Sixel used to resolve to "none" here: it was implemented by shelling out
      // to chafa, so no chafa meant no sixel. Kunai encodes it itself now, which
      // is what makes sharp posters reachable on Windows, where chafa is
      // effectively never installed.
      expect(capability.renderer).toBe("sixel");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("invalid protocol falls back to auto", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({
        KUNAI_IMAGE_PROTOCOL: "bad",
        WT_SESSION: "abc",
      } as NodeJS.ProcessEnv);
      // Auto for Windows Terminal is half-block; the point of this test is that
      // an unparseable override is ignored rather than disabling posters.
      expect(capability.renderer).toBe("half-block");
      expect(capability.available).toBe(true);
    } finally {
      restoreWhich();
      restoreTty();
    }
  });
});
