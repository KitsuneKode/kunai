import type { StartupPriority } from "@kunai/types";

export function resolveProviderAttemptTimeoutMs(startupPriority: StartupPriority): number {
  switch (startupPriority) {
    case "fast":
      return 90_000;
    case "balanced":
    case "quality-first":
      return 300_000;
  }
}
