import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ImageRenderOptions } from "@/image";
import { displayPoster } from "@/image";
import { __testing as cacheTesting, getCachedPoster } from "@/image/cache";
import {
  __testing as capabilityTesting,
  detectImageCapability,
  detectTerminal,
  isChafaAvailable,
} from "@/image/capability";
import { ensurePngBytes, __testing as convertTesting } from "@/image/convert";
import { isPngBytes } from "@/image/png";
import {
  __testing as chafaTesting,
  renderChafaSixels,
  renderChafaSymbols,
} from "@/image/renderers/chafa";
import { NonPngError, renderKittyNative } from "@/image/renderers/kitty";

const DEFAULT_OPTIONS: ImageRenderOptions = { size: "30x18", maxRows: 18, debug: false };

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStdoutIsTTY = process.stdout.isTTY;
const originalWhich = capabilityTesting.runtime.which;
const originalSpawn = chafaTesting.runtime.spawn;
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

function mockStdoutWrite(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const writer = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = writer;
  return {
    writes,
    restore: () => {
      process.stdout.write = originalStdoutWrite;
    },
  };
}

function mockBunWhich(result: string | null): () => void {
  capabilityTesting.runtime.which = (cmd: string) => (cmd === "chafa" ? result : Bun.which(cmd));
  convertTesting.runtime.which = (cmd: string) => (cmd === "magick" ? result : Bun.which(cmd));
  return () => {
    capabilityTesting.runtime.which = originalWhich;
    convertTesting.runtime.which = originalConvertWhich;
  };
}

