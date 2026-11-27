import { join } from "node:path";

import { createKeyedJoiner } from "@/infra/concurrency/keyed-joiner";
import { writeAtomicJson } from "@/infra/fs/atomic-write";
import { scrubbedChildEnv } from "@/infra/os/child-env";
import { getKunaiPaths } from "@kunai/storage";
import { z } from "zod";

import { discoverMpvInvocation, type MpvInvocation } from "./mpv-discovery";
import { registerMpvProcess } from "./mpv-process-registry";

/** Hardware decoder backends surfaced in doctor/setup copy. */
export const MPV_GPU_HW_DECODER_IDS = [
  "vaapi",
  "nvdec",
  "vdpau",
  "vulkan",
  "qsv",
  "videotoolbox",
  "d3d11va",
  "dxva2",
] as const;

export type MpvGpuHwDecoderId = (typeof MPV_GPU_HW_DECODER_IDS)[number];

export type MpvHwaccelProbeStatus =
  | "hardware"
  | "no-hardware"
  | "mpv-not-found"
  | "probe-failed"
  | "not-probed";

export type MpvHardwareAccelProbe = {
  /** Whether the auto-safe decode probe completed (live now or loaded from cache). */
  readonly probed: boolean;
  /** GPU-oriented decoder families advertised by `mpv --hwdec=help`. */
  readonly drivers: readonly MpvGpuHwDecoderId[];
  /** True only when the sample decode both completed and reported hardware decoding. */
  readonly autoSafeOk: boolean;
  /** Exact backend mpv reported, including `-copy` (for example `nvdec-copy`). */
  readonly autoSafeDriver: string;
  /** Coarse state doctor/setup can render without reinterpreting the raw fields. */
  readonly status: MpvHwaccelProbeStatus;
  /** Epoch ms when the probe completed; null when no completed probe is known. */
  readonly probedAt: number | null;
  /** Whether this result came from the cache rather than a fresh mpv spawn. */
  readonly fromCache: boolean;
};

export type MpvHwaccelProcessResult = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnFailed?: boolean;
  /** True when this runner killed mpv after evidence or at the bounded deadline. */
  readonly terminatedByProbe?: boolean;
};

export type MpvHwaccelRunProcess = (
  argv: readonly string[],
  options: {
    readonly stdin?: Uint8Array;
    readonly timeoutMs: number;
    /** Kill the process once decoded-frame evidence appears in either output stream. */
    readonly stopAfterOutput?: (output: string) => boolean;
  },
) => Promise<MpvHwaccelProcessResult>;

export type MpvHwaccelProbeDeps = {
  readonly which?: (command: string) => string | null;
  readonly exists?: (path: string) => boolean;
  readonly platform?: NodeJS.Platform;
  readonly homeDir?: string;
  readonly runProcess?: MpvHwaccelRunProcess;
  readonly now?: () => number;
  /** Test/diagnostic override. Null disables the disk cache for this call. */
  readonly cacheFile?: string | null;
  /** Ignore a fresh cache entry and probe mpv again. */
  readonly refreshCache?: boolean;
};

const HWDEC_HELP_TIMEOUT_MS = 1_500;
const HWDEC_DECODE_TIMEOUT_MS = 3_000;
const CACHE_VERSION = 1;
export const MPV_HWACCEL_PROBE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One-frame H.264 elementary stream generated with ffmpeg's black generator,
 * with the x264 user-data SEI removed. It is fed to mpv on stdin so the probe
 * needs no temporary media file and cannot read user paths. mpv probes raw
 * H.264 reliably from stdin, avoiding MP4 container overhead; its 64x64 width
 * stays inside the minimum frame width reported by common hardware decoders.
 */
const HWDEC_SAMPLE_H264_BASE64 =
  "AAAAAWdCwAraEJsBEAAAAwAQAAADAQjxImoAAAABaM4BNyAAAAFliIQ6JigACAXJycnXXXXXXXXXXXXg";

function hwdecSampleBytes(): Uint8Array {
  return Uint8Array.from(atob(HWDEC_SAMPLE_H264_BASE64), (char) => char.charCodeAt(0));
}

const cachedProbeSchema = z.object({
  version: z.literal(CACHE_VERSION),
  key: z.string(),
  probedAt: z.number().finite(),
  drivers: z.array(z.string()),
  autoSafeOk: z.boolean(),
  autoSafeDriver: z.string(),
});

