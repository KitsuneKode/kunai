import { isAnalyticsMonth } from "@/domain/analytics/analytics-day";

import type {
  AnalyticsPingCompletion,
  KitsuneConfig,
  PersistedAnalyticsConsent,
} from "./ConfigService";

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

/**
 * Every analytics key a loaded config.json grants, normalized, for startup and
 * for `kunai analytics preview`. The cohort is kept only beside the identity it
 * belongs to: one without an enabled, present install id is residue and reads
 * as empty.
 */
export function loadedAnalyticsFields(
  loaded: Partial<KitsuneConfig>,
): Pick<
  KitsuneConfig,
  | "analytics"
  | "installId"
  | "analyticsCohort"
  | "lastAnalyticsPingAt"
  | "analyticsRetryAfter"
  | "analyticsEndpoint"
> {
  const consent = persistedAnalyticsConsent(loaded);
  const hasIdentity = consent.analytics === "enabled" && consent.installId !== "";
  return {
    ...consent,
    analyticsCohort:
      hasIdentity && isAnalyticsMonth(loaded.analyticsCohort) ? loaded.analyticsCohort : "",
    lastAnalyticsPingAt: nonNegativeEpochMs(loaded.lastAnalyticsPingAt),
    analyticsRetryAfter: nonNegativeEpochMs(loaded.analyticsRetryAfter),
    analyticsEndpoint:
      typeof loaded.analyticsEndpoint === "string" ? loaded.analyticsEndpoint.trim() : "",
  };
}

/**
 * What a ping completion writes over the file's config: cadence and retry
 * bookkeeping, plus a cohort only where the file has none (an install that
 * opted in before cohorts existed). A cohort already on disk was set by a
 * keystroke and is never replaced. Never the identity.
 */
export function analyticsCompletionPatch(
  current: Pick<KitsuneConfig, "analyticsCohort">,
  completion: AnalyticsPingCompletion,
): Partial<KitsuneConfig> {
  const patch: Partial<KitsuneConfig> = { analyticsRetryAfter: completion.analyticsRetryAfter };
  if (completion.lastAnalyticsPingAt !== undefined) {
    patch.lastAnalyticsPingAt = completion.lastAnalyticsPingAt;
  }
  if (completion.analyticsCohort && !isAnalyticsMonth(current.analyticsCohort)) {
    patch.analyticsCohort = completion.analyticsCohort;
  }
  return patch;
}

/** A hand-edited or corrupt timestamp reads as "never". */
function nonNegativeEpochMs(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeAnalyticsPreference<T>(value: T): KitsuneConfig["analytics"] {
  return value === "enabled" ? "enabled" : value === "disabled" ? "disabled" : "unset";
}