function mockBunSpawn(capture: (cmd: string[], options: unknown) => void): () => void {
  chafaTesting.runtime.spawn = (cmd: string[], options: unknown) => {
    capture(cmd, options);
    return {
      stdout: new Response("").body,
      stderr: new Response("").body,
      exited: Promise.resolve(0),
    } as unknown as Bun.Subprocess;
  };
  return () => {
    chafaTesting.runtime.spawn = originalSpawn;
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

function setFetchMock(
  handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): void {
  globalThis.fetch = Object.assign(handler, {
    preconnect: originalFetch.preconnect,
  }) as typeof fetch;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "kunai-image-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withTempFile(
  data: Uint8Array,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "kunai-image-file-"));
  const filePath = join(dir, "poster.bin");
  await writeFile(filePath, data);
  return { path: filePath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(process.stdout, "isTTY", {
    value: originalStdoutIsTTY,
    configurable: true,
  });
  capabilityTesting.runtime.which = originalWhich;
  chafaTesting.runtime.spawn = originalSpawn;
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

  test("selects chafa-sixel for Windows Terminal when chafa is available", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({ WT_SESSION: "abc" } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("chafa-sixel");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("selects none for Windows Terminal when chafa is missing", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich(null);
    try {
      const capability = detectImageCapability({ WT_SESSION: "abc" } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("none");
      expect(capability.reason).toBe("Windows Terminal detected but chafa is missing");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("selects chafa-sixel for WezTerm with chafa", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({ TERM_PROGRAM: "WezTerm" } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("chafa-sixel");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("selects chafa-symbols for unknown terminals when chafa is available", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({} as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("chafa-symbols");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("forces chafa-sixel when KUNAI_IMAGE_PROTOCOL=sixel", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich("/usr/bin/chafa");
    try {
      const capability = detectImageCapability({
        KUNAI_IMAGE_PROTOCOL: "sixel",
      } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("chafa-sixel");
    } finally {
      restoreWhich();
      restoreTty();
    }
  });

  test("forces none when KUNAI_IMAGE_PROTOCOL=sixel without chafa", () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich(null);
    try {
      const capability = detectImageCapability({
        KUNAI_IMAGE_PROTOCOL: "sixel",
      } as NodeJS.ProcessEnv);
      expect(capability.renderer).toBe("none");
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
      expect(capability.renderer).toBe("chafa-sixel");
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
    const restorePath = mockBunWhich("/usr/bin/chafa");
    try {
      expect(isChafaAvailable()).toBe(true);
    } finally {
      restorePath();
    }
  });
});

describe("renderKittyNative", () => {
  test("accepts PNG magic bytes", async () => {
    const restoreTty = mockStdoutIsTty(true);
    const capture = mockStdoutWrite();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    const file = await withTempFile(png);
    try {
      await renderKittyNative(file.path, DEFAULT_OPTIONS);
      expect(capture.writes.join("")).toContain("\x1b_Ga=T,f=100,q=2");
    } finally {
      await file.cleanup();
      capture.restore();
      restoreTty();
    }
  });

  test("rejects non-PNG bytes", async () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich(null);
    const file = await withTempFile(new Uint8Array([0x01, 0x02, 0x03]));
    try {
      await expect(renderKittyNative(file.path, DEFAULT_OPTIONS)).rejects.toBeInstanceOf(
        NonPngError,
      );
    } finally {
      await file.cleanup();
      restoreWhich();
      restoreTty();
    }
  });

  test("chunks base64 into <=4096 byte pieces and uses q=2", async () => {
    const restoreTty = mockStdoutIsTty(true);
    const capture = mockStdoutWrite();
    const data = new Uint8Array(4000);
    data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const file = await withTempFile(data);
    try {
      await renderKittyNative(file.path, DEFAULT_OPTIONS);
      const chunks = capture.writes
        .join("")
        .split("\x1b\\")
        .filter((part) => part.startsWith("\x1b_G"));
      expect(chunks.length).toBeGreaterThan(0);
      const first = chunks[0] ?? "";
      expect(first).toContain("q=2");
      for (const chunk of chunks) {
        const content = chunk.split(";").slice(1).join(";");
        expect(content.length).toBeLessThanOrEqual(4096);
      }
    } finally {
      await file.cleanup();
      capture.restore();
      restoreTty();
    }
  });

  test("does not write anything for empty input", async () => {
    const restoreTty = mockStdoutIsTty(true);
    const capture = mockStdoutWrite();
    const file = await withTempFile(new Uint8Array());
    try {
      await renderKittyNative(file.path, DEFAULT_OPTIONS);
      expect(capture.writes.length).toBe(0);
    } finally {
      await file.cleanup();
      capture.restore();
      restoreTty();
    }
  });
});

describe("chafa renderers", () => {
  test("builds the expected sixel command", async () => {
    let captured: string[] = [];
    const restoreSpawn = mockBunSpawn((cmd) => {
      captured = cmd;
    });
    try {
      await renderChafaSixels("/tmp/poster.jpg", DEFAULT_OPTIONS);
      expect(captured).toEqual([
        "chafa",
        "--format",
        "sixels",
        "--size",
        "30x18",
        "--animate",
        "off",
        "--polite",
        "on",
        "--margin-bottom",
        "1",
        "/tmp/poster.jpg",
      ]);
    } finally {
      restoreSpawn();
    }
  });

  test("builds the expected symbols command", async () => {
    let captured: string[] = [];
    const restoreSpawn = mockBunSpawn((cmd) => {
      captured = cmd;
    });
    try {
      await renderChafaSymbols("/tmp/poster.jpg", DEFAULT_OPTIONS);
      expect(captured).toEqual([
        "chafa",
        "--format",
        "symbols",
        "--size",
        "30x18",
        "--animate",
        "off",
        "--polite",
        "on",
        "--colors",
        "full",
        "/tmp/poster.jpg",
      ]);
    } finally {
      restoreSpawn();
    }
  });
});

describe("poster cache", () => {
  test("reuses the same cache file for the same poster path", async () => {
    await withTempDir(async (dir) => {
      const restoreEnv = setEnv({ XDG_CACHE_HOME: dir });
      let fetchCalls = 0;
      setFetchMock(async () => {
        fetchCalls += 1;
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      });
      try {
        const first = await getCachedPoster("/abc.jpg");
        const second = await getCachedPoster("/abc.jpg");
        expect(first).toBeTruthy();
        expect(second).toBe(first);
        expect(fetchCalls).toBe(1);
      } finally {
        restoreEnv();
      }
    });
  });

  test("treats zero-byte cache files as invalid", async () => {
    await withTempDir(async (dir) => {
      const restoreEnv = setEnv({ XDG_CACHE_HOME: dir });
      try {
        const url = cacheTesting.buildPosterUrl("/zero.jpg");
        const cachePath = cacheTesting.buildCachePath(url, "/zero.jpg");
        await mkdir(dirname(cachePath), { recursive: true });
        await writeFile(cachePath, new Uint8Array());

        let fetchCalls = 0;
        setFetchMock(async () => {
          fetchCalls += 1;
          return new Response(new Uint8Array([9, 9, 9]), { status: 200 });
        });

        const result = await getCachedPoster("/zero.jpg");
        expect(fetchCalls).toBe(1);
        expect(result).toBe(cachePath);
        const info = await stat(cachePath);
        expect(info.size).toBeGreaterThan(0);
      } finally {
        restoreEnv();
      }
    });
  });

  test("returns null on failed fetch", async () => {
    await withTempDir(async (dir) => {
      const restoreEnv = setEnv({ XDG_CACHE_HOME: dir });
      setFetchMock(async () => new Response(null, { status: 404 }));
      try {
        const result = await getCachedPoster("/missing.jpg");
        expect(result).toBeNull();
      } finally {
        restoreEnv();
      }
    });
  });

  test("uses atomic write helper for poster cache", async () => {
    await withTempDir(async (dir) => {
      const restoreEnv = setEnv({ XDG_CACHE_HOME: dir });
      let writtenTarget: string | null = null;
      let writtenData: ArrayBuffer | null = null;
      const originalAtomic = cacheTesting.atomicWrite;
      cacheTesting.atomicWrite = async (target, data) => {
        writtenTarget = target;
        writtenData = data instanceof ArrayBuffer ? data : null;
        return originalAtomic(target, data);
      };

      setFetchMock(async () => new Response(new Uint8Array([4, 5, 6]), { status: 200 }));
      try {
        const url = cacheTesting.buildPosterUrl("/atomic.jpg");
        const cachePath = cacheTesting.buildCachePath(url, "/atomic.jpg");
        const result = await getCachedPoster("/atomic.jpg");
        expect(result).toBe(cachePath);
        expect(writtenTarget!).toBe(cachePath);
        expect(writtenData!).toBeTruthy();
      } finally {
        cacheTesting.atomicWrite = originalAtomic;
        restoreEnv();
      }
    });
  });

  test("returns null when atomic write fails", async () => {
    await withTempDir(async (dir) => {
      const restoreEnv = setEnv({ XDG_CACHE_HOME: dir });
      const originalAtomic = cacheTesting.atomicWrite;
      cacheTesting.atomicWrite = async () => {
        throw new Error("atomic write failed");
      };
      setFetchMock(async () => new Response(new Uint8Array([7, 8, 9]), { status: 200 }));
      try {
        const result = await getCachedPoster("/broken.jpg");
        expect(result).toBeNull();
      } finally {
        cacheTesting.atomicWrite = originalAtomic;
        restoreEnv();
      }
    });
  });
});

describe("displayPoster", () => {
  test("does not throw on null poster", async () => {
    await expect(displayPoster(null)).resolves.toBeUndefined();
  });

  test("does not fetch when protocol is none", async () => {
    const restoreEnv = setEnv({ KUNAI_IMAGE_PROTOCOL: "none" });
    const restoreTty = mockStdoutIsTty(true);
    let fetchCalls = 0;
    setFetchMock(async () => {
      fetchCalls += 1;
      return new Response(new Uint8Array([1]), { status: 200 });
    });
    try {
      await displayPoster("/poster.jpg");
      expect(fetchCalls).toBe(0);
    } finally {
      restoreEnv();
      restoreTty();
    }
  });

  test("catches renderer failures", async () => {
    await withTempDir(async (dir) => {
      const restoreEnv = setEnv({
        KUNAI_IMAGE_PROTOCOL: "kitty",
        KITTY_WINDOW_ID: "1",
        XDG_CACHE_HOME: dir,
      });
      const restoreTty = mockStdoutIsTty(true);
      const restoreWhich = mockBunWhich(null);
      setFetchMock(async () => new Response(new Uint8Array([0x01, 0x02, 0x03]), { status: 200 }));
      try {
        await expect(displayPoster("/poster.jpg")).resolves.toBeUndefined();
      } finally {
        restoreEnv();
        restoreTty();
        restoreWhich();
      }
    });
  });

  test("debug output only appears when KUNAI_IMAGE_DEBUG=1", async () => {
    const restoreTty = mockStdoutIsTty(true);
    const restoreWhich = mockBunWhich(null);
    const restoreEnv = setEnv({ KUNAI_IMAGE_PROTOCOL: "none", KUNAI_IMAGE_DEBUG: undefined });
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => {
      logs.push(msg);
    };

    try {
      await displayPoster("/poster.jpg");
      expect(logs.length).toBe(0);
      const restoreDebugEnv = setEnv({ KUNAI_IMAGE_DEBUG: "1" });
      await displayPoster("/poster.jpg");
      restoreDebugEnv();
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      console.log = originalLog;
      restoreEnv();
      restoreWhich();
      restoreTty();
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
      if (out) {
        void Bun.write(out, minimalPng);
      }
      return {
        stdout: new Response("").body,
        stderr: new Response("").body,
        exited: Promise.resolve(0),
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
