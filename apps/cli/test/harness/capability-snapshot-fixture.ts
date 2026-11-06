import { emptyMpvHardwareAccelProbe } from "@/infra/player/mpv-hwaccel-probe";
import type { CapabilitySnapshot } from "@/ui";

const DEFAULT_IMAGE = {
  terminal: "unknown" as const,
  protocol: "none" as const,
  renderer: "none" as const,
  available: false,
  reason: "test fixture",
};

/** Canonical `mpvHardwareAccel` for mocked snapshots (no real mpv spawn). */
export function capabilitySnapshotFixture(
  overrides: Partial<CapabilitySnapshot> = {},
): CapabilitySnapshot {
  const image = overrides.image ?? DEFAULT_IMAGE;
  return {
    mpv: true,
    mpvRequired: true,
    ffprobe: true,
    ytDlp: true,
    curl: { present: true, impersonates: true, profile: "chrome150" },
    image,
    mpvHardwareAccel: emptyMpvHardwareAccelProbe(image),
    issues: [],
    ...overrides,
  };
}
