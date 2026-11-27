import type { Logger } from "@/infra/logger/Logger";
import type { ConfigService } from "@/services/persistence/ConfigService";

import {
  probeMpvHardwareAcceleration,
  readCachedMpvHardwareAcceleration,
  type MpvHardwareAccelProbe,
} from "./mpv-hwaccel-probe";
import type { MpvRuntimeOptions } from "./mpv-runtime-options";

type HardwareProbeDeps = {
  readonly logger: Logger;
  readonly mpv?: MpvRuntimeOptions;
  readonly readCachedMpvHwdec?: () => Promise<MpvHardwareAccelProbe>;
  readonly probeMpvHwdec?: () => Promise<MpvHardwareAccelProbe>;
};

/**
 * Launch-time hardware decode policy. The probe is never part of the launch
 * critical path: `auto` consumes validated disk evidence and a miss is warmed
 * in the background for a later mpv process.
 */
export class MpvHwdecPolicy {
  private probeResult: Promise<MpvHardwareAccelProbe> | null = null;

  constructor(private readonly deps: HardwareProbeDeps) {}

  private warmProbeInBackground(): void {
    // Playback never waits for this promise. The probe itself joins concurrent
    // callers and writes only completed results; a transient failure therefore
    // costs at most one background probe per app session, not one per launch.
    if (this.probeResult) return;
    const probe = (this.deps.probeMpvHwdec ?? probeMpvHardwareAcceleration)();
    this.probeResult = probe;
    void probe.catch(() => {
      if (this.probeResult === probe) this.probeResult = null;
    });
  }

  /**
   * Probe-guided `auto` reads only the validated disk cache synchronously with
   * launch preparation. A proven hardware result emits `auto-safe`, deliberately
   * not the null-VO probe's exact backend, so mpv re-picks direct vs copy-back
   * decoding against the real video output.
   */
  async runtimeOptions(config: ConfigService): Promise<MpvRuntimeOptions> {
    const options: MpvRuntimeOptions = {
      ...this.deps.mpv,
      startupPriority: config.startupPriority,
      hdrMode: config.hdrMode,
      hwdecMode: config.mpvHwdec,
    };
    let probedHwdecBackend: "auto-safe" | undefined;
    if (options.hwdecMode === "auto") {
      try {
        const probe = await (this.deps.readCachedMpvHwdec ?? readCachedMpvHardwareAcceleration)();
        if (probe.autoSafeOk) {
          probedHwdecBackend = "auto-safe";
        } else if (probe.status === "not-probed" || probe.status === "probe-failed") {
          this.warmProbeInBackground();
        }
      } catch {
        // Cache/probing is best-effort; playback falls back to mpv defaults.
        this.warmProbeInBackground();
      }
    }
    const resolved: MpvRuntimeOptions =
      probedHwdecBackend === undefined ? options : { ...options, hwdecBackend: probedHwdecBackend };
    const emittedHwdec =
      resolved.hwdecMode === "off"
        ? "no"
        : resolved.hwdecMode === "mpv-default"
          ? null
          : (resolved.hwdecBackend ?? (resolved.hwdecMode === "auto" ? null : resolved.hwdecMode));
    this.deps.logger.debug("Resolved MPV hardware decode policy", {
      configuredMode: resolved.hwdecMode,
      emittedHwdec,
      probeCacheUsed: resolved.hwdecMode === "auto" && resolved.hwdecBackend === "auto-safe",
    });
    return resolved;
  }
}
