import type { StartupPriority } from "@kunai/types";

export function resolveProviderAttemptTimeoutMs(startupPriority: StartupPriority): number {
  switch (startupPriority) {
    case "fast":
      return 6_000;
    case "balanced":
      return 12_000;
    case "quality-first":
      return 30_000;
  }
}
