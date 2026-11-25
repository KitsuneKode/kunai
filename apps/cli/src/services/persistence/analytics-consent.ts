import type { KitsuneConfig, PersistedAnalyticsConsent } from "./ConfigService";

/**
 * Configs written before explicit consent had no notice marker. Their enabled
 * value was opt-out state, not evidence of a current opt-in, so it reads as
 * `unset` and the old local identifier is erased before anything can send.
 */
export function predatesExplicitAnalyticsConsent(loaded: Partial<KitsuneConfig>): boolean {
  return loaded.analytics === "enabled" && typeof loaded.analyticsNoticeShown !== "boolean";
}

/**
 * The consent and install id a config.json document grants. One reading for
 * startup and for the pre-send re-check, so the two cannot disagree about what
 * the file allows: an id only exists alongside an explicit `enabled`.
 */
export function persistedAnalyticsConsent(
  loaded: Partial<KitsuneConfig>,
): PersistedAnalyticsConsent {
  const analytics = predatesExplicitAnalyticsConsent(loaded)
    ? "unset"
    : normalizeAnalyticsPreference(loaded.analytics);
  const installId =
    analytics === "enabled" && typeof loaded.installId === "string" ? loaded.installId.trim() : "";
  return { analytics, installId };
}

function normalizeAnalyticsPreference<T>(value: T): KitsuneConfig["analytics"] {
  return value === "enabled" ? "enabled" : value === "disabled" ? "disabled" : "unset";
}
