import type { CapabilitySnapshot } from "@/ui";
import type { MpvHwdecMode } from "@kunai/config";

/** Resolve the exact `--hwdec` value playback will emit; null means no Kunai override. */
export function mpvHwdecEmittedFor(
  mode: MpvHwdecMode,
  hw: CapabilitySnapshot["mpvHardwareAccel"],
): string | null {
  if (mode === "mpv-default") return null;
  if (mode === "off") return "no";
  if (mode === "auto") return hw.autoSafeOk ? "auto-safe" : null;
  return mode;
}

export function describeMpvHwaccel(hw: CapabilitySnapshot["mpvHardwareAccel"]): string {
  const cached = hw.fromCache ? " · cached" : "";
  const listed = hw.drivers.length ? ` · help lists ${hw.drivers.join(", ")}` : "";
  switch (hw.status) {
    case "hardware":
      return `auto-safe ok (${hw.autoSafeDriver})${cached}${listed}`;
    case "no-hardware":
      return `no usable auto-safe path${cached}${listed || " · no GPU decoders in help"}`;
    case "probe-failed":
      return `probe failed or timed out${listed}`;
    case "mpv-not-found":
      return "skipped — mpv not found";
    case "not-probed":
      return "not probed yet";
  }
}
