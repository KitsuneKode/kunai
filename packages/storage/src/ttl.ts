import type { CacheTtlClass } from "@kunai/types";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const defaultTtlMsByClass: Readonly<Record<CacheTtlClass, number>> = {
  "never-cache": 0,
  session: 30 * MINUTE,
  "stream-manifest": 5 * MINUTE,
  "direct-media-url": 2 * MINUTE,
  "subtitle-list": DAY,
  "episode-list": 12 * HOUR,
  "provider-metadata": 7 * DAY,
  "catalog-static": 14 * DAY,
  "catalog-trending": 30 * MINUTE,
  "provider-health": 5 * MINUTE,
};

export function getDefaultTtlMs(ttlClass: CacheTtlClass): number {
  return defaultTtlMsByClass[ttlClass];
}

export function getExpiresAt(ttlClass: CacheTtlClass, now = new Date()): string {
  const ttlMs = getDefaultTtlMs(ttlClass);

  if (ttlMs <= 0) {
    return now.toISOString();
  }

  return new Date(now.getTime() + ttlMs).toISOString();
}

export function isExpired(expiresAt: string, now = new Date()): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}
