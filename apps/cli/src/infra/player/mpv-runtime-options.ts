import type { MpvHwdec } from "@kunai/config";

export interface MpvRuntimeOptions {
  readonly debug?: boolean;
  readonly clean?: boolean;
  readonly noUserConfig?: boolean;
  readonly logFile?: string;
  /** When "fast", use lower demuxer readahead for quicker fail-over on dead CDNs. */
  readonly startupPriority?: "fast" | "balanced" | "quality-first";
  /** Hardware video decoding mode: "default" | "auto-safe" | "no" */
  readonly hwdec?: MpvHwdec;
}
