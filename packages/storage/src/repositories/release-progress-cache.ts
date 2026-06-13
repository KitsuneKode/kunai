import type { MediaKind, ReleaseNewSeason } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

// Canonical `ReleaseNewSeason` lives in `@kunai/types` (shared by the catalog
// producer and this persisted form). Re-export keeps the storage public surface.
export type { ReleaseNewSeason };

export type ReleaseProgressSource = "anilist" | "tmdb";
export type ReleaseProgressStatus = "new-episodes" | "caught-up" | "upcoming" | "unknown";

export interface ReleaseProgressProjection {
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly source: ReleaseProgressSource;
  readonly title: string;
  readonly anchorSeason?: number;
  readonly anchorEpisode: number;
  readonly latestAiredSeason?: number;
  readonly latestAiredEpisode?: number;
  readonly newEpisodeCount: number;
  readonly nextAiringSeason?: number;
  readonly nextAiringEpisode?: number;
  readonly nextAiringAt?: string;
  readonly latestKnownReleaseAt?: string;
  readonly newSeason?: ReleaseNewSeason;
  readonly status: ReleaseProgressStatus;
  readonly checkedAt: string;
  readonly nextCheckAt: string;
  readonly staleAfterAt: string;
  readonly sourceFingerprint: string;
  readonly errorCount: number;
  readonly lastError?: string;
}

export interface ReleaseProgressSummary {
  readonly titleCount: number;
  readonly episodeCount: number;
}

export interface ReleaseProgressDiagnosticsSummary {
  readonly trackedCount: number;
  readonly activeTitleCount: number;
  readonly activeEpisodeCount: number;
  readonly lastCheckedAt: string | null;
  readonly nextDueAt: string | null;
  readonly staleCount: number;
  readonly errorTitleCount: number;
  readonly dueNowCount: number;
}

interface ReleaseProgressDiagnosticsRow {
  readonly tracked_count: number | null;
  readonly active_title_count: number | null;
  readonly active_episode_count: number | null;
  readonly last_checked_at: string | null;
  readonly next_due_at: string | null;
  readonly stale_count: number | null;
  readonly error_title_count: number | null;
  readonly due_now_count: number | null;
}

interface ReleaseProgressRow {
  readonly title_id: string;
  readonly media_kind: MediaKind;
  readonly source: ReleaseProgressSource;
  readonly title: string;
  readonly anchor_season: number | null;
  readonly anchor_episode: number;
  readonly latest_aired_season: number | null;
  readonly latest_aired_episode: number | null;
  readonly new_episode_count: number;
  readonly next_airing_season: number | null;
  readonly next_airing_episode: number | null;
  readonly next_airing_at: string | null;
  readonly latest_known_release_at: string | null;
  readonly new_season_json: string | null;
  readonly status: ReleaseProgressStatus;
  readonly checked_at: string;
  readonly next_check_at: string;
  readonly stale_after_at: string;
  readonly source_fingerprint: string;
  readonly error_count: number;
  readonly last_error: string | null;
}

interface ReleaseProgressSummaryRow {
  readonly title_count: number | null;
  readonly episode_count: number | null;
}

export class ReleaseProgressCacheRepository {
  constructor(private readonly db: KunaiDatabase) {}

  upsert(input: ReleaseProgressProjection): void {
    this.db
      .query(
        `
          INSERT INTO release_progress_cache (
            title_id,
            media_kind,
            source,
            title,
            anchor_season,
            anchor_episode,
            latest_aired_season,
            latest_aired_episode,
            new_episode_count,
            next_airing_season,
            next_airing_episode,
            next_airing_at,
            latest_known_release_at,
            new_season_json,
            status,
            checked_at,
            next_check_at,
            stale_after_at,
            source_fingerprint,
            error_count,
            last_error
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(title_id) DO UPDATE SET
            media_kind = excluded.media_kind,
            source = excluded.source,
            title = excluded.title,
            anchor_season = excluded.anchor_season,
            anchor_episode = excluded.anchor_episode,
            latest_aired_season = excluded.latest_aired_season,
            latest_aired_episode = excluded.latest_aired_episode,
            new_episode_count = excluded.new_episode_count,
            next_airing_season = excluded.next_airing_season,
            next_airing_episode = excluded.next_airing_episode,
            next_airing_at = excluded.next_airing_at,
            latest_known_release_at = excluded.latest_known_release_at,
            new_season_json = excluded.new_season_json,
            status = excluded.status,
            checked_at = excluded.checked_at,
            next_check_at = excluded.next_check_at,
            stale_after_at = excluded.stale_after_at,
            source_fingerprint = excluded.source_fingerprint,
            error_count = excluded.error_count,
            last_error = excluded.last_error
        `,
      )
      .run(
        input.titleId,
        input.mediaKind,
        input.source,
        input.title,
        input.anchorSeason ?? null,
        input.anchorEpisode,
        input.latestAiredSeason ?? null,
        input.latestAiredEpisode ?? null,
        Math.max(0, Math.trunc(input.newEpisodeCount)),
        input.nextAiringSeason ?? null,
        input.nextAiringEpisode ?? null,
        input.nextAiringAt ?? null,
        input.latestKnownReleaseAt ?? null,
        input.newSeason ? JSON.stringify(input.newSeason) : null,
        input.status,
        input.checkedAt,
        input.nextCheckAt,
        input.staleAfterAt,
        input.sourceFingerprint,
        Math.max(0, Math.trunc(input.errorCount)),
        input.lastError ?? null,
      );
  }

