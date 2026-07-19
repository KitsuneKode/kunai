import { createHmac } from "node:crypto";

import type { DailyDistinctStore, InstallDayGate, LifetimeStore, RateLimitStore } from "./ingest";
import {
  DAY_COUNT_TTL_SECONDS,
  DAY_SET_TTL_SECONDS,
  IP_RATE_MAX,
  IP_RATE_WINDOW_SECONDS,
  REDIS_KEYS,
} from "./redis-keys";
import type { UpstashRedis } from "./upstash-client";

export function hashEphemeralKey(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

/** Seconds until end of UTC day (+ 1h skew buffer). */
export function secondsUntilUtcDayEnd(now: number): number {
  const date = new Date(now);
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(60, Math.ceil((end - now) / 1000) + 3600);
}

export function createUpstashRateLimitStore(
  redis: UpstashRedis,
  hashSecret: string,
  options?: { readonly maxPerWindow?: number; readonly windowSeconds?: number },
): RateLimitStore {
  const maxPerWindow = options?.maxPerWindow ?? IP_RATE_MAX;
  const windowSeconds = options?.windowSeconds ?? IP_RATE_WINDOW_SECONDS;

  return {
    async allow(ipKey: string, _now: number): Promise<boolean> {
      const ipHash = hashEphemeralKey(hashSecret, ipKey);
      const key = REDIS_KEYS.ipRateLimit(ipHash);
      const count = await redis.command<number>("INCR", key);
      if (count === 1) {
        await redis.command("EXPIRE", key, windowSeconds);
      }
      return count <= maxPerWindow;
    },
  };
}

export function createUpstashInstallDayGate(
  redis: UpstashRedis,
  nowFn: () => number = () => Date.now(),
): InstallDayGate {
  return {
    async claim(day: string, installHash: string): Promise<boolean> {
      const key = REDIS_KEYS.installDayGate(day, installHash);
      const ttl = secondsUntilUtcDayEnd(nowFn());
      const result = await redis.command<string | null>("SET", key, "1", "EX", ttl, "NX");
      return result === "OK";
    },
  };
}

export function createUpstashDailyDistinctStore(redis: UpstashRedis): DailyDistinctStore {
  return {
    async record(day: string, installHash: string): Promise<number> {
      const setKey = REDIS_KEYS.daySet(day);
      await redis.command("SADD", setKey, installHash);
      await redis.command("EXPIRE", setKey, DAY_SET_TTL_SECONDS);
      const count = await redis.command<number>("SCARD", setKey);
      await redis.command(
        "SET",
        REDIS_KEYS.dayCount(day),
        String(count),
        "EX",
        DAY_COUNT_TTL_SECONDS,
      );
      return count;
    },
    async count(day: string): Promise<number> {
      const cached = await redis.command<string | null>("GET", REDIS_KEYS.dayCount(day));
      if (cached !== null && cached !== "") {
        const parsed = Number(cached);
        if (Number.isFinite(parsed)) return parsed;
      }
      return await redis.command<number>("SCARD", REDIS_KEYS.daySet(day));
    },
  };
}

export function createUpstashLifetimeStore(redis: UpstashRedis): LifetimeStore {
  return {
    async add(installHash: string): Promise<void> {
      await redis.command("PFADD", REDIS_KEYS.lifetime(), installHash);
    },
    async approxCount(): Promise<number> {
      const count = await redis.command<number>("PFCOUNT", REDIS_KEYS.lifetime());
      return Number.isFinite(count) ? count : 0;
    },
  };
}
