import {
  mergeBackfillExternalIds,
  resolveHistoryLookupTitleId,
  resolvePersistedHistoryTitle,
} from "@kunai/core";
import type {
  EpisodeIdentity,
  MediaKind,
  ProviderExternalIds,
  ProviderId,
  TitleIdentity,
} from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";
import { externalIdsToAliases, HistoryTitleAliasRepository } from "./history-title-aliases";

export interface HistoryProgressInput {
  readonly title: TitleIdentity;
  readonly episode?: EpisodeIdentity;
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
  readonly completed?: boolean;
  readonly watchedSeconds?: number;
  readonly lastWatchedAt?: string;
  readonly completedAt?: string | null;
  readonly providerId?: ProviderId;
  readonly posterUrl?: string;
  readonly updatedAt?: string;
}

export interface HistoryProgress {
  readonly key: string;
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
  readonly watchedSeconds?: number;
  readonly completed: boolean;
  readonly providerId?: ProviderId;
  readonly externalIds?: ProviderExternalIds;
  readonly posterUrl?: string;
  readonly lastWatchedAt?: string;
  readonly completedAt?: string;
  readonly updatedAt: string;
  readonly createdAt: string;
}

interface HistoryProgressRow {
  readonly key: string;
  readonly title_id: string;
  readonly media_kind: MediaKind;
  readonly title: string;
  readonly season: number | null;
  readonly episode: number | null;
  readonly absolute_episode: number | null;
  readonly position_seconds: number;
  readonly duration_seconds: number | null;
  readonly completed: number;
  readonly watched_seconds: number;
  readonly last_watched_at: string | null;
  readonly completed_at: string | null;
  readonly provider_id: string | null;
  readonly external_ids_json: string | null;
  readonly poster_url: string | null;
  readonly updated_at: string;
  readonly created_at: string;
}

export class HistoryRepository {
  private readonly titleAliases: HistoryTitleAliasRepository;

  constructor(private readonly db: KunaiDatabase) {
    this.titleAliases = new HistoryTitleAliasRepository(db);
  }

  upsertProgress(input: HistoryProgressInput): void {
    const persistedTitle = input.providerId
      ? resolvePersistedHistoryTitle(input.title, input.providerId)
      : input.title;
    const key = createHistoryKey(persistedTitle, input.episode);
    const now = input.updatedAt ?? new Date().toISOString();
    let existing = this.getProgressByKey(key);
    if (persistedTitle.kind === "video") {
      const legacyKey = createHistoryKey({ ...persistedTitle, kind: "movie" }, input.episode);
      if (legacyKey !== key) {
        const legacy = this.getProgressByKey(legacyKey);
        if (legacy) {
          if (!existing) {
            existing = legacy;
          }
          this.db.query("DELETE FROM history_progress WHERE key = ?").run(legacyKey);
        }
      }
    }
    const watchedSeconds = resolveWatchedSeconds(input, existing);
    const lastWatchedAt = input.lastWatchedAt ?? now;
    const resolvedCompleted = input.completed ?? existing?.completed ?? false;
    const completedAt =
      input.completedAt === null
        ? null
        : resolvedCompleted
          ? (input.completedAt ?? existing?.completedAt ?? now)
          : input.completed === false
            ? null
            : (existing?.completedAt ?? null);

    this.db
      .query(
        `
          INSERT INTO history_progress (
            key,
            title_id,
            media_kind,
            title,
            season,
            episode,
            absolute_episode,
            position_seconds,
            duration_seconds,
            completed,
            watched_seconds,
            last_watched_at,
            completed_at,
            provider_id,
            external_ids_json,
            poster_url,
            updated_at,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            title = excluded.title,
            position_seconds = excluded.position_seconds,
            duration_seconds = excluded.duration_seconds,
            completed = excluded.completed,
            watched_seconds = excluded.watched_seconds,
            last_watched_at = excluded.last_watched_at,
            completed_at = excluded.completed_at,
            provider_id = excluded.provider_id,
            external_ids_json = excluded.external_ids_json,
            poster_url = COALESCE(excluded.poster_url, history_progress.poster_url),
            updated_at = excluded.updated_at
        `,
      )
      .run(
        key,
        persistedTitle.id,
        persistedTitle.kind,
        persistedTitle.title,
        input.episode?.season ?? null,
        input.episode?.episode ?? null,
        input.episode?.absoluteEpisode ?? null,
        Math.max(0, Math.trunc(input.positionSeconds)),
        input.durationSeconds === undefined ? null : Math.max(0, Math.trunc(input.durationSeconds)),
        resolvedCompleted ? 1 : 0,
        watchedSeconds,
        lastWatchedAt,
        completedAt,
        input.providerId ?? null,
        serializeExternalIds(persistedTitle.externalIds),
        input.posterUrl ?? null,
        now,
        now,
      );

    // Keep the alias index current so any external id resolves to this unit.
    this.titleAliases.upsertAliases(
      persistedTitle.id,
      externalIdsToAliases(persistedTitle.externalIds),
      now,
    );
  }

