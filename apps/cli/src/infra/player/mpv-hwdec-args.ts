import type { MpvRuntimeOptions } from "./mpv-runtime-options";

/**
 * mpv argv for the configured hardware-decode policy.
 *
 * The mode union is closed mpv vocabulary, so each result is one safe argv
 * token rather than a user-controlled option string. `mpv-default` emits no
 * token at all, preserving mpv.conf and mpv's own automatic negotiation.
 */
export function mpvHwdecArgs(
  config: Pick<MpvRuntimeOptions, "hwdecMode" | "hwdecBackend"> | undefined,
): string[] {
  if (config?.hwdecMode === "off") return ["--hwdec=no"];
  if (config?.hwdecMode === "auto") {
    // The probe is only a yes/no gate; the real video output re-picks the
    // direct or copy-back backend for mpv's automatic safe policy.
    return config.hwdecBackend ? [`--hwdec=${config.hwdecBackend}`] : [];
  }
  return config?.hwdecMode && config.hwdecMode !== "mpv-default"
    ? [`--hwdec=${config.hwdecMode}`]
    : [];
}
