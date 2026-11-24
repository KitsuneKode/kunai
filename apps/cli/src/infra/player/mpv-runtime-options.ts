import type { HdrMode } from "@kunai/config";

export interface MpvRuntimeOptions {
  readonly debug?: boolean;
  readonly clean?: boolean;
  readonly noUserConfig?: boolean;
  readonly logFile?: string;
  /** When "fast", use lower demuxer readahead for quicker fail-over on dead CDNs. */
  readonly startupPriority?: "fast" | "balanced" | "quality-first";
  /** HDR / tone-mapping policy for mpv playback. */
  readonly hdrMode?: HdrMode;
  /** True when the installed mpv binary advertises `vo=gpu-next` (probed once). */
  readonly supportsGpuNext?: boolean;
}