  /**
   * Mark an episode (or movie) watched: completed flag + snap position to end.
   * Preserves watched_seconds accumulated so far unless caller overrides.
   */
  markWatched(
    title: TitleIdentity,
    episode?: EpisodeIdentity,
    now = new Date().toISOString(),
  ): void {
    const existing = this.getProgress(title, episode);
    const duration = existing?.durationSeconds ?? 0;
    const positionSeconds = duration > 0 ? duration : (existing?.positionSeconds ?? 0);
    const watchedSeconds = Math.max(
      existing?.watchedSeconds ?? 0,
      duration > 0 ? duration : positionSeconds,
    );
    this.upsertProgress({
      title,
      episode,
      positionSeconds,
      durationSeconds: existing?.durationSeconds,
      completed: true,
      watchedSeconds,
      lastWatchedAt: now,
      completedAt: now,
      providerId: existing?.providerId,
      posterUrl: existing?.posterUrl,
      updatedAt: now,
    });
  }

  /**
   * Clear the completed flag while preserving resume position and engaged seconds.
   */
  markUnwatched(
    title: TitleIdentity,
    episode?: EpisodeIdentity,
    now = new Date().toISOString(),
  ): void {
    const existing = this.getProgress(title, episode);
    if (!existing) {
      this.upsertProgress({
        title,
        episode,
        positionSeconds: 0,
        completed: false,
        completedAt: null,
        updatedAt: now,
      });
      return;
    }
    this.upsertProgress({
      title: {
        id: existing.titleId,
        kind: existing.mediaKind,
        title: existing.title,
        externalIds: existing.externalIds,
      },
      episode: {
        season: existing.season,
        episode: existing.episode,
        absoluteEpisode: existing.absoluteEpisode,
      },
      positionSeconds: existing.positionSeconds,
      durationSeconds: existing.durationSeconds,
      completed: false,
      watchedSeconds: existing.watchedSeconds,
      completedAt: null,
      providerId: existing.providerId,
      posterUrl: existing.posterUrl,
      updatedAt: now,
    });
  }

  /**
   * Mid-play checkpoint: position + engaged seconds without forcing completion.
   */
  checkpointProgress(input: HistoryProgressInput): void {
    const persistedTitle = input.providerId
      ? resolvePersistedHistoryTitle(input.title, input.providerId)
      : input.title;
    const existing = this.getProgress(persistedTitle, input.episode);
    const now = input.lastWatchedAt ?? input.updatedAt ?? new Date().toISOString();
    this.upsertProgress({
      ...input,
      title: persistedTitle,
      completed: input.completed ?? existing?.completed ?? false,
      completedAt:
        input.completedAt !== undefined
          ? input.completedAt
          : (input.completed ?? existing?.completed)
            ? (existing?.completedAt ?? now)
            : null,
      lastWatchedAt: now,
    });
  }

  getProgress(title: TitleIdentity, episode?: EpisodeIdentity): HistoryProgress | undefined {
    const row = this.db
      .query<HistoryProgressRow, [string]>("SELECT * FROM history_progress WHERE key = ?")
      .get(createHistoryKey(title, episode));

    return row === null ? undefined : mapHistoryRow(row);
  }

