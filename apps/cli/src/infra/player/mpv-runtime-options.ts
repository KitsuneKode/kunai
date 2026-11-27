import type { HdrMode, MpvHwdecMode } from "@kunai/config";

export interface MpvRuntimeOptions {
  readonly debug?: boolean;
  readonly clean?: boolean;
  readonly noUserConfig?: boolean;
  readonly logFile?: string;
  /** When "fast", use lower demuxer readahead for quicker fail-over on dead CDNs. */
  readonly startupPriority?: "fast" | "balanced" | "quality-first";
  /** HDR / tone-mapping policy for mpv playback. */
  readonly hdrMode?: HdrMode;
  /**
   * Hardware-decode policy. `auto` emits `hwdecBackend` only when a bounded
   * probe proved one; `off` always emits `--hwdec=no`; mpv automatic and
   * explicit backend modes are forwarded verbatim.
   */
  readonly hwdecMode?: MpvHwdecMode;
  /** Exact mpv backend selected by the cached probe, including any `-copy` suffix. */
  readonly hwdecBackend?: string;
  /** True when the installed mpv binary advertises `vo=gpu-next` (probed once). */
  readonly supportsGpuNext?: boolean;
}
