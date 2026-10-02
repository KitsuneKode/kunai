import type { MpvHardwareProfile } from "./mpv-hardware-profile";

export interface MpvRuntimeOptions {
  readonly debug?: boolean;
  readonly clean?: boolean;
  readonly noUserConfig?: boolean;
  readonly logFile?: string;
  /** When "fast", use lower demuxer readahead for quicker fail-over on dead CDNs. */
  readonly startupPriority?: "fast" | "balanced" | "quality-first";
  /**
   * "low-spec" turns on hwdec=auto-safe and caps the ytdl/HLS picks so a weak
   * host is not asked to software-decode a stream it cannot keep up with.
   */
  readonly hardwareProfile?: MpvHardwareProfile;
}
