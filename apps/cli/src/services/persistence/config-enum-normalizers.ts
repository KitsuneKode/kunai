import type { ContinueSourcePreference } from "@/services/continuation/continuation-source";
import type { PrePlayConfirmMode } from "@kunai/config";
import type { StartupPriority } from "@kunai/types";

import type { RecoveryMode } from "./ConfigService";

/**
 * Closed-set config values read back from disk: anything unrecognised becomes
 * the default rather than reaching the runtime as an unknown mode.
 */

export function normalizeRecoveryMode<T>(value: T): RecoveryMode {
  return value === "manual" ? "manual" : value === "fallback-first" ? "fallback-first" : "guided";
}

export function normalizeContinueSourcePreference<T>(value: T): ContinueSourcePreference {
  return value === "local"
    ? "local"
    : value === "stream"
      ? "stream"
      : value === "ask"
        ? "ask"
        : "auto";
}

export function normalizePrePlayConfirm<T>(value: T): PrePlayConfirmMode {
  return value === "when-choices" ? "when-choices" : value === "always" ? "always" : "off";
}

/** Anything but an explicit "system" keeps the default, so a typo never disables the fix. */
export function normalizeProviderDns<T>(value: T): "doh" | "system" {
  return value === "system" ? "system" : "doh";
}

export function normalizeStartupPriority<T>(value: T): StartupPriority {
  return value === "fast" ? "fast" : value === "quality-first" ? "quality-first" : "balanced";
}