type CachedProbe = z.infer<typeof cachedProbeSchema>;

const probeInFlight = createKeyedJoiner<MpvHardwareAccelProbe>({ whenAbandoned: "finish" });

export function emptyMpvHardwareAccelProbe(status: MpvHwaccelProbeStatus): MpvHardwareAccelProbe {
  return {
    probed: false,
    drivers: [],
    autoSafeOk: false,
    autoSafeDriver: "",
    status,
    probedAt: null,
    fromCache: false,
  };
}

function probeKey(invocation: MpvInvocation, platform: NodeJS.Platform): string {
  return `${platform}\0${invocation.argv.join("\0")}`;
}

function defaultCacheFile(): string {
  return join(getKunaiPaths().cacheDir, "mpv-hwaccel-probe.json");
}

function cacheFileFor(deps: MpvHwaccelProbeDeps): string | null {
  if (deps.cacheFile === null) return null;
  return deps.cacheFile ?? defaultCacheFile();
}

function fresh(entry: CachedProbe, key: string, now: number): boolean {
  return (
    entry.version === CACHE_VERSION &&
    entry.key === key &&
    Number.isFinite(entry.probedAt) &&
    now - entry.probedAt >= 0 &&
    now - entry.probedAt < MPV_HWACCEL_PROBE_CACHE_TTL_MS
  );
}

function probeFromCache(entry: CachedProbe): MpvHardwareAccelProbe {
  const drivers = MPV_GPU_HW_DECODER_IDS.filter((id) => entry.drivers.includes(id));
  const autoSafeDriver = entry.autoSafeDriver;
  const autoSafeOk = entry.autoSafeOk && autoSafeDriver.length > 0;
  return {
    probed: true,
    drivers,
    autoSafeOk,
    autoSafeDriver: autoSafeOk ? autoSafeDriver : "",
    status: autoSafeOk ? "hardware" : "no-hardware",
    probedAt: entry.probedAt,
    fromCache: true,
  };
}

async function readDiskCache(
  cacheFile: string | null,
  key: string,
  now: number,
): Promise<MpvHardwareAccelProbe | null> {
  if (!cacheFile) return null;
  try {
    const raw: unknown = JSON.parse(await Bun.file(cacheFile).text());
    const parsed = cachedProbeSchema.safeParse(raw);
    if (!parsed.success) return null;
    return fresh(parsed.data, key, now) ? probeFromCache(parsed.data) : null;
  } catch {
    return null;
  }
}

async function writeDiskCache(
  cacheFile: string | null,
  key: string,
  result: MpvHardwareAccelProbe,
): Promise<void> {
  if (!cacheFile || !result.probed || result.probedAt === null) return;
  try {
    await writeAtomicJson(cacheFile, {
      version: CACHE_VERSION,
      key,
      probedAt: result.probedAt,
      drivers: [...result.drivers],
      autoSafeOk: result.autoSafeOk,
      autoSafeDriver: result.autoSafeDriver,
    } satisfies CachedProbe);
  } catch {
    // A cache write must never make playback or doctor fail.
  }
}

type MpvHwaccelForceKillTimer = {
  readonly cancel: () => void;
  readonly unref?: () => void;
};

export type MpvHwaccelForceKillScheduler = (kill: () => void) => MpvHwaccelForceKillTimer;

const defaultForceKillScheduler: MpvHwaccelForceKillScheduler = (kill) => {
  const timer = setTimeout(kill, 150);
  return {
    cancel: () => clearTimeout(timer),
    unref: () => timer.unref?.(),
  };
};

type MpvHwaccelProcessIo = {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  kill(signal?: NodeJS.Signals): void;
};

