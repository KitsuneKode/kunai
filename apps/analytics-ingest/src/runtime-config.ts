import { createPostgresAnalyticsStore } from "./postgres-store";
import type { AnalyticsStore } from "./store";

export type AnalyticsRuntimeConfig = {
  readonly hashSecret: string;
  readonly cronSecret: string;
  readonly adminToken: string;
  readonly store: AnalyticsStore;
};

export type AnalyticsEnv = {
  readonly DATABASE_URL?: string;
  readonly ANALYTICS_HASH_SECRET?: string;
  readonly CRON_SECRET?: string;
  readonly ANALYTICS_ADMIN_TOKEN?: string;
  readonly [key: string]: string | undefined;
};

/**
 * Null when the function is not configured to accept pings. A missing hash
 * secret must never silently degrade into storing raw install ids, so it is a
 * hard requirement rather than a default.
 */
export function loadAnalyticsRuntimeConfig(
  env: AnalyticsEnv = process.env as AnalyticsEnv,
  createStore: (connectionString: string) => AnalyticsStore = createPostgresAnalyticsStore,
): AnalyticsRuntimeConfig | null {
  const connectionString = env.DATABASE_URL?.trim() ?? "";
  const hashSecret = env.ANALYTICS_HASH_SECRET?.trim() ?? "";
  if (!connectionString || !hashSecret) return null;
  return {
    hashSecret,
    cronSecret: env.CRON_SECRET?.trim() ?? "",
    adminToken: env.ANALYTICS_ADMIN_TOKEN?.trim() ?? "",
    store: createStore(connectionString),
  };
}
