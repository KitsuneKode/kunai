// =============================================================================
// arm-client.ts — shared ARM (arm.haglund.dev) client for the AniList/MAL ↔
// TMDB/IMDB crosswalk. Extracted from aniskip.ts so AniSkip, IntroDB, and
// CatalogIdentityService all use one fetch/parse path.
//
// Endpoints:
//   GET /api/v2/ids?source=<anilist|myanimelist|imdb>&id=…   → object | null
//   GET /api/v2/themoviedb?id=…                              → array of rows
//     (multi-cour anime list several MAL/AniList entries per TMDB show; we take
//      the first row, matching the pre-existing AniSkip behavior)
// =============================================================================

export const ARM_IDS_API = "https://arm.haglund.dev/api/v2/ids";
export const ARM_TMDB_API = "https://arm.haglund.dev/api/v2/themoviedb";

const ARM_TIMEOUT_MS = 4_000;

export type ArmSource = "anilist" | "myanimelist" | "themoviedb" | "imdb";

/** Parsed ARM id row — string ids, matching ProviderExternalIds conventions. */
export type ArmIdGraph = {
  readonly anilistId?: string;
  readonly malId?: string;
  readonly tmdbId?: string;
  readonly imdbId?: string;
  readonly tmdbSeason?: number;
};

type ArmRawRow = Record<string, unknown>;

function numericIdToString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return undefined;
}

function parseRow(row: ArmRawRow): ArmIdGraph | null {
  const anilistId = numericIdToString(row.anilist);
  const malId = numericIdToString(row.myanimelist);
  const tmdbId = numericIdToString(row.themoviedb);
  const imdbRaw = row.imdb;
  const imdbId = typeof imdbRaw === "string" && /^tt\d+$/.test(imdbRaw) ? imdbRaw : undefined;
  const seasonRaw = row["themoviedb-season"];
  const tmdbSeason =
    typeof seasonRaw === "number" && Number.isSafeInteger(seasonRaw) && seasonRaw >= 0
      ? seasonRaw
      : undefined;

  if (!anilistId && !malId && !tmdbId && !imdbId) return null;
  return {
    ...(anilistId ? { anilistId } : {}),
    ...(malId ? { malId } : {}),
    ...(tmdbId ? { tmdbId } : {}),
    ...(imdbId ? { imdbId } : {}),
    ...(tmdbSeason !== undefined ? { tmdbSeason } : {}),
  };
}

/**
 * Parse an ARM ids/themoviedb payload into one id graph. Arrays (themoviedb
 * responses) use the first row — ARM lists split cours in order, and the first
 * mapping is the season-1 entry. Returns null when nothing usable is present.
 */
export function parseArmIdsPayload(payload: unknown): ArmIdGraph | null {
  if (Array.isArray(payload)) {
    const first = payload.find((row) => row && typeof row === "object");
    return first ? parseRow(first as ArmRawRow) : null;
  }
  if (payload && typeof payload === "object") {
    return parseRow(payload as ArmRawRow);
  }
  return null;
}

/**
 * Fetch the id graph for one source id.
 * Returns the graph on a hit, null on a definitive miss (cacheable), and
 * undefined on network/HTTP failure (do not cache).
 */
export async function fetchArmIdGraph(
  source: ArmSource,
  id: string,
  signal?: AbortSignal,
): Promise<ArmIdGraph | null | undefined> {
  const url =
    source === "themoviedb"
      ? `${ARM_TMDB_API}?id=${encodeURIComponent(id)}`
      : `${ARM_IDS_API}?source=${source}&id=${encodeURIComponent(id)}`;

  try {
    const res = await fetch(url, {
      signal: signal ?? AbortSignal.timeout(ARM_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) return undefined;
    const payload = (await res.json()) as unknown;
    return parseArmIdsPayload(payload);
  } catch {
    return undefined;
  }
}
