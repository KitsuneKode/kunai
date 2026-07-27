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

/**
 * How long the current candidate gets alone before the next one starts in
 * parallel. Sequential fallback spends the whole deadline on one slow provider:
 * on `balanced` a single candidate can eat 24s of a 45s budget, so the third
 * provider is effectively never reached.
 *
 * `quality-first` opts out. Hedging means the fastest responder wins rather
 * than the highest-ranked one, and a user on that profile has asked for their
 * provider order to be honoured over speed.
 */
export function resolveProviderHedgeDelayMs(startupPriority: StartupPriority): number {
  switch (startupPriority) {
    case "fast":
      return 2_500;
    case "balanced":
      return 5_000;
    case "quality-first":
      return 0;
  }
}
