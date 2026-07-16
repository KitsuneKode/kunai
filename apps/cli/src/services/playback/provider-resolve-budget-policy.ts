import type { StartupPriority } from "@kunai/types";

// These caps bound sequential provider fan-out. They are intentionally centralized so
// startup profiles cannot drift across engine retries and the outer resolve deadline.
const TOTAL_RESOLVE_DEADLINE_MS: Record<StartupPriority, number> = {
  fast: 15_000,
  balanced: 45_000,
  "quality-first": 120_000,
};

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

export function resolveProviderMaxAttempts(startupPriority: StartupPriority): number {
  switch (startupPriority) {
    case "fast":
      return 1;
    case "balanced":
      return 2;
    case "quality-first":
      return 3;
  }
}

export function resolveProviderTotalDeadlineMs(startupPriority: StartupPriority): number {
  return TOTAL_RESOLVE_DEADLINE_MS[startupPriority];
}