async function readProcessStream(
  stream: ReadableStream<Uint8Array>,
  onOutput: (output: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
      onOutput(output);
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function finishMpvHwaccelProbeProcess(
  proc: MpvHwaccelProcessIo,
  timeoutMs: number,
  stopAfterOutput?: (output: string) => boolean,
  scheduleForceKill: MpvHwaccelForceKillScheduler = defaultForceKillScheduler,
): Promise<MpvHwaccelProcessResult> {
  let stdout = "";
  let stderr = "";
  let terminatedByProbe = false;
  let stoppedForOutput = false;
  let forceKillTimer: MpvHwaccelForceKillTimer | undefined;
  let processExited = false;
  let evidenceResolve: (() => void) | undefined;
  const evidenceSeen = new Promise<void>((resolve) => {
    evidenceResolve = resolve;
  });

  const terminate = () => {
    if (terminatedByProbe || processExited) return;
    terminatedByProbe = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      // Already exited.
    }
    // A probe child must never become an orphaned decoder process. Give mpv a
    // short chance to close its demuxer, then force the bounded probe closed.
    forceKillTimer = scheduleForceKill(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    });
    forceKillTimer.unref?.();
  };
  const clearForceKill = () => {
    forceKillTimer?.cancel();
    forceKillTimer = undefined;
  };
  void proc.exited.then(
    () => {
      processExited = true;
      clearForceKill();
      return null;
    },
    () => null,
  );
  const noteOutput = (stream: "stdout" | "stderr") => {
    return (output: string) => {
      if (stream === "stdout") stdout = output;
      else stderr = output;
      if (
        stoppedForOutput ||
        !stopAfterOutput?.(`${stdout}
${stderr}`)
      )
        return;
      stoppedForOutput = true;
      terminate();
      evidenceResolve?.();
    };
  };

  const completed = (async (): Promise<MpvHwaccelProcessResult> => {
    try {
      const [out, err, exitCode] = await Promise.all([
        readProcessStream(proc.stdout, noteOutput("stdout")),
        readProcessStream(proc.stderr, noteOutput("stderr")),
        proc.exited,
      ]);
      stdout = out;
      stderr = err;
      clearForceKill();
      return { exitCode, stdout, stderr, timedOut: false, terminatedByProbe };
    } catch {
      terminate();
      return {
        exitCode: null,
        stdout,
        stderr,
        timedOut: false,
        spawnFailed: true,
        terminatedByProbe,
      };
    }
  })();
  // The returned race can finish before the reader/exit promise (evidence and
  // timeout both do that deliberately); attach a noop rejection handler so the
  // background completion can never surface as an unhandled rejection.
  void completed.catch(() => {});

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<MpvHwaccelProcessResult>((resolve) => {
    deadlineTimer = setTimeout(() => {
      terminate();
      resolve({ exitCode: null, stdout, stderr, timedOut: true, terminatedByProbe });
    }, timeoutMs);
  });
  void deadline.catch(() => {});

  const evidence = evidenceSeen.then((): MpvHwaccelProcessResult => ({
    exitCode: null,
    stdout,
    stderr,
    timedOut: false,
    terminatedByProbe,
  }));

  try {
    return await Promise.race([completed, deadline, evidence]);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

function spawnFailure(): MpvHwaccelProcessResult {
  return { exitCode: null, stdout: "", stderr: "", timedOut: false, spawnFailed: true };
}

async function defaultRunProcess(
  argv: readonly string[],
  options: {
    readonly stdin?: Uint8Array;
    readonly timeoutMs: number;
    readonly stopAfterOutput?: (output: string) => boolean;
  },
): Promise<MpvHwaccelProcessResult> {
  if (options.stdin) {
    let proc;
    try {
      proc = Bun.spawn([...argv], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: scrubbedChildEnv(),
      });
    } catch {
      return spawnFailure();
    }
    const unregister = registerMpvProcess(proc);
    void proc.exited.then(unregister, unregister);
    try {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    } catch {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Already exited.
      }
      return spawnFailure();
    }
    return finishMpvHwaccelProbeProcess(proc, options.timeoutMs, options.stopAfterOutput);
  }

  try {
    const proc = Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: scrubbedChildEnv(),
    });
    const unregister = registerMpvProcess(proc);
    void proc.exited.then(unregister, unregister);
    return await finishMpvHwaccelProbeProcess(proc, options.timeoutMs, options.stopAfterOutput);
  } catch {
    return spawnFailure();
  }
}

export function parseGpuDriversFromHwdecHelp(text: string): MpvGpuHwDecoderId[] {
  const lower = text.toLowerCase();
  return MPV_GPU_HW_DECODER_IDS.filter((id) => lower.includes(id));
}

/** mpv reports lines such as `Using hardware decoding (nvdec-copy).` while decoding. */
export function parseAutoSafeDriver(output: string): string {
  const match = /hardware decoding\s*\(([^)]+)\)/i.exec(output);
  return match?.[1]?.trim().toLowerCase() ?? "";
}

function decodedFrameEvidence(output: string): boolean {
  return /decoder format:/i.test(output);
}

