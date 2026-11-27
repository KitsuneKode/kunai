import { join } from "node:path";

import { createKeyedJoiner } from "@/infra/concurrency/keyed-joiner";
import { writeAtomicJson } from "@/infra/fs/atomic-write";
import { scrubbedChildEnv } from "@/infra/os/child-env";
import { getKunaiPaths } from "@kunai/storage";
import { z } from "zod";

import { discoverMpvInvocation, type MpvInvocation } from "./mpv-discovery";

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
};

export type MpvHwaccelRunProcess = (
  argv: readonly string[],
  options: { readonly stdin?: Uint8Array; readonly timeoutMs: number },
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
 * Four-frame H.264/MP4 sample generated with ffmpeg's testsrc2. It is fed to
 * mpv on stdin so the probe needs no temporary media file and cannot read user
 * paths. The file is small, but still compressed: uncompressed lavfi video does
 * not exercise a hardware decoder at all.
 */
const HWDEC_SAMPLE_MP4_BASE64 =
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAABhxtZGF0AAACrQYF//+p3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTIgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTggc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAL9ZYiEAEfkgEEz6/+EbANZsGTixeAw2rXKkDEEtM6genNGMbcMWWJM6PMx5RUqqtc3j2IUcYxTcV5vNL/MwhVxhcB8ZsNiPcImnjeIgwbupPj2NLqo4h+iZJ1gtZDi5IwJBEdr/bBfn2iO/RCxYXDYiSJ/o21lI2FnneQzliqorWSqdCQQT3VZOVZqDSguP9Q/YlwXAw9CrHjNm5+CML1C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";

function hwdecSampleBytes(): Uint8Array {
  return Uint8Array.from(atob(HWDEC_SAMPLE_MP4_BASE64), (char) => char.charCodeAt(0));
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

function emptyProbe(status: MpvHwaccelProbeStatus): MpvHardwareAccelProbe {
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

type MpvHwaccelProcessIo = {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  kill(): void;
};

async function finishProcess(
  proc: MpvHwaccelProcessIo,
  timeoutMs: number,
): Promise<MpvHwaccelProcessResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<MpvHwaccelProcessResult>((resolve) => {
    timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Already exited.
      }
      resolve({ exitCode: null, stdout: "", stderr: "", timedOut: true });
    }, timeoutMs);
  });

  const completed = (async (): Promise<MpvHwaccelProcessResult> => {
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { exitCode, stdout, stderr, timedOut: false };
    } catch {
      return { exitCode: null, stdout: "", stderr: "", timedOut: false, spawnFailed: true };
    }
  })();

  try {
    return await Promise.race([completed, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function spawnFailure(): MpvHwaccelProcessResult {
  return { exitCode: null, stdout: "", stderr: "", timedOut: false, spawnFailed: true };
}

async function defaultRunProcess(
  argv: readonly string[],
  options: { readonly stdin?: Uint8Array; readonly timeoutMs: number },
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
    try {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    } catch {
      try {
        proc.kill();
      } catch {
        // Already exited.
      }
      return spawnFailure();
    }
    return finishProcess(proc, options.timeoutMs);
  }

  try {
    const proc = Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: scrubbedChildEnv(),
    });
    return await finishProcess(proc, options.timeoutMs);
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
      { stdin: hwdecSampleBytes(), timeoutMs: HWDEC_DECODE_TIMEOUT_MS },
    ),
  ]);

  const helpCompleted = !help.timedOut && !help.spawnFailed && help.exitCode !== null;
  const decodeCompleted = !decode.timedOut && !decode.spawnFailed && decode.exitCode !== null;
  if (!helpCompleted || !decodeCompleted) return emptyProbe("probe-failed");

  const drivers = parseGpuDriversFromHwdecHelp(`${help.stdout}\n${help.stderr}`);
  // mpv routes these vd lines to stdout on some builds and stderr on others;
  // the stream choice is incidental, the "Using hardware decoding" line is not.
  const autoSafeDriver = parseAutoSafeDriver(`${decode.stdout}\n${decode.stderr}`);
  const autoSafeOk = decode.exitCode === 0 && autoSafeDriver.length > 0;
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
  if (!invocation) return emptyProbe("mpv-not-found");

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
      return emptyProbe("probe-failed");
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
  if (!invocation) return emptyProbe("mpv-not-found");
  const key = probeKey(invocation, deps.platform ?? process.platform);
  const now = (deps.now ?? Date.now)();
  return (await readDiskCache(cacheFileFor(deps), key, now)) ?? emptyProbe("not-probed");
}
