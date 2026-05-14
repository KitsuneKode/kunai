import type { KitsuneConfig } from "@/services/persistence/ConfigService";

const DAY_MS = 24 * 60 * 60 * 1000;

export function shouldRunUpdateCheck(config: KitsuneConfig, now: number): boolean {
  if (!config.updateChecksEnabled) return false;
  if (config.updateSnoozedUntil > now) return false;
  if (config.lastUpdateCheckAt <= 0) return true;

  const intervalDays = Math.max(1, config.updateCheckIntervalDays);
  return now - config.lastUpdateCheckAt >= intervalDays * DAY_MS;
}

export function updateCheckCachePatch({
  now,
  latestVersion,
  failed,
}: {
  readonly now: number;
  readonly latestVersion: string | null;
  readonly failed: boolean;
}): Partial<KitsuneConfig> {
  return {
    lastUpdateCheckAt: now,
    ...(latestVersion ? { lastKnownLatestVersion: latestVersion } : null),
    lastUpdateCheckFailedAt: failed ? now : 0,
  };
}
