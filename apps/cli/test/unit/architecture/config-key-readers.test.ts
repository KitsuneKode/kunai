import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_CONFIG } from "@kunai/config";

const CLI_SRC = join(import.meta.dir, "../../../src");

/** Written by load/save bookkeeping. Not a user-facing preference. */
const BOOKKEEPING_KEYS = new Set([
  "providerDefaultsRevision",
  "lastAnalyticsPingAt",
  "analyticsRetryAfter",
  "lastUpdateCheckAt",
  "lastUpdateCheckFailedAt",
  "lastKnownLatestVersion",
  "lastCalendarVisitAt",
  "lastWeeklyDigestShownAt",
  "lastStreakMilestoneDays",
  "onboardingVersion",
  "playbackKeysSessionsSeen",
  "videasySessionExpiresAt",
  // Forced off on load. The getter keeps a persisted "season" from coming back
  // as a streaming auto-download; nothing else reads it.
  "autoDownload",
  "autoDownloadNextCount",
]);

function sourceOutsideConfigAndSettings(): string {
  const chunks: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name === "persistence" || name === "settings") continue;
        walk(path);
        continue;
      }
      if (path.endsWith(".ts") || path.endsWith(".tsx")) chunks.push(readFileSync(path, "utf8"));
    }
  };
  walk(CLI_SRC);
  return chunks.join("\n");
}

describe("config key readers", () => {
  test("every KitsuneConfig key is read outside config persistence and settings, or is bookkeeping", () => {
    const source = sourceOutsideConfigAndSettings();
    const keys = new Set<string>([...Object.keys(DEFAULT_CONFIG), "lastStreakMilestoneDays"]);
    const unread = [...keys].filter((key) => {
      if (BOOKKEEPING_KEYS.has(key)) return false;
      const pattern = new RegExp(`(?<![A-Za-z0-9_])${key}(?![A-Za-z0-9_])`);
      return !pattern.test(source);
    });
    expect(unread).toEqual([]);
  });

  test("session overrides are the getters the app reads", () => {
    const impl = readFileSync(join(CLI_SRC, "services/persistence/ConfigServiceImpl.ts"), "utf8");
    for (const key of ["zenMode", "minimalMode", "offlineMode"] as const) {
      expect(impl).toContain(`return this.read("${key}")`);
    }
  });
});