  getByTitleIds(titleIds: readonly string[]): Map<string, ReleaseProgressProjection> {
    const uniqueIds = [...new Set(titleIds)].filter((id) => id.length > 0);
    if (uniqueIds.length === 0) return new Map();

    const placeholders = uniqueIds.map(() => "?").join(", ");
    const rows = this.db
      .query<ReleaseProgressRow, string[]>(
        `SELECT * FROM release_progress_cache WHERE title_id IN (${placeholders})`,
      )
      .all(...uniqueIds);

    return new Map(rows.map((row) => [row.title_id, mapReleaseProgressRow(row)]));
  }

  listDue(nowIso: string, limit: number): readonly ReleaseProgressProjection[] {
    return this.db
      .query<ReleaseProgressRow, [string, number]>(
        `
          SELECT * FROM release_progress_cache
          WHERE next_check_at <= ?
          ORDER BY next_check_at ASC
          LIMIT ?
        `,
      )
      .all(nowIso, Math.max(0, Math.trunc(limit)))
      .map(mapReleaseProgressRow);
  }

  summarizeActive(nowIso = new Date().toISOString()): ReleaseProgressSummary {
    const row = this.db
      .query<ReleaseProgressSummaryRow, [string]>(
        `
          SELECT
            COUNT(*) AS title_count,
            COALESCE(SUM(new_episode_count), 0) AS episode_count
          FROM release_progress_cache
          WHERE status = 'new-episodes'
            AND new_episode_count > 0
            AND stale_after_at > ?
        `,
      )
      .get(nowIso);

    return {
      titleCount: row?.title_count ?? 0,
      episodeCount: row?.episode_count ?? 0,
    };
  }

  summarizeDiagnostics(nowIso = new Date().toISOString()): ReleaseProgressDiagnosticsSummary {
    const row = this.db
      .query<ReleaseProgressDiagnosticsRow, [string, string, string, string, string]>(
        `
          SELECT
            COUNT(*) AS tracked_count,
            SUM(
              CASE
                WHEN status = 'new-episodes'
                  AND new_episode_count > 0
                  AND stale_after_at > ?
                THEN 1
                ELSE 0
              END
            ) AS active_title_count,
            COALESCE(
              SUM(
                CASE
                  WHEN status = 'new-episodes'
                    AND new_episode_count > 0
                    AND stale_after_at > ?
                  THEN new_episode_count
                  ELSE 0
                END
              ),
              0
            ) AS active_episode_count,
            MAX(checked_at) AS last_checked_at,
            MIN(
              CASE
                WHEN next_check_at > ? THEN next_check_at
              END
            ) AS next_due_at,
            SUM(
              CASE
                WHEN stale_after_at <= ? THEN 1
                ELSE 0
              END
            ) AS stale_count,
            SUM(
              CASE
                WHEN error_count > 0 THEN 1
                ELSE 0
              END
            ) AS error_title_count,
            SUM(
              CASE
                WHEN next_check_at <= ? THEN 1
                ELSE 0
              END
            ) AS due_now_count
          FROM release_progress_cache
        `,
      )
      .get(nowIso, nowIso, nowIso, nowIso, nowIso);

    return {
      trackedCount: row?.tracked_count ?? 0,
      activeTitleCount: row?.active_title_count ?? 0,
      activeEpisodeCount: row?.active_episode_count ?? 0,
      lastCheckedAt: row?.last_checked_at ?? null,
      nextDueAt: row?.next_due_at ?? null,
      staleCount: row?.stale_count ?? 0,
      errorTitleCount: row?.error_title_count ?? 0,
      dueNowCount: row?.due_now_count ?? 0,
    };
  }

  pruneExpired(nowIso = new Date().toISOString()): number {
    const result = this.db
      .query("DELETE FROM release_progress_cache WHERE stale_after_at <= ?")
      .run(nowIso);
    return result.changes;
  }
}

function mapReleaseProgressRow(row: ReleaseProgressRow): ReleaseProgressProjection {
  return {
    titleId: row.title_id,
    mediaKind: row.media_kind,
    source: row.source,
    title: row.title,
    anchorSeason: row.anchor_season ?? undefined,
    anchorEpisode: row.anchor_episode,
    latestAiredSeason: row.latest_aired_season ?? undefined,
    latestAiredEpisode: row.latest_aired_episode ?? undefined,
    newEpisodeCount: row.new_episode_count,
    nextAiringSeason: row.next_airing_season ?? undefined,
    nextAiringEpisode: row.next_airing_episode ?? undefined,
    nextAiringAt: row.next_airing_at ?? undefined,
    latestKnownReleaseAt: row.latest_known_release_at ?? undefined,
    newSeason: parseNewSeason(row.new_season_json),
    status: row.status,
    checkedAt: row.checked_at,
    nextCheckAt: row.next_check_at,
    staleAfterAt: row.stale_after_at,
    sourceFingerprint: row.source_fingerprint,
    errorCount: row.error_count,
    lastError: row.last_error ?? undefined,
  };
}

function parseNewSeason(value: string | null): ReleaseNewSeason | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ReleaseNewSeason>;
    const out: ReleaseNewSeason = {
      ...(typeof parsed.mediaId === "number" ? { mediaId: parsed.mediaId } : {}),
      ...(typeof parsed.season === "number" ? { season: parsed.season } : {}),
      ...(typeof parsed.latestAiredEpisode === "number"
        ? { latestAiredEpisode: parsed.latestAiredEpisode }
        : {}),
      ...(typeof parsed.nextAiringEpisode === "number"
        ? { nextAiringEpisode: parsed.nextAiringEpisode }
        : {}),
      ...(typeof parsed.nextAiringAt === "string" ? { nextAiringAt: parsed.nextAiringAt } : {}),
    };
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}
