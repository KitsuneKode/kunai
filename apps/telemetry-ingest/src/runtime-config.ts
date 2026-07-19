import type { DailyDistinctStore, InstallDayGate, LifetimeStore, RateLimitStore } from "./ingest";
import { createUpstashRedis, type UpstashRedis } from "./upstash-client";
import {
  createUpstashDailyDistinctStore,
  createUpstashInstallDayGate,
  createUpstashLifetimeStore,
  createUpstashRateLimitStore,
} from "./upstash-stores";

export type TelemetryRuntimeConfig = {
  readonly hashSecret: string;
  readonly cronSecret: string;
  readonly redis: UpstashRedis;
  readonly rateLimit: RateLimitStore;
  readonly installDayGate: InstallDayGate;
  readonly daily: DailyDistinctStore;
  readonly lifetime: LifetimeStore;
};

export type TelemetryEnv = {
  readonly UPSTASH_REDIS_REST_URL?: string;
  readonly UPSTASH_REDIS_REST_TOKEN?: string;
  readonly TELEMETRY_HASH_SECRET?: string;
  readonly CRON_SECRET?: string;
  readonly [key: string]: string | undefined;
};

export function loadTelemetryRuntimeConfig(
  env: TelemetryEnv = process.env as TelemetryEnv,
): TelemetryRuntimeConfig | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "";
  const hashSecret = env.TELEMETRY_HASH_SECRET?.trim() ?? "";
  const cronSecret = env.CRON_SECRET?.trim() ?? "";
  if (!url || !token || !hashSecret) {
    return null;
  }
  const redis = createUpstashRedis({ url, token });
  return {
    hashSecret,
    cronSecret,
    redis,
    rateLimit: createUpstashRateLimitStore(redis, hashSecret),
    installDayGate: createUpstashInstallDayGate(redis),
    daily: createUpstashDailyDistinctStore(redis),
    lifetime: createUpstashLifetimeStore(redis),
  };
}
