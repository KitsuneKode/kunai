import { loadAnalyticsLimits, type AnalyticsLimits } from "./limits";
import { createPostgresAnalyticsStore } from "./postgres-store";
import type { AnalyticsStore } from "./store";

export type AnalyticsRuntimeConfig = {
  readonly hashSecret: string;
  readonly cronSecret: string;
  readonly adminToken: string;
  readonly limits: AnalyticsLimits;
  readonly store: AnalyticsStore;
};

export type AnalyticsEnv = {
  readonly DATABASE_URL?: string;
  readonly ANALYTICS_HASH_SECRET?: string;
  readonly CRON_SECRET?: string;
  readonly ANALYTICS_ADMIN_TOKEN?: string;
  readonly ANALYTICS_MAX_PINGS_PER_DAY?: string;
  readonly ANALYTICS_MAX_BUCKETS_PER_DIMENSION?: string;
  readonly ANALYTICS_LIFETIME_RETENTION_DAYS?: string;
  readonly [key: string]: string | undefined;
};

/**
 * Null when the function is not configured to accept pings. A missing hash
 * secret must never silently degrade into storing raw install ids, so it is a
 * hard requirement rather than a default.
 *
 * The limits are not: a missing or malformed ceiling falls back to the
 * documented default rather than failing the deploy, because a typo in a cost
 * control must not take the endpoint down.
 */
export function loadAnalyticsRuntimeConfig(
  env: AnalyticsEnv = process.env as AnalyticsEnv,
  createStore: (
    connectionString: string,
    limits: AnalyticsLimits,
  ) => AnalyticsStore = createPostgresAnalyticsStore,
): AnalyticsRuntimeConfig | null {
  const connectionString = env.DATABASE_URL?.trim() ?? "";
  const hashSecret = env.ANALYTICS_HASH_SECRET?.trim() ?? "";
  if (!connectionString || !hashSecret) return null;
  const limits = loadAnalyticsLimits(env);
  return {
    hashSecret,
    cronSecret: env.CRON_SECRET?.trim() ?? "",
    adminToken: env.ANALYTICS_ADMIN_TOKEN?.trim() ?? "",
    limits,
    store: createStore(connectionString, limits),
  };
}
