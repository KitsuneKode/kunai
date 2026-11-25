/**
 * Public download counters: GitHub release assets and npm package downloads.
 *
 * Nothing here involves a Kunai client. Both APIs publish these numbers to
 * anyone who asks; the cron reads them once a day and keeps a snapshot, because
 * neither keeps a history Kunai can query later (GitHub only has the running
 * total; npm keeps 18 months).
 *
 * Documented APIs only, never scraping. `GITHUB_TOKEN` is optional: unset, the
 * GitHub call is anonymous and rate-limited per IP, which one call a day fits.
 */

import { z } from "zod";

import { shiftDayKey } from "./analytics-day.js";
import type { DistributionEntry } from "./store.js";

export const GITHUB_REPO = "KitsuneKode/kunai";

/** The npm launcher. Each npm install also fetches one platform package. */
export const NPM_LAUNCHER = "@kitsunekode/kunai";

/**
 * Platform suffixes of `@kitsunekode/kunai-<platform>`. A test holds this to
 * `apps/cli/package.json`'s optionalDependencies, so a new platform package
 * cannot ship uncounted.
 */
export const NPM_PLATFORM_PACKAGES = [
  "android-arm64",
  "android-x64",
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-arm64-musl",
  "linux-x64",
  "linux-x64-musl",
  "windows-arm64",
  "windows-x64",
] as const;

/**
 * First day the npm downloads range is read from. The launcher was first
 * published in May 2026; an earlier start only adds zero-download days.
 */
export const NPM_EPOCH = "2026-05-01";

/** npm serves at most 18 months per range request; stay safely inside it. */
export const NPM_RANGE_MAX_DAYS = 540;

/** Release pages read at most, at 100 releases each. */
const MAX_RELEASE_PAGES = 10;

/** The two assets that exist only to be counted. Decision 3 of the analytics plan. */
const MARKER_ASSETS = new Map<string, "install" | "update">([
  ["install.marker", "install"],
  ["update.marker", "update"],
]);

/** `kunai-<os>-<arch>[-musl]` plus the extensions releases ship. Checksums and signatures do not match. */
const BINARY_ASSET_RE =
  /^kunai-(linux|darwin|windows|android)-(x64|arm64)(-musl)?(?:\.exe|\.tar\.gz|\.zip)?$/;

export type DistributionFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type DistributionSourceOptions = {
  readonly fetch: DistributionFetch;
  /** The snapshot day: npm is read through the day before it. */
  readonly today: string;
  readonly githubToken?: string;
  readonly signal?: AbortSignal;
};

/** Which counter an asset feeds, or null for checksums, signatures and anything unknown. */
export function classifyGithubAsset(
  name: string,
): Pick<DistributionEntry, "source" | "platform"> | null {
  const marker = MARKER_ASSETS.get(name);
  if (marker) return { source: "marker", platform: marker };
  const match = BINARY_ASSET_RE.exec(name);
  if (!match) return null;
  return { source: "github", platform: `${match[1]}-${match[2]}${match[3] ?? ""}` };
}

const githubReleasesSchema = z.array(
  z.object({
    tag_name: z.string().min(1),
    draft: z.boolean().optional(),
    assets: z.array(z.object({ name: z.string(), download_count: z.number().int().nonnegative() })),
  }),
);

export type GithubReleasesPage = {
  readonly entries: DistributionEntry[];
  /** Releases on the page, drafts included: fewer than a full page means the last one. */
  readonly releases: number;
};

/**
 * One page of the Releases API, as JSON text, into distribution entries. A
 * binary and its archive are two assets of one platform, so they sum into one
 * entry. Throws on a body that is not the documented shape.
 */
export function parseGithubReleases(json: string): GithubReleasesPage {
  const releases = githubReleasesSchema.parse(JSON.parse(json));
  const totals = new Map<string, DistributionEntry>();
  for (const release of releases) {
    if (release.draft) continue;
    for (const asset of release.assets) {
      const kind = classifyGithubAsset(asset.name);
      if (!kind) continue;
      const key = `${kind.source}::${release.tag_name}::${kind.platform}`;
      const previous = totals.get(key)?.cumulative ?? 0;
      totals.set(key, {
        source: kind.source,
        release: release.tag_name,
        platform: kind.platform,
        cumulative: previous + asset.download_count,
      });
    }
  }
  return { entries: [...totals.values()], releases: releases.length };
}

const npmRangeSchema = z.object({
  downloads: z.array(z.object({ downloads: z.number().int().nonnegative() })),
});

/** Sum of one npm range response, as JSON text. Throws on an undocumented shape. */
export function sumNpmRange(json: string): number {
  return npmRangeSchema
    .parse(JSON.parse(json))
    .downloads.reduce((sum, day) => sum + day.downloads, 0);
}

/** `[start, end]` windows covering `fromDay..toDay`, each within npm's range limit. */
export function npmRangeWindows(fromDay: string, toDay: string): [string, string][] {
  const windows: [string, string][] = [];
  let start = fromDay;
  while (start <= toDay) {
    const capped = shiftDayKey(start, NPM_RANGE_MAX_DAYS - 1);
    const end = capped < toDay ? capped : toDay;
    windows.push([start, end]);
    start = shiftDayKey(end, 1);
  }
  return windows;
}

async function fetchGithubEntries(
  options: DistributionSourceOptions,
): Promise<DistributionEntry[]> {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "kunai-analytics-ingest",
  });
  if (options.githubToken) headers.set("Authorization", `Bearer ${options.githubToken}`);

  const entries: DistributionEntry[] = [];
  for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100&page=${page}`;
    const response = await options.fetch(url, { headers, signal: options.signal });
    if (!response.ok) throw new Error(`github releases page ${page} answered ${response.status}`);
    const parsed = parseGithubReleases(await response.text());
    entries.push(...parsed.entries);
    if (parsed.releases < 100) break;
  }
  return entries;
}

async function fetchNpmCumulative(
  options: DistributionSourceOptions,
  packageName: string,
): Promise<number> {
  const through = shiftDayKey(options.today, -1);
  let total = 0;
  for (const [start, end] of npmRangeWindows(NPM_EPOCH, through)) {
    const url = `https://api.npmjs.org/downloads/range/${start}:${end}/${packageName}`;
    const response = await options.fetch(url, {
      headers: { "User-Agent": "kunai-analytics-ingest" },
      signal: options.signal,
    });
    // A platform package listed before its first publish has no downloads yet.
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`npm range for ${packageName} answered ${response.status}`);
    total += sumNpmRange(await response.text());
  }
  return total;
}

/**
 * Every counter, read now. All or nothing: any failed request rejects, so the
 * caller never stores a partial snapshot.
 */
export async function fetchDistributionEntries(
  options: DistributionSourceOptions,
): Promise<DistributionEntry[]> {
  const npmPackages = [
    { name: NPM_LAUNCHER, platform: "launcher" },
    ...NPM_PLATFORM_PACKAGES.map((platform) => ({
      name: `${NPM_LAUNCHER}-${platform}`,
      platform,
    })),
  ];
  const [github, npm] = await Promise.all([
    fetchGithubEntries(options),
    Promise.all(
      npmPackages.map(async (pkg) => ({
        source: "npm" as const,
        release: "",
        platform: pkg.platform,
        cumulative: await fetchNpmCumulative(options, pkg.name),
      })),
    ),
  ]);
  return [...github, ...npm];
}
