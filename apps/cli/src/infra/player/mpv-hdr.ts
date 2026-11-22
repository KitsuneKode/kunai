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
  /** Capability cache. Defaults to the process cache unless `runHelp` is injected. */
  readonly cache?: Map<string, MpvHdrCapability>;
}

export interface ResolveMpvHdrArgsInput {
  readonly hdrMode?: HdrMode;
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
    // --no-config: the probe only lists video outputs; it must not load the
    // user's mpv.conf or scripts (slow, and a config error would read as "no gpu-next").
    const proc = Bun.spawn([...argv, "--no-config", "--vo=help"], {
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
  const cache = deps.cache ?? (deps.runHelp ? null : gpuNextCapabilityCache);
  const cached = cache?.get(cacheKey);
  if (cached) return cached;
  const runHelp = deps.runHelp ?? defaultRunVoHelp;
  const result = await runHelp(invocation.argv);
  const capability: MpvHdrCapability = {
    supportsGpuNext: result.ok && parseMpvVoHelpSupportsGpuNext(result.stdout),
    probed: result.ok,
  };
  // Cache only a probe that completed. A timeout or spawn failure (a cold flatpak
  // start can exceed the deadline) would otherwise pin gpu-next off for the whole
  // process; the next launch retries instead.
  if (cache && capability.probed) {
    cache.set(cacheKey, capability);
  }
  return capability;
}

/**
 * Pure mpv CLI argument builder for HDR playback.
 *
 * - `auto` emits nothing. mpv already tone-maps HDR on SDR displays, and a
 *   forced `--vo` would override the user's `mpv.conf` and can leave a host
 *   whose gpu-next cannot initialise (no Vulkan, no MoltenVK) with no video.
 *   That also keeps a reused persistent mpv correct across SDR/HDR episodes.
 * - Explicit modes use libplacebo options only when the probe found
 *   `vo=gpu-next` (mpv >= 0.35). Without it, only `--hdr-compute-peak` is sent:
 *   older builds reject `--tone-mapping=bt.2446a` as a fatal option error.
 * - `--gamut-mapping-mode` is left at mpv's default (perceptual since 0.36);
 *   naming a value 0.35 does not know would abort launch.
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
          "--target-colorspace-hint=no",
          "--tone-mapping=bt.2446a",
          "--hdr-compute-peak=yes",
        ]
      : ["--hdr-compute-peak=yes"];
  }

  if (mode === "sdr-only") {
    return canGpuNext ? ["--target-colorspace-hint=no", "--tone-mapping=bt.2446a"] : [];
  }

  return [];
}

/**
 * A reused persistent mpv keeps the HDR options it was launched with, and
 * `--vo` cannot change on `loadfile`. When the HDR mode changed since launch
 * (Settings mid-chain), the next file needs a fresh mpv.
 */
export function hdrModeRequiresPlayerRestart(
  launchedWith: HdrMode | undefined,
  current: HdrMode | undefined,
): boolean {
  return (launchedWith ?? "auto") !== (current ?? "auto");
}
