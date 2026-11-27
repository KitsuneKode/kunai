import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MPV_HWACCEL_PROBE_CACHE_TTL_MS,
  finishMpvHwaccelProbeProcess,
  parseAutoSafeDriver,
  parseGpuDriversFromHwdecHelp,
  probeMpvHardwareAcceleration,
  readCachedMpvHardwareAcceleration,
  type MpvHwaccelProbeDeps,
  type MpvHwaccelRunProcess,
} from "@/infra/player/mpv-hwaccel-probe";

const HELP_WITH_GPU_DRIVERS = [
  "Valid values (with alternative full names):",
  "  vulkan (h264-vulkan)",
  "  nvdec (h264-nvdec)",
  "  vaapi (h264-vaapi)",
  "  vdpau (h264-vdpau)",
  "  qsv (h264_qsv-qsv)",
  "  videotoolbox (h264-videotoolbox)",
  "  d3d11va (h264-d3d11va)",
].join("\n");

type ProbeCall = {
  readonly argv: readonly string[];
  readonly stdinLength: number;
  readonly stopsAfterOutput: boolean;
};

type RunBehavior = {
  readonly help?: Partial<Awaited<ReturnType<MpvHwaccelRunProcess>>>;
  readonly decode?: Partial<Awaited<ReturnType<MpvHwaccelRunProcess>>>;
};

function successfulBehavior(): Required<RunBehavior> {
  return {
    help: { exitCode: 0, stdout: HELP_WITH_GPU_DRIVERS, stderr: "", timedOut: false },
    decode: {
      exitCode: 0,
      stdout: "Using hardware decoding (nvdec-copy).",
      stderr: "",
      timedOut: false,
    },
  };
}

function createRunProcess(initial: RunBehavior = successfulBehavior()) {
  const calls: ProbeCall[] = [];
  let behavior = initial;
  const runProcess: MpvHwaccelRunProcess = async (argv, options) => {
    calls.push({
      argv,
      stdinLength: options.stdin?.length ?? 0,
      stopsAfterOutput: options.stopAfterOutput !== undefined,
    });
    const isHelp = argv.includes("--hwdec=help");
    const override = isHelp ? behavior.help : behavior.decode;
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      ...override,
    };
  };
  return {
    calls,
    runProcess,
    setBehavior(next: RunBehavior) {
      behavior = next;
    },
  };
}

function depsFor(
  runProcess: MpvHwaccelRunProcess,
  overrides: Partial<Parameters<typeof probeMpvHardwareAcceleration>[0]> = {},
): MpvHwaccelProbeDeps {
  return {
    which: (command: string) => (command === "mpv" ? "/usr/bin/mpv" : null),
    exists: () => false,
    platform: "linux",
    runProcess,
    cacheFile: null,
    now: () => 1_000,
    ...overrides,
  };
}