  getLatestForTitle(titleId: string): HistoryProgress | undefined {
    const row = this.db
      .query<HistoryProgressRow, [string]>(
        "SELECT * FROM history_progress WHERE title_id = ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(titleId);

    return row === null ? undefined : mapHistoryRow(row);
  }

  /**
   * Resolve the latest history row for a title identity. Tries the canonical catalog
   * id first, then falls back to the raw session id for legacy opaque rows.
   */
  getLatestForTitleIdentity(
    title: Pick<TitleIdentity, "id" | "kind" | "externalIds">,
  ): HistoryProgress | undefined {
    const canonicalId = resolveHistoryLookupTitleId(title);
    const canonical = this.getLatestForTitle(canonicalId);
    if (canonical) return canonical;
    if (canonicalId !== title.id) {
      return this.getLatestForTitle(title.id);
    }
    return undefined;
  }

  getProgressForTitleIdentity(
    title: Pick<TitleIdentity, "id" | "kind" | "title" | "externalIds">,
    episode?: EpisodeIdentity,
  ): HistoryProgress | undefined {
    const canonicalId = resolveHistoryLookupTitleId(title);
    const canonicalTitle: TitleIdentity = { ...title, id: canonicalId };
    const progress = this.getProgress(canonicalTitle, episode);
    if (progress) return progress;
    if (canonicalId !== title.id) {
      return this.getProgress(title, episode);
    }
    return undefined;
  }

  /** Manual reclassification override — fix a wrongly-classified title across all its history rows. */
  setMediaKind(titleId: string, mediaKind: MediaKind): void {
    this.db
      .query("UPDATE history_progress SET media_kind = ? WHERE title_id = ?")
      .run(mediaKind, titleId);
  }

  /**
   * Self-healing backfill of catalog metadata across every row of a title. Only
   * fills columns that are currently empty (NULL poster / empty external ids) so a
   * later, better resolution can heal a row that playback never had art for, while
   * never clobbering metadata that already exists.
   *
   * Returns true when at least one row actually changed, so callers can skip
   * follow-up work (consolidation, logging) on no-op backfills.
   */
  backfillTitleMetadata(
    titleId: string,
    metadata: { readonly posterUrl?: string; readonly externalIds?: ProviderExternalIds },
  ): boolean {
    let changed = false;
    if (metadata.posterUrl) {
      const result = this.db
        .query(
          "UPDATE history_progress SET poster_url = ? WHERE title_id = ? AND (poster_url IS NULL OR poster_url = '')",
        )
        .run(metadata.posterUrl, titleId);
      changed ||= result.changes > 0;
    }
    const externalIdsJson = serializeExternalIds(metadata.externalIds);
    if (externalIdsJson) {
      const rows = this.db
        .query<{ key: string; external_ids_json: string | null }, [string]>(
          "SELECT key, external_ids_json FROM history_progress WHERE title_id = ?",
        )
        .all(titleId);

      for (const row of rows) {
        const existing = parseExternalIds(row.external_ids_json);
        const shouldReplaceEmpty = !row.external_ids_json;
        const merged = shouldReplaceEmpty
          ? metadata.externalIds
          : mergeBackfillExternalIds(existing, metadata.externalIds);
        const nextJson = serializeExternalIds(merged);
        if (!nextJson || nextJson === row.external_ids_json) continue;
        this.db
          .query("UPDATE history_progress SET external_ids_json = ? WHERE key = ?")
          .run(nextJson, row.key);
        changed = true;
      }

      this.titleAliases.upsertAliases(titleId, externalIdsToAliases(metadata.externalIds));
    }
    return changed;
  }

  listRecent(limit = 20): readonly HistoryProgress[] {
    return this.db
      .query<HistoryProgressRow, [number]>(
        "SELECT * FROM history_progress ORDER BY updated_at DESC LIMIT ?",
      )
      .all(limit)
      .map(mapHistoryRow);
  }

  listLatestByTitle(limit = 500): readonly HistoryProgress[] {
    return this.db
      .query<HistoryProgressRow, [number]>(
        `
          SELECT *
          FROM history_progress AS history
          WHERE history.key = (
            SELECT latest.key
            FROM history_progress AS latest
            WHERE latest.title_id = history.title_id
            ORDER BY latest.updated_at DESC, latest.created_at DESC, latest.key DESC
            LIMIT 1
          )
          ORDER BY history.updated_at DESC, history.created_at DESC
          LIMIT ?
        `,
      )
      .all(limit)
      .map(mapHistoryRow);
  }

  listByTitle(titleId: string, limit = 500): readonly HistoryProgress[] {
    return this.db
      .query<HistoryProgressRow, [string, number]>(
        `
          SELECT * FROM history_progress
          WHERE title_id = ?
          ORDER BY
            COALESCE(season, 0) ASC,
            COALESCE(episode, 0) ASC,
            updated_at DESC
          LIMIT ?
        `,
      )
      .all(titleId, limit)
      .map(mapHistoryRow);
  }

  listAllProgress(): readonly HistoryProgress[] {
    return this.db
      .query<HistoryProgressRow, []>("SELECT * FROM history_progress")
      .all()
      .map(mapHistoryRow);
  }

  rekeyProgressRow(oldKey: string, newTitleId: string, newKey: string): void {
    this.db
      .query("UPDATE history_progress SET key = ?, title_id = ? WHERE key = ?")
      .run(newKey, newTitleId, oldKey);
  }

  deleteProgressByKey(key: string): void {
    this.db.query("DELETE FROM history_progress WHERE key = ?").run(key);
  }

  updateProgressExternalIdsByKey(key: string, externalIds: ProviderExternalIds): void {
    const externalIdsJson = serializeExternalIds(externalIds);
    if (!externalIdsJson) return;
    this.db
      .query("UPDATE history_progress SET external_ids_json = ? WHERE key = ?")
      .run(externalIdsJson, key);
  }

  getProgressByKey(key: string): HistoryProgress | undefined {
    const row = this.db
      .query<HistoryProgressRow, [string]>("SELECT * FROM history_progress WHERE key = ?")
      .get(key);
    return row === null ? undefined : mapHistoryRow(row);
  }

  deleteTitle(titleId: string): void {
    this.db.query("DELETE FROM history_progress WHERE title_id = ?").run(titleId);
  }

  clear(): void {
    this.db.query("DELETE FROM history_progress").run();
  }
}

/**
 * Project a fully-materialized {@link HistoryProgress} row back into the
 * {@link HistoryProgressInput} shape accepted by {@link HistoryRepository.upsertProgress}.
 * Use when a caller holds a canonical row (e.g. just edited one in memory) and
 * needs to persist it without re-deriving each field by hand.
 */
export function historyProgressToInput(progress: HistoryProgress): HistoryProgressInput {
  return {
    title: {
      id: progress.titleId,
      kind: progress.mediaKind,
      title: progress.title,
      externalIds: progress.externalIds,
    },
    episode: {
      season: progress.season,
      episode: progress.episode,
      absoluteEpisode: progress.absoluteEpisode,
    },
    positionSeconds: progress.positionSeconds,
    durationSeconds: progress.durationSeconds,
    completed: progress.completed,
    watchedSeconds: progress.watchedSeconds,
    lastWatchedAt: progress.lastWatchedAt,
    completedAt: progress.completedAt ?? null,
    providerId: progress.providerId,
    posterUrl: progress.posterUrl,
    updatedAt: progress.updatedAt,
  };
}

export function createHistoryKey(
  title: Pick<TitleIdentity, "id" | "kind">,
  episode?: EpisodeIdentity,
): string {
  return [
    title.kind,
    title.id,
    episode?.season ?? "none",
    episode?.episode ?? "none",
    episode?.absoluteEpisode ?? "none",
  ].join(":");
}

function migrateLegacyProviderId(providerId: string): ProviderId {
  return (providerId === "vidking" ? "videasy" : providerId) as ProviderId;
}

function mapHistoryRow(row: HistoryProgressRow): HistoryProgress {
  return {
    key: row.key,
    titleId: row.title_id,
    mediaKind: row.media_kind,
    title: row.title,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    absoluteEpisode: row.absolute_episode ?? undefined,
    positionSeconds: row.position_seconds,
    durationSeconds: row.duration_seconds ?? undefined,
    watchedSeconds: row.watched_seconds,
    completed: row.completed === 1,
    providerId: row.provider_id === null ? undefined : migrateLegacyProviderId(row.provider_id),
    externalIds: parseExternalIds(row.external_ids_json),
    posterUrl: row.poster_url ?? undefined,
    lastWatchedAt: row.last_watched_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function resolveWatchedSeconds(
  input: HistoryProgressInput,
  existing: HistoryProgress | undefined,
): number {
  const prior = existing?.watchedSeconds ?? 0;
  if (input.watchedSeconds !== undefined) {
    return Math.max(prior, Math.max(0, Math.trunc(input.watchedSeconds)));
  }
  if (input.completed === true) {
    const duration = input.durationSeconds ?? existing?.durationSeconds ?? 0;
    if (duration > 0) return Math.max(prior, duration);
    return Math.max(prior, Math.trunc(input.positionSeconds));
  }
  const fromPosition = Math.min(
    Math.max(0, Math.trunc(input.positionSeconds)),
    input.durationSeconds ?? existing?.durationSeconds ?? Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(fromPosition)) {
    return prior;
  }
  return Math.max(prior, fromPosition);
}

function serializeExternalIds(externalIds: ProviderExternalIds | undefined): string | null {
  if (!externalIds || Object.keys(externalIds).length === 0) return null;
  return JSON.stringify(externalIds);
}

function parseProviderNativeIds(
  value: ProviderExternalIds["providerNativeIds"] | unknown,
): ProviderExternalIds["providerNativeIds"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const compact: Partial<Record<ProviderId, string>> = {};
  for (const [providerId, nativeId] of Object.entries(value)) {
    if (typeof nativeId !== "string" || !nativeId.trim()) continue;
    compact[providerId as ProviderId] = nativeId.trim();
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function parseExternalIds(value: string | null): ProviderExternalIds | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ProviderExternalIds>;
    const providerNativeIds = parseProviderNativeIds(parsed.providerNativeIds);
    const externalIds: ProviderExternalIds = {
      ...(typeof parsed.anilistId === "string" && parsed.anilistId
        ? { anilistId: parsed.anilistId }
        : {}),
      ...(typeof parsed.tmdbId === "string" && parsed.tmdbId ? { tmdbId: parsed.tmdbId } : {}),
      ...(typeof parsed.imdbId === "string" && parsed.imdbId ? { imdbId: parsed.imdbId } : {}),
      ...(typeof parsed.malId === "string" && parsed.malId ? { malId: parsed.malId } : {}),
      ...(providerNativeIds ? { providerNativeIds } : {}),
    };
    return Object.keys(externalIds).length > 0 ? externalIds : undefined;
  } catch {
    return undefined;
  }
}
