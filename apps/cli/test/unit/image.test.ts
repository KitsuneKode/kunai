import { afterEach, describe, expect, test } from "bun:test";

import {
  __testing as capabilityTesting,
  detectImageCapability,
  detectTerminal,
  isChafaAvailable,
} from "@/image/capability";
import { ensurePngBytes, __testing as convertTesting } from "@/image/convert";
import { isPngBytes } from "@/image/png";

import { stubMagickResolution } from "../support/image-binaries";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStdoutIsTTY = process.stdout.isTTY;
const originalWhich = capabilityTesting.runtime.which;
const originalConvertWhich = convertTesting.runtime.which;
const originalConvertSpawn = convertTesting.runtime.spawn;

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
  const restoreMagick = stubMagickResolution(result);
  return () => {
    capabilityTesting.runtime.which = originalWhich;
    restoreMagick();
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
  convertTesting.runtime.which = originalConvertWhich;
  convertTesting.runtime.spawn = originalConvertSpawn;
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
  test("memoizes chafa detection across repeated capability checks", () => {
    const restoreTty = mockStdoutIsTty(true);
    let whichCalls = 0;
    capabilityTesting.runtime.which = () => {
      whichCalls += 1;
      return "/usr/bin/chafa";
    };
    capabilityTesting.resetMemo();
    try {
      const env = { TERM_PROGRAM: "WezTerm" } as NodeJS.ProcessEnv;
      detectImageCapability(env);
      detectImageCapability(env);
      detectImageCapability(env);
      expect(whichCalls).toBe(1);
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
      expect(capability.dependency).toBe("none");
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

  // half-block is the universal last resort: one code path, no dependency, and
  // it looks better than chafa's symbol mode on photographic posters.
  // chafa-symbols stays reachable through KUNAI_IMAGE_PROTOCOL=symbols.
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
      expect(capability.dependency).toBe("none");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("forces chafa-symbols when KUNAI_IMAGE_PROTOCOL=symbols", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({
        KUNAI_IMAGE_PROTOCOL: "symbols",
      } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("chafa-symbols");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("forces none when KUNAI_IMAGE_PROTOCOL=symbols without chafa", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich(null);
    try {
      const capability = detectImageCapability({
        KUNAI_IMAGE_PROTOCOL: "symbols",
      } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("none");
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

describe("isChafaAvailable", () => {
  test("uses the same runtime.which stub as capability tests", () => {
    const restoreNone = mockBunWhich(null);
    try {
      expect(isChafaAvailable()).toBe(false);
    } finally {
      restoreNone();
    }
    capabilityTesting.resetMemo();
    const restorePath = mockBunWhich("/usr/bin/chafa");
    try {
      expect(isChafaAvailable()).toBe(true);
    } finally {
      restorePath();
    }
  });
});

describe("ensurePngBytes (magick)", () => {
  test("resolveMagickTimeoutMs defaults and clamps", () => {
    const { resolveMagickTimeoutMs } = convertTesting;
    const r0 = setEnv({});
    try {
      expect(resolveMagickTimeoutMs()).toBe(30_000);
    } finally {
      r0();
    }
    const r1 = setEnv({ KUNAI_IMAGE_MAGICK_TIMEOUT_MS: "500" });
    try {
      expect(resolveMagickTimeoutMs()).toBe(1000);
    } finally {
      r1();
    }
    const r2 = setEnv({ KUNAI_IMAGE_MAGICK_TIMEOUT_MS: "999999" });
    try {
      expect(resolveMagickTimeoutMs()).toBe(120_000);
    } finally {
      r2();
    }
    const r3 = setEnv({ KUNAI_IMAGE_MAGICK_TIMEOUT_MS: "5000" });
    try {
      expect(resolveMagickTimeoutMs()).toBe(5000);
    } finally {
      r3();
    }
    const r4 = setEnv({ KUNAI_IMAGE_MAGICK_TIMEOUT_MS: "nope" });
    try {
      expect(resolveMagickTimeoutMs()).toBe(30_000);
    } finally {
      r4();
    }
  });

  test("passes AbortSignal to magick spawn and returns converted PNG bytes", async () => {
    const restoreWhich = mockBunWhich("/usr/bin/magick");
    let spawnOpts: { signal?: AbortSignal } | undefined;
    const minimalPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);
    convertTesting.runtime.spawn = (cmd, options) => {
      spawnOpts = options as { signal?: AbortSignal };
      const outArg = cmd[2];
      const out = typeof outArg === "string" && outArg.startsWith("png:") ? outArg.slice(4) : "";
      // `exited` must not resolve before the output file exists. Firing the
      // write off with `void` raced the read that follows and made this test
      // fail intermittently — a real process has finished writing by the time it
      // reports exit, and the fake has to keep that promise.
      const written = out ? Bun.write(out, minimalPng) : Promise.resolve(0);
      return {
        stdout: new Response("").body,
        stderr: new Response("").body,
        exited: written.then(() => 0),
      } as unknown as Bun.Subprocess;
    };
    try {
      const jpegish = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const result = await ensurePngBytes(jpegish);
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected converted png bytes");
      expect(isPngBytes(result)).toBe(true);
      expect(spawnOpts?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      restoreWhich();
      convertTesting.runtime.spawn = originalConvertSpawn;
    }
  });
});