async function withCacheFile<T>(fn: (cacheFile: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "kunai-hwaccel-probe-test-"));
  try {
    return await fn(join(dir, "mpv-hwaccel-probe.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("mpv hwaccel probe parsing", () => {
  test("parses GPU decoder families from hwdec help without pinning one OS", () => {
    expect(parseGpuDriversFromHwdecHelp(HELP_WITH_GPU_DRIVERS)).toEqual([
      "vaapi",
      "nvdec",
      "vdpau",
      "vulkan",
      "qsv",
      "videotoolbox",
      "d3d11va",
    ]);
    expect(parseGpuDriversFromHwdecHelp("  videotoolbox (h264-videotoolbox)")).toEqual([
      "videotoolbox",
    ]);
    expect(parseGpuDriversFromHwdecHelp("  d3d11va (h264-d3d11va)")).toEqual(["d3d11va"]);
  });

  test("preserves the exact auto-safe backend, including copy fallbacks", () => {
    expect(parseAutoSafeDriver("Using hardware decoding (nvdec-copy).")).toBe("nvdec-copy");
    expect(parseAutoSafeDriver("[vd] Using hardware decoding (vaapi).")).toBe("vaapi");
    expect(parseAutoSafeDriver("software decoding only")).toBe("");
  });
});

describe("finishMpvHwaccelProbeProcess", () => {
  test("terminates a still-running child when an output stream rejects", async () => {
    const encoder = new TextEncoder();
    let stdoutPulls = 0;
    const stdout = new ReadableStream<Uint8Array>({
      pull(controller) {
        stdoutPulls += 1;
        if (stdoutPulls === 1) {
          controller.enqueue(encoder.encode("Decoder format: h264\n"));
          return;
        }
        controller.error(new Error("stdout pipe reset"));
      },
    });
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const signals: Array<NodeJS.Signals | undefined> = [];
    let forceKill: (() => void) | undefined;
    let forceKillCancelled = false;

    const result = await finishMpvHwaccelProbeProcess(
      {
        stdout,
        stderr,
        exited: new Promise<number>(() => {}),
        kill(signal) {
          signals.push(signal);
        },
      },
      10_000,
      undefined,
      (kill) => {
        forceKill = kill;
        return {
          cancel: () => {
            forceKillCancelled = true;
          },
          unref: () => undefined,
        };
      },
    );

    expect(result).toMatchObject({
      exitCode: null,
      stdout: "Decoder format: h264\n",
      timedOut: false,
      spawnFailed: true,
      terminatedByProbe: true,
    });
    expect(signals).toEqual(["SIGTERM"]);
    expect(forceKillCancelled).toBe(false);
    forceKill?.();
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });
});

describe("probeMpvHardwareAcceleration", () => {
  test("runs a bounded help probe and compressed stdin sample probe", async () => {
    const fixture = createRunProcess();
    const result = await probeMpvHardwareAcceleration(depsFor(fixture.runProcess));

    expect(fixture.calls).toHaveLength(2);
    expect(fixture.calls[0]?.argv).toEqual(["mpv", "--no-config", "--hwdec=help"]);
    expect(fixture.calls[1]?.argv).toContain("--hwdec=auto-safe");
    expect(fixture.calls[1]?.argv.at(-1)).toBe("-");
    expect(fixture.calls[1]?.stdinLength).toBeGreaterThan(0);
    expect(fixture.calls[0]?.stopsAfterOutput).toBe(false);
    expect(fixture.calls[1]?.stopsAfterOutput).toBe(true);
    expect(result).toMatchObject({
      probed: true,
      autoSafeOk: true,
      autoSafeDriver: "nvdec-copy",
      status: "hardware",
      fromCache: false,
    });
  });

  test("returns mpv-not-found without spawning when discovery finds no mpv", async () => {
    const fixture = createRunProcess();
    const result = await probeMpvHardwareAcceleration(
      depsFor(fixture.runProcess, { which: () => null }),
    );

    expect(result.status).toBe("mpv-not-found");
    expect(result.probed).toBe(false);
    expect(fixture.calls).toHaveLength(0);
  });

  test("uses the Linux flatpak invocation when only flatpak mpv exists", async () => {
    const fixture = createRunProcess();
    const result = await probeMpvHardwareAcceleration(
      depsFor(fixture.runProcess, {
        which: (command) => (command === "flatpak" ? "/usr/bin/flatpak" : null),
        exists: (path) => path === "/var/lib/flatpak/app/io.mpv.Mpv",
        platform: "linux",
      }),
    );

    expect(fixture.calls[0]?.argv.slice(0, 3)).toEqual(["flatpak", "run", "io.mpv.Mpv"]);
    expect(result.status).toBe("hardware");
  });

  test("makes the same explicit PATH decision on macOS and Windows test doubles", async () => {
    for (const platform of ["darwin", "win32"] as const) {
      const fixture = createRunProcess();
      const result = await probeMpvHardwareAcceleration(
        depsFor(fixture.runProcess, {
          platform,
          which: (command) => (command === "mpv" ? `/mpv-on-${platform}` : null),
        }),
      );
      expect(fixture.calls[0]?.argv[0]).toBe("mpv");
      expect(result.status).toBe("hardware");
    }
  });

  test("a completed negative probe is disk-cached across calls", async () => {
    await withCacheFile(async (cacheFile) => {
      const fixture = createRunProcess({
        decode: {
          exitCode: 0,
          stdout: "",
          stderr: "software decoding only",
          timedOut: false,
        },
      });
      const deps = depsFor(fixture.runProcess, { cacheFile });

      const first = await probeMpvHardwareAcceleration(deps);
      const second = await probeMpvHardwareAcceleration(deps);

      expect(first.status).toBe("no-hardware");
      expect(first.autoSafeOk).toBe(false);
      expect(second).toMatchObject({ status: "no-hardware", fromCache: true, probed: true });
      expect(fixture.calls).toHaveLength(2);
    });
  });

  test("expired cache entries are refreshed instead of pinned forever", async () => {
    await withCacheFile(async (cacheFile) => {
      const fixture = createRunProcess();
      let now = 10_000;
      const deps = depsFor(fixture.runProcess, { cacheFile, now: () => now });

      await probeMpvHardwareAcceleration(deps);
      expect(fixture.calls).toHaveLength(2);
      now += MPV_HWACCEL_PROBE_CACHE_TTL_MS + 1;
      const refreshed = await probeMpvHardwareAcceleration(deps);

      expect(refreshed.fromCache).toBe(false);
      expect(fixture.calls).toHaveLength(4);
    });
  });

  test("timeout and spawn failure are not cached, so the next probe retries", async () => {
    await withCacheFile(async (cacheFile) => {
      const fixture = createRunProcess({
        decode: { exitCode: null, stdout: "", stderr: "", timedOut: true },
      });
      const deps = depsFor(fixture.runProcess, { cacheFile });

      const failed = await probeMpvHardwareAcceleration(deps);
      expect(failed.status).toBe("probe-failed");
      expect(fixture.calls).toHaveLength(2);

      fixture.setBehavior(successfulBehavior());
      const retried = await probeMpvHardwareAcceleration(deps);
      expect(retried.status).toBe("hardware");
      expect(fixture.calls).toHaveLength(4);
    });
  });

  test("probe-terminated decode evidence completes even when mpv does not exit cleanly", async () => {
    const fixture = createRunProcess({
      decode: {
        exitCode: null,
        stdout: "Using hardware decoding (nvdec-copy).\n[vd] Decoder format: 64x64 nv12",
        stderr: "",
        timedOut: true,
        terminatedByProbe: true,
      },
    });

    const result = await probeMpvHardwareAcceleration(depsFor(fixture.runProcess));

    expect(result).toMatchObject({
      probed: true,
      status: "hardware",
      autoSafeOk: true,
      autoSafeDriver: "nvdec-copy",
    });
  });

  test("probe-terminated software decode evidence is a cacheable negative result", async () => {
    await withCacheFile(async (cacheFile) => {
      const fixture = createRunProcess({
        decode: {
          exitCode: null,
          stdout: "[vd] Using software decoding.\n[vd] Decoder format: 64x64 yuv420p",
          stderr: "",
          timedOut: true,
          terminatedByProbe: true,
        },
      });
      const deps = depsFor(fixture.runProcess, { cacheFile });

      const first = await probeMpvHardwareAcceleration(deps);
      const second = await probeMpvHardwareAcceleration(deps);

      expect(first.status).toBe("no-hardware");
      expect(second).toMatchObject({ status: "no-hardware", fromCache: true });
      expect(fixture.calls).toHaveLength(2);
    });
  });

  test("malformed cache JSON is ignored as a cache miss", async () => {
    await withCacheFile(async (cacheFile) => {
      await writeFile(cacheFile, "not json", "utf8");
      const fixture = createRunProcess();
      const result = await probeMpvHardwareAcceleration(depsFor(fixture.runProcess, { cacheFile }));

      expect(result.status).toBe("hardware");
      expect(fixture.calls).toHaveLength(2);
    });
  });

  test("concurrent probes for the same mpv invocation join one in-flight pair of spawns", async () => {
    let releaseProbe!: () => void;
    let markBothStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const bothStarted = new Promise<void>((resolve) => {
      markBothStarted = resolve;
    });
    const fixture = createRunProcess();
    const gatedRunProcess: MpvHwaccelRunProcess = async (argv, options) => {
      const result = await fixture.runProcess(argv, options);
      if (fixture.calls.length === 2) markBothStarted();
      await gate;
      return result;
    };
    const deps = depsFor(gatedRunProcess);

    const first = probeMpvHardwareAcceleration(deps);
    const second = probeMpvHardwareAcceleration(deps);
    await bothStarted;
    expect(fixture.calls).toHaveLength(2);

    releaseProbe();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.status).toBe("hardware");
    expect(secondResult.status).toBe("hardware");
    expect(fixture.calls).toHaveLength(2);
  });

  test("the cache key includes platform and mpv invocation identity", async () => {
    await withCacheFile(async (cacheFile) => {
      const linuxFixture = createRunProcess();
      const linuxDeps = depsFor(linuxFixture.runProcess, { cacheFile, platform: "linux" });
      await probeMpvHardwareAcceleration(linuxDeps);
      expect(linuxFixture.calls).toHaveLength(2);

      const windowsFixture = createRunProcess();
      const windowsDeps = depsFor(windowsFixture.runProcess, { cacheFile, platform: "win32" });
      const windows = await probeMpvHardwareAcceleration(windowsDeps);
      expect(windows.fromCache).toBe(false);
      expect(windowsFixture.calls).toHaveLength(2);
    });
  });

  test("refreshCache bypasses a fresh disk entry for explicit diagnostics", async () => {
    await withCacheFile(async (cacheFile) => {
      const fixture = createRunProcess();
      const deps = depsFor(fixture.runProcess, { cacheFile });
      await probeMpvHardwareAcceleration(deps);
      expect(fixture.calls).toHaveLength(2);

      const refreshed = await probeMpvHardwareAcceleration({ ...deps, refreshCache: true });
      expect(refreshed.fromCache).toBe(false);
      expect(fixture.calls).toHaveLength(4);
    });
  });

  test("cache-only reads never spawn mpv", async () => {
    await withCacheFile(async (cacheFile) => {
      const fixture = createRunProcess();
      const deps = depsFor(fixture.runProcess, { cacheFile });

      expect((await readCachedMpvHardwareAcceleration(deps)).status).toBe("not-probed");
      expect(fixture.calls).toHaveLength(0);

      await probeMpvHardwareAcceleration(deps);
      const cached = await readCachedMpvHardwareAcceleration(deps);
      expect(cached).toMatchObject({ status: "hardware", fromCache: true });
      expect(fixture.calls).toHaveLength(2);
    });
  });
});
