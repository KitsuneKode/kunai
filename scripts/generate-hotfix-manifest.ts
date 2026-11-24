#!/usr/bin/env bun
/**
 * Generate a validated, lane-safe Tier-1 provider hotfix manifest draft from
 * `apps/docs/lib/generated-provider-status.json`.
 *
 * Output is unsigned JSON ready for `scripts/sign-provider-manifest.ts sign`.
 *
 * Safety invariants:
 * - Never disables every provider in any lane (anime / series / youtube).
 * - Preserves manual/curated priority order among healthy ("ok") providers and
 *   demotes dead/degraded providers behind them rather than bricking a lane.
 * - Enforces schema validation via `isValidProviderHotfixManifest` before writing.
 *
 * Usage:
 *   bun run scripts/generate-hotfix-manifest.ts --revision <n> [--days <1..90>] [--in <status.json>] --out <manifest.json>
 */

import { readFileSync, writeFileSync } from "node:fs";

import {
  isValidProviderHotfixManifest,
  type ProviderHotfixEntry,
  type ProviderHotfixManifest,
} from "../packages/providers/src/shared/manifest-bundle";
import { isJsonObject, isJsonString, type JsonValue } from "../packages/types/src/json-value";

export interface ObservedProviderStatusRow {
  readonly id: string;
  readonly lane: "anime" | "series" | "youtube";
  readonly status: string;
}

export interface GenerateHotfixManifestOptions {
  readonly rows: readonly ObservedProviderStatusRow[];
  readonly revision: number;
  readonly nowMs?: number;
  readonly lifetimeDays?: number;
  /** Disable providers whose status is explicitly "down" or "broken" when at least one sibling in the lane is healthy. */
  readonly disableDownWhenSiblingOk?: boolean;
}

export interface GenerateHotfixCliResult {
  readonly code: number;
  readonly output: string;
}

const DEFAULT_STATUS_PATH = "apps/docs/lib/generated-provider-status.json";
const DEFAULT_LIFETIME_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseJsonValue(text: string): JsonValue {
  // SAFETY: JSON.parse returns standard JSON values conforming to JsonValue.
  return JSON.parse(text) as JsonValue;
}

function isLane(value: string): value is "anime" | "series" | "youtube" {
  return value === "anime" || value === "series" || value === "youtube";
}

export function parseObservedProviderStatusRows(raw: JsonValue): ObservedProviderStatusRow[] {
  if (!isJsonObject(raw) || !Array.isArray(raw.providers)) return [];
  const rows: ObservedProviderStatusRow[] = [];
  for (const item of raw.providers) {
    if (!isJsonObject(item)) continue;
    const id = isJsonString(item.id) ? item.id.trim().toLowerCase() : "";
    const laneRaw = isJsonString(item.lane) ? item.lane.trim().toLowerCase() : "";
    const status = isJsonString(item.status) ? item.status.trim().toLowerCase() : "unknown";
    if (!id || !isLane(laneRaw)) continue;
    rows.push({ id, lane: laneRaw, status });
  }
  return rows;
}

function statusRank(status: string): number {
  if (status === "ok" || status === "healthy") return 0;
  if (status === "degraded" || status === "blocked") return 1;
  return 2;
}

interface MutableLaneBuckets {
  anime: ObservedProviderStatusRow[];
  series: ObservedProviderStatusRow[];
  youtube: ObservedProviderStatusRow[];
}

interface MutableLanePriorities {
  anime?: readonly string[];
  series?: readonly string[];
  movie?: readonly string[];
  youtube?: readonly string[];
}

export function buildHotfixManifestDraft(
  options: GenerateHotfixManifestOptions,
): ProviderHotfixManifest {
  const nowMs = options.nowMs ?? Date.now();
  const lifetimeDays = Math.max(
    1,
    Math.min(90, Math.trunc(options.lifetimeDays ?? DEFAULT_LIFETIME_DAYS)),
  );
  const generatedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + lifetimeDays * MS_PER_DAY).toISOString();

  const byLane: MutableLaneBuckets = { anime: [], series: [], youtube: [] };

  for (const row of options.rows) {
    byLane[row.lane].push(row);
  }

  const sortLane = (list: readonly ObservedProviderStatusRow[]): string[] =>
    [...list].sort((a, b) => statusRank(a.status) - statusRank(b.status)).map((row) => row.id);

  const providers: Record<string, ProviderHotfixEntry> = {};
  if (options.disableDownWhenSiblingOk) {
    for (const laneRows of [byLane.anime, byLane.series, byLane.youtube]) {
      const hasHealthySibling = laneRows.some(
        (row) => row.status === "ok" || row.status === "healthy",
      );
      if (!hasHealthySibling) continue;
      for (const row of laneRows) {
        if (row.status === "down" || row.status === "broken" || row.status === "dead") {
          providers[row.id] = { disabled: true };
        }
      }
    }
  }

  const animeOrder = sortLane(byLane.anime);
  const seriesOrder = sortLane(byLane.series);
  const youtubeOrder = sortLane(byLane.youtube);

  const lanePriorities: MutableLanePriorities = {};
  if (animeOrder.length > 0) lanePriorities.anime = animeOrder;
  if (seriesOrder.length > 0) {
    lanePriorities.series = seriesOrder;
    lanePriorities.movie = seriesOrder;
  }
  if (youtubeOrder.length > 0) lanePriorities.youtube = youtubeOrder;

  const manifest: ProviderHotfixManifest = {
    schemaVersion: 1,
    revision: Math.max(1, Math.trunc(options.revision)),
    generatedAt,
    expiresAt,
    lanePriorities,
    providers,
  };

  if (!isValidProviderHotfixManifest(manifest)) {
    throw new Error("Generated provider hotfix manifest failed schema validation");
  }
  return manifest;
}

function readFlag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

export function runGenerateHotfixManifestCli(argv: readonly string[]): GenerateHotfixCliResult {
  const revRaw = readFlag(argv, "--revision");
  const outPath = readFlag(argv, "--out");
  const inPath = readFlag(argv, "--in") ?? DEFAULT_STATUS_PATH;
  const daysRaw = readFlag(argv, "--days");
  const disableDown = argv.includes("--disable-down");

  const revision = revRaw ? Number.parseInt(revRaw, 10) : Number.NaN;
  if (!Number.isInteger(revision) || revision < 1 || !outPath) {
    return {
      code: 2,
      output:
        "Usage: generate-hotfix-manifest.ts --revision <n> --out <manifest.json> [--in <status.json>] [--days <1..90>] [--disable-down]\n",
    };
  }
  const lifetimeDays = daysRaw ? Number.parseInt(daysRaw, 10) : DEFAULT_LIFETIME_DAYS;
  if (!Number.isInteger(lifetimeDays) || lifetimeDays < 1 || lifetimeDays > 90) {
    return {
      code: 2,
      output: "Invalid --days value; expected an integer between 1 and 90.\n",
    };
  }

  const raw = parseJsonValue(readFileSync(inPath, "utf8"));
  const rows = parseObservedProviderStatusRows(raw);
  const manifest = buildHotfixManifestDraft({
    rows,
    revision,
    lifetimeDays,
    disableDownWhenSiblingOk: disableDown,
  });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    code: 0,
    output: `Generated provider hotfix manifest draft rev ${manifest.revision} (${rows.length} observed providers) -> ${outPath}\n`,
  };
}

if (import.meta.main) {
  const result = runGenerateHotfixManifestCli(process.argv.slice(2));
  process.stdout.write(result.output);
  process.exit(result.code);
}