function invocationFor(deps: MpvHwaccelProbeDeps): MpvInvocation | null {
  return discoverMpvInvocation({
    which: deps.which,
    exists: deps.exists,
    platform: deps.platform,
    homeDir: deps.homeDir,
  });
}

async function runFreshProbe(
  invocation: MpvInvocation,
  deps: MpvHwaccelProbeDeps,
): Promise<MpvHardwareAccelProbe> {
  const runProcess = deps.runProcess ?? defaultRunProcess;
  const [help, decode] = await Promise.all([
    runProcess([...invocation.argv, "--no-config", "--hwdec=help"], {
      timeoutMs: HWDEC_HELP_TIMEOUT_MS,
    }),
    runProcess(
      [
        ...invocation.argv,
        "--no-config",
        "--idle=no",
        "--vo=null",
        "--ao=null",
        "--keep-open=no",
        "--hwdec=auto-safe",
        "--msg-level=all=no,vd=v",
        "-",
      ],
      {
        stdin: hwdecSampleBytes(),
        timeoutMs: HWDEC_DECODE_TIMEOUT_MS,
        stopAfterOutput: decodedFrameEvidence,
      },
    ),
  ]);

  // mpv routes these vd lines to stdout on some builds and stderr on others;
  // the stream choice is incidental, the decoder evidence is not.
  const decodeOutput = `${decode.stdout}\n${decode.stderr}`;
  const helpCompleted = !help.timedOut && !help.spawnFailed && help.exitCode !== null;
  const decodeCompleted =
    !decode.spawnFailed &&
    ((!decode.timedOut && decode.exitCode === 0) ||
      (decode.terminatedByProbe === true && decodedFrameEvidence(decodeOutput)));
  if (!helpCompleted || !decodeCompleted) return emptyMpvHardwareAccelProbe("probe-failed");

  const drivers = parseGpuDriversFromHwdecHelp(`${help.stdout}\n${help.stderr}`);
  const autoSafeDriver = parseAutoSafeDriver(decodeOutput);
  const autoSafeOk = autoSafeDriver.length > 0;
  const probedAt = (deps.now ?? Date.now)();
  return {
    probed: true,
    drivers,
    autoSafeOk,
    autoSafeDriver: autoSafeOk ? autoSafeDriver : "",
    status: autoSafeOk ? "hardware" : "no-hardware",
    probedAt,
    fromCache: false,
  };
}

/**
 * Probe mpv's hardware decode path once, then cache the completed result in
 * the OS cache directory. Concurrent callers join one in-flight probe. Failed or timed-out spawns are deliberately not
 * cached: a transient GPU/driver failure must not disable hardware decoding
 * for the cache lifetime. The probe is async and is only invoked on playback
 * or explicit diagnostics, never during CLI startup.
 */
export async function probeMpvHardwareAcceleration(
  deps: MpvHwaccelProbeDeps = {},
): Promise<MpvHardwareAccelProbe> {
  const invocation = invocationFor(deps);
  if (!invocation) return emptyMpvHardwareAccelProbe("mpv-not-found");

  const platform = deps.platform ?? process.platform;
  const key = probeKey(invocation, platform);
  const now = (deps.now ?? Date.now)();
  if (!deps.refreshCache) {
    const diskHit = await readDiskCache(cacheFileFor(deps), key, now);
    if (diskHit) return diskHit;
  }

  return probeInFlight.join(key, async () => {
    try {
      const result = await runFreshProbe(invocation, deps);
      if (result.probed) await writeDiskCache(cacheFileFor(deps), key, result);
      return result;
    } catch {
      return emptyMpvHardwareAccelProbe("probe-failed");
    }
  });
}

/**
 * Read only the disk cache. This never spawns mpv, so setup/startup
 * surfaces can show a prior result without paying or blocking for a probe.
 */
export async function readCachedMpvHardwareAcceleration(
  deps: MpvHwaccelProbeDeps = {},
): Promise<MpvHardwareAccelProbe> {
  const invocation = invocationFor(deps);
  if (!invocation) return emptyMpvHardwareAccelProbe("mpv-not-found");
  const key = probeKey(invocation, deps.platform ?? process.platform);
  const now = (deps.now ?? Date.now)();
  return (
    (await readDiskCache(cacheFileFor(deps), key, now)) ?? emptyMpvHardwareAccelProbe("not-probed")
  );
}
