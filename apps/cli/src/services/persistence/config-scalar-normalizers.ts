import type { ContinueSourcePreference } from "@/services/continuation/continuation-source";
import { DEFAULT_OFFLINE_RUNWAY_TARGET } from "@/services/download/StorageBudgetPolicy";
import {
  isHdrMode,
  isMpvHwdecMode,
  MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS,
  type PrePlayConfirmMode,
} from "@kunai/config";
import { isJsonString, type StartupPriority } from "@kunai/types";

import type { KitsuneConfig, RecoveryMode } from "./ConfigService";

/** Single-value config normalizers: an unknown or malformed value falls back to its default. */

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

export function normalizeHdrMode<T>(value: T): KitsuneConfig["hdrMode"] {
  return isHdrMode(value) ? value : "auto";
}

export function normalizeMpvHwdec<T>(value: T): KitsuneConfig["mpvHwdec"] {
  return isMpvHwdecMode(value) ? value : "mpv-default";
}

export function normalizeBytes<T>(value: T, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

export function normalizeRunwayTarget<T>(value: T): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_OFFLINE_RUNWAY_TARGET;
  return Math.max(1, Math.min(24, Math.trunc(value)));
}

export function normalizeMpvReconnectAttempts<T>(value: T): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS;
  }
  return Math.max(0, Math.min(MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS, Math.trunc(value)));
}

export function normalizeMaxConcurrentDownloads<T>(value: T): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.trunc(value)));
}

export function normalizeStringList<T>(values: T): readonly string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .filter(isJsonString)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

export function normalizeOptionalSecret<T>(value: T): string {
  return isJsonString(value) ? value.trim() : "";
}

export function normalizeVideasySessionExpiresAt<T, U>(value: T, token?: U): number {
  const expiresAt = typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  if (!normalizeOptionalSecret(token)) return 0;
  return isExpiredVideasySession(expiresAt) ? 0 : expiresAt;
}

export function isExpiredVideasySession(expiresAt: number): boolean {
  return expiresAt > 0 && expiresAt <= Date.now();
}

/** The closed-set modes in a config patch, normalized; a mode the patch omits stays omitted. */
export function normalizeModePatch(partial: Partial<KitsuneConfig>): Partial<KitsuneConfig> {
  return {
    ...(partial.recoveryMode !== undefined
      ? { recoveryMode: normalizeRecoveryMode(partial.recoveryMode) }
      : null),
    ...(partial.continueSourcePreference !== undefined
      ? {
          continueSourcePreference: normalizeContinueSourcePreference(
            partial.continueSourcePreference,
          ),
        }
      : null),
    ...(partial.prePlayConfirm !== undefined
      ? { prePlayConfirm: normalizePrePlayConfirm(partial.prePlayConfirm) }
      : null),
    ...(partial.startupPriority !== undefined
      ? { startupPriority: normalizeStartupPriority(partial.startupPriority) }
      : null),
    ...(partial.providerDns !== undefined
      ? { providerDns: normalizeProviderDns(partial.providerDns) }
      : null),
    ...(partial.hdrMode !== undefined ? { hdrMode: normalizeHdrMode(partial.hdrMode) } : null),
    ...(partial.mpvHwdec !== undefined ? { mpvHwdec: normalizeMpvHwdec(partial.mpvHwdec) } : null),
  };
}
