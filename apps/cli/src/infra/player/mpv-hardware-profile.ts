import os from "node:os";

/**
 * Host capability for decode-heavy playback. "low-spec" is deliberately
 * conservative — it exists to keep playback watchable on weak hardware, not
 * to label machines: software-decoding a 1080p+ stream on a dual-core box or a
 * 4 GB host stutters hard enough for the stall watchdog to fire `no-progress`,
 * and without a ceiling the ytdl selector happily picks a 4K format the CPU
 * cannot decode in realtime.
 */
export type MpvHardwareProfile = "standard" | "low-spec";

const LOW_SPEC_MAX_CORES = 2;
const LOW_SPEC_MAX_MEMORY_BYTES = 4 * 1024 * 1024 * 1024;

export function hardwareProfileFor(spec: {
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
  readonly arch: string;
}): MpvHardwareProfile {
  if (spec.arch === "ia32" || spec.arch === "arm") return "low-spec";
  if (spec.cpuCount > 0 && spec.cpuCount <= LOW_SPEC_MAX_CORES) return "low-spec";
  if (spec.totalMemoryBytes > 0 && spec.totalMemoryBytes <= LOW_SPEC_MAX_MEMORY_BYTES) {
    return "low-spec";
  }
  return "standard";
}

let cached: MpvHardwareProfile | undefined;

/** Process-lifetime memo: cores/RAM/arch do not change under a running CLI. */
export function detectHardwareProfile(): MpvHardwareProfile {
  if (cached === undefined) {
    cached = hardwareProfileFor({
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      arch: os.arch(),
    });
  }
  return cached;
}

/** The yt-dlp selector when the host cannot decode past ~720p in software. */
export const LOW_SPEC_YTDL_FORMAT = "bv*[height<=720]+ba/b[height<=720]/ba";

/** HLS variant cap for low-spec hosts — roughly 720p bitrates (~2.5 Mbps). */
export const LOW_SPEC_HLS_BITRATE = "2500000";
