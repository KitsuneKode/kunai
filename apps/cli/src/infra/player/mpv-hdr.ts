import type { HdrMode } from "@kunai/config";
import type { VideoDynamicRange } from "@kunai/types";

import type { MpvInvocation } from "./mpv-discovery";

export interface MpvHdrCapability {
  readonly supportsGpuNext: boolean;
  readonly probed: boolean;
}

export interface MpvHdrProbeDeps {
  readonly runHelp?: (
    argv: readonly string[],
  ) => Promise<{ readonly ok: boolean; readonly stdout: string }>;
}

export interface ResolveMpvHdrArgsInput {
  readonly hdrMode?: HdrMode;
  readonly streamDynamicRange?: VideoDynamicRange;
  readonly supportsGpuNext?: boolean;
}

const GPU_NEXT_PROBE_TIMEOUT_MS = 1_500;
const gpuNextCapabilityCache = new Map<string, MpvHdrCapability>();

export function isHdrDynamicRange(value: VideoDynamicRange | undefined): boolean {
  return value === "hdr10" || value === "hlg" || value === "dolby-vision";
}

export function formatDynamicRangeBadge(value: VideoDynamicRange | undefined): string | undefined {
  if (value === "dolby-vision") return "DV";
  if (value === "hdr10") return "HDR10";
  if (value === "hlg") return "HLG";
  return undefined;
}

export function parseMpvVoHelpSupportsGpuNext(stdout: string): boolean {
  return /^\s*gpu-next\b/im.test(stdout);
}

export function clearMpvHdrCapabilityCache(): void {
  gpuNextCapabilityCache.clear();
}

async function defaultRunVoHelp(
  argv: readonly string[],
): Promise<{ readonly ok: boolean; readonly stdout: string }> {
  try {
    const proc = Bun.spawn([...argv, "--vo=help"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Process already exited.
      }
    }, GPU_NEXT_PROBE_TIMEOUT_MS);
    try {
      const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      return { ok: code === 0, stdout };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, stdout: "" };
  }
}

/**
 * Probe whether the discovered `mpv` binary ships `vo=gpu-next` (libplacebo).
 * Cached per invocation prefix so subsequent episodes pay zero spawn cost, and
 * fail-closed to `false` so older `mpv` builds never crash on unsupported flags.
 */
export async function probeMpvHdrCapability(
  invocation: MpvInvocation | null,
  deps: MpvHdrProbeDeps = {},
): Promise<MpvHdrCapability> {
  if (!invocation) return { supportsGpuNext: false, probed: false };
  const cacheKey = invocation.argv.join("\0");
  if (!deps.runHelp) {
    const cached = gpuNextCapabilityCache.get(cacheKey);
    if (cached) return cached;
  }
  const runHelp = deps.runHelp ?? defaultRunVoHelp;
  const result = await runHelp(invocation.argv);
  const capability: MpvHdrCapability = {
    supportsGpuNext: result.ok && parseMpvVoHelpSupportsGpuNext(result.stdout),
    probed: result.ok,
  };
  if (!deps.runHelp) {
    gpuNextCapabilityCache.set(cacheKey, capability);
  }
  return capability;
}

/**
 * Pure mpv CLI argument builder for HDR playback.
 *
 * Flags exclusive to libplacebo / `gpu-next` (`--vo=gpu-next`,
 * `--target-colorspace-hint`, `--gamut-mapping-mode`) are emitted only when
 * `supportsGpuNext` is true so legacy `mpv` installs never abort at launch.
 */
export function resolveMpvHdrArgs(input: ResolveMpvHdrArgsInput): readonly string[] {
  const mode: HdrMode = input.hdrMode ?? "auto";
  const canGpuNext = input.supportsGpuNext === true;

  if (mode === "passthrough") {
    return canGpuNext
      ? ["--vo=gpu-next", "--target-colorspace-hint=yes", "--hdr-compute-peak=yes"]
      : ["--hdr-compute-peak=yes"];
  }

  if (mode === "tone-map") {
    return canGpuNext
      ? [
          "--vo=gpu-next",
          "--tone-mapping=bt.2446a",
          "--hdr-compute-peak=yes",
          "--gamut-mapping-mode=perceptual",
        ]
      : ["--tone-mapping=bt.2446a", "--hdr-compute-peak=yes"];
  }

  if (mode === "sdr-only") {
    return canGpuNext
      ? ["--target-colorspace-hint=no", "--tone-mapping=bt.2446a"]
      : ["--tone-mapping=bt.2446a"];
  }

  // "auto": stay silent for SDR/unknown streams to avoid overriding user mpv.conf,
  // and enable safe dynamic peak tone-mapping when an HDR/Dolby Vision stream is detected.
  if (isHdrDynamicRange(input.streamDynamicRange)) {
    return canGpuNext
      ? ["--vo=gpu-next", "--tone-mapping=auto", "--hdr-compute-peak=yes"]
      : ["--tone-mapping=auto", "--hdr-compute-peak=yes"];
  }

  return [];
}
