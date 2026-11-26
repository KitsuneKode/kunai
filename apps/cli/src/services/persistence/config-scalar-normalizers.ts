import type { ContinueSourcePreference } from "@/services/continuation/continuation-source";
import { DEFAULT_OFFLINE_RUNWAY_TARGET } from "@/services/download/StorageBudgetPolicy";
import {
  isHdrMode,
  MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS,
  type PrePlayConfirmMode,
} from "@kunai/config";
import type { StartupPriority } from "@kunai/types";

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

export function normalizeStartupPriority<T>(value: T): StartupPriority {
  return value === "fast" ? "fast" : value === "quality-first" ? "quality-first" : "balanced";
}

export function normalizeHdrMode<T>(value: T): KitsuneConfig["hdrMode"] {
  return isHdrMode(value) ? value : "auto";
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
