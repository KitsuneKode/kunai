import type { KunaiDatabase } from "./sqlite";

export type MigrationDatabase = "data" | "cache";

export interface Migration {
  readonly id: string;
  readonly database: MigrationDatabase;
  readonly sql: string;
}

export const dataMigrations: readonly Migration[] = [
  {
    id: "001_data_history_progress",
    database: "data",
    sql: `
      CREATE TABLE IF NOT EXISTS history_progress (
        key TEXT PRIMARY KEY,
        title_id TEXT NOT NULL,
        media_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        absolute_episode INTEGER,
        position_seconds INTEGER NOT NULL DEFAULT 0,
        duration_seconds INTEGER,
        completed INTEGER NOT NULL DEFAULT 0,
        provider_id TEXT,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_history_progress_updated_at
        ON history_progress(updated_at DESC);
    `,
  },
  {
    id: "002_data_playback_events",
    database: "data",
    sql: `
      CREATE TABLE IF NOT EXISTS playback_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        title_id TEXT NOT NULL,
        media_kind TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        position_seconds INTEGER,
        duration_seconds INTEGER,
        provider_id TEXT,
        at TEXT NOT NULL,
        payload_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_playback_events_title_at
        ON playback_events(title_id, at DESC);
    `,
  },
  {
    id: "003_data_download_jobs",
    database: "data",
    sql: `
      CREATE TABLE IF NOT EXISTS download_jobs (
        id TEXT PRIMARY KEY,
        title_id TEXT NOT NULL,
        title_name TEXT NOT NULL,
        media_kind TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        provider_id TEXT NOT NULL,
        stream_url TEXT NOT NULL,
        headers_json TEXT NOT NULL,
        status TEXT NOT NULL,
        progress_percent INTEGER NOT NULL DEFAULT 0,
        output_path TEXT NOT NULL,
        temp_path TEXT NOT NULL,
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_download_jobs_status_created
        ON download_jobs(status, created_at ASC);

      CREATE INDEX IF NOT EXISTS idx_download_jobs_title_created
        ON download_jobs(title_id, created_at DESC);
    `,
  },
  {
    id: "004_data_download_jobs_runtime",
    database: "data",
    sql: `
      ALTER TABLE download_jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE download_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE download_jobs ADD COLUMN next_retry_at TEXT;
      ALTER TABLE download_jobs ADD COLUMN started_at TEXT;
      ALTER TABLE download_jobs ADD COLUMN last_heartbeat_at TEXT;
      ALTER TABLE download_jobs ADD COLUMN failure_kind TEXT;

      CREATE INDEX IF NOT EXISTS idx_download_jobs_status_retry
        ON download_jobs(status, next_retry_at ASC, created_at ASC);
    `,
  },
  {
    id: "005_data_download_jobs_offline",
    database: "data",
    sql: `
      ALTER TABLE download_jobs ADD COLUMN subtitle_url TEXT;
      ALTER TABLE download_jobs ADD COLUMN subtitle_path TEXT;
      ALTER TABLE download_jobs ADD COLUMN subtitle_language TEXT;
      ALTER TABLE download_jobs ADD COLUMN intro_skip_json TEXT;
      ALTER TABLE download_jobs ADD COLUMN duration_ms INTEGER;
      ALTER TABLE download_jobs ADD COLUMN file_size INTEGER;
    `,
  },
  {
    id: "006_data_download_jobs_intent",
    database: "data",
    sql: `
      ALTER TABLE download_jobs ADD COLUMN mode TEXT;
      ALTER TABLE download_jobs ADD COLUMN sub_lang TEXT;
      ALTER TABLE download_jobs ADD COLUMN anime_lang TEXT;
      ALTER TABLE download_jobs ADD COLUMN selected_source_id TEXT;
      ALTER TABLE download_jobs ADD COLUMN selected_stream_id TEXT;
      ALTER TABLE download_jobs ADD COLUMN selected_quality_label TEXT;
      ALTER TABLE download_jobs ADD COLUMN artifact_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE download_jobs ADD COLUMN last_resolved_provider_id TEXT;

      CREATE INDEX IF NOT EXISTS idx_download_jobs_artifact_status
        ON download_jobs(artifact_status, updated_at DESC);
    `,
  },
  {
    id: "007_data_download_jobs_media_artifacts",
    database: "data",
    sql: `
      ALTER TABLE download_jobs ADD COLUMN poster_url TEXT;
      ALTER TABLE download_jobs ADD COLUMN thumbnail_path TEXT;
    `,
  },
  {
    id: "008_data_download_jobs_artifact_cache",
    database: "data",
    sql: `
      ALTER TABLE download_jobs ADD COLUMN last_validated_at TEXT;
    `,
  },
  {
    id: "009_data_lists",
    database: "data",
    sql: `
      CREATE TABLE IF NOT EXISTS lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS list_items (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        title_id TEXT NOT NULL,
        media_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        notes TEXT,
        added_at TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_list_items_list_id
        ON list_items(list_id, sort_order ASC);

      CREATE INDEX IF NOT EXISTS idx_list_items_title_id
        ON list_items(title_id, added_at DESC);

      CREATE TABLE IF NOT EXISTS playlist_queue (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        media_kind TEXT NOT NULL,
        title_id TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        absolute_episode INTEGER,
        priority INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL,
        added_at TEXT NOT NULL,
        played_at TEXT,
        session_id TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_playlist_queue_priority
        ON playlist_queue(priority DESC, added_at ASC);

      CREATE INDEX IF NOT EXISTS idx_playlist_queue_session
        ON playlist_queue(session_id, priority DESC, added_at ASC);

      INSERT OR IGNORE INTO lists (id, name, kind, sort_order, created_at, updated_at)
        VALUES ('watchlist', 'Watchlist', 'watchlist', 0, datetime('now'), datetime('now'));

      INSERT OR IGNORE INTO lists (id, name, kind, sort_order, created_at, updated_at)
        VALUES ('favorites', 'Favorites', 'favorites', 1, datetime('now'), datetime('now'));
    `,
  },
  {
    id: "010_data_queue_sessions",
    database: "data",
    sql: `
      CREATE TABLE IF NOT EXISTS playback_queue_sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT
      );

      ALTER TABLE playlist_queue ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE playlist_queue ADD COLUMN queue_position INTEGER;
      ALTER TABLE playlist_queue ADD COLUMN completed_at TEXT;

      CREATE INDEX IF NOT EXISTS idx_playback_queue_sessions_status
        ON playback_queue_sessions(status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_playlist_queue_status_position
        ON playlist_queue(session_id, status, queue_position ASC, priority DESC, added_at ASC);
    `,
  },
  {
    id: "011_data_notifications",
    database: "data",
    sql: `
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        dedup_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        item_json TEXT,
        action_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        dismissed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_recent
        ON notifications(dismissed_at, updated_at DESC);
    `,
  },
  {
    id: "012_data_followed_titles",
    database: "data",
    sql: `
      CREATE TABLE IF NOT EXISTS followed_titles (
        title_id TEXT PRIMARY KEY,
        media_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        preference TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_followed_titles_preference
        ON followed_titles(preference, updated_at DESC);
    `,
  },
  {
    id: "013_data_durable_playlists",
    database: "data",
    sql: `
      CREATE TABLE IF NOT EXISTS user_playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_playlist_items (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE,
        title_id TEXT NOT NULL,
        media_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        absolute_episode INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        provider_hints_json TEXT,
        notes TEXT,
        added_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_playlist_items_playlist_order
        ON user_playlist_items(playlist_id, sort_order ASC, added_at ASC);

      CREATE INDEX IF NOT EXISTS idx_user_playlist_items_title
        ON user_playlist_items(title_id, media_kind);
    `,
  },
  {
    id: "014_data_history_external_ids",
    database: "data",
    sql: `
      ALTER TABLE history_progress ADD COLUMN external_ids_json TEXT;
    `,
  },
  {
    id: "015_data_download_jobs_repair_metadata",
    database: "data",
    sql: `
      ALTER TABLE download_jobs ADD COLUMN repair_metadata_json TEXT;

      CREATE INDEX IF NOT EXISTS idx_download_jobs_repairable
        ON download_jobs(status, artifact_status, updated_at DESC);
    `,
  },
  {
    id: "016_data_download_job_episode_intent_index",
    database: "data",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_download_jobs_episode_intent
        ON download_jobs(title_id, season, episode, status, updated_at DESC);
    `,
  },
  {
    id: "017_data_offline_library_assets",
    database: "data",
    sql: `
      CREATE TABLE IF NOT EXISTS offline_assets (
        id TEXT PRIMARY KEY,
        identity_key TEXT NOT NULL UNIQUE,
        title_id TEXT NOT NULL,
        title_name TEXT NOT NULL,
        media_kind TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        profile_key TEXT NOT NULL,
        origin_job_id TEXT REFERENCES download_jobs(id) ON DELETE SET NULL,
        file_path TEXT NOT NULL,
        state TEXT NOT NULL,
        byte_size INTEGER,
        duration_ms INTEGER,
        timing_json TEXT,
        last_validated_at TEXT,
        protected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_offline_assets_title_episode
        ON offline_assets(title_id, season, episode, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_offline_assets_ready_title
        ON offline_assets(state, title_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS offline_asset_tracks (
        asset_id TEXT NOT NULL REFERENCES offline_assets(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        language TEXT NOT NULL,
        file_path TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(asset_id, kind, language)
      );

      CREATE TABLE IF NOT EXISTS offline_asset_artwork (
        asset_id TEXT NOT NULL REFERENCES offline_assets(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        file_path TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(asset_id, kind)
      );

      CREATE TABLE IF NOT EXISTS offline_title_policies (
        title_id TEXT PRIMARY KEY,
        media_kind TEXT NOT NULL,
        title_name TEXT NOT NULL,
        enrolled INTEGER NOT NULL DEFAULT 0,
        runway_target INTEGER NOT NULL DEFAULT 0,
        profile_json TEXT NOT NULL,
        cleanup_json TEXT NOT NULL,
        paused_reason TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_offline_title_policies_enrolled
        ON offline_title_policies(enrolled, updated_at DESC);

      CREATE TABLE IF NOT EXISTS offline_maintenance_jobs (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES offline_assets(id) ON DELETE CASCADE,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_maintenance_active_operation
        ON offline_maintenance_jobs(asset_id, operation)
        WHERE status IN ('queued', 'running');
      CREATE INDEX IF NOT EXISTS idx_offline_maintenance_runnable
        ON offline_maintenance_jobs(status, created_at ASC);
    `,
  },
  {
    id: "018_data_history_reclassify_anime",
    database: "data",
    // mediaKind was historically mode-derived, so dramas watched in anime mode
    // (AllAnime hosts live-action C/K-dramas) were stamped "anime". Re-derive from
    // the stored external ids: a row is only really anime if it carries an
    // AniList/MAL id (those DBs only catalog anime). Idempotent; future writes use
    // resolveContentKind. See domain/media/content-kind.ts.
    sql: `
      UPDATE history_progress
        SET media_kind = 'series'
        WHERE media_kind = 'anime'
          AND (
            external_ids_json IS NULL
            OR (
              external_ids_json NOT LIKE '%"anilistId"%'
              AND external_ids_json NOT LIKE '%"malId"%'
            )
          );
    `,
  },
];

export const cacheMigrations: readonly Migration[] = [
  {
    id: "001_cache_stream_cache",
    database: "cache",
    sql: `
      CREATE TABLE IF NOT EXISTS stream_cache (
        cache_key TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        provider_id TEXT NOT NULL,
        stream_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_stream_cache_expires_at
        ON stream_cache(expires_at);
    `,
  },
  {
    id: "002_cache_provider_health",
    database: "cache",
    sql: `
      CREATE TABLE IF NOT EXISTS provider_health (
        provider_id TEXT PRIMARY KEY,
        health_json TEXT NOT NULL,
        checked_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_provider_health_checked_at
        ON provider_health(checked_at DESC);
    `,
  },
  {
    id: "003_cache_source_inventory",
    database: "cache",
    sql: `
      CREATE TABLE IF NOT EXISTS source_inventory (
        inventory_key TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        title_id TEXT NOT NULL,
        inventory_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_source_inventory_expires_at
        ON source_inventory(expires_at);
    `,
  },
  {
    id: "004_cache_resolve_traces",
    database: "cache",
    sql: `
      CREATE TABLE IF NOT EXISTS resolve_traces (
        trace_id TEXT PRIMARY KEY,
        trace_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_resolve_traces_started_at
        ON resolve_traces(started_at DESC);
    `,
  },
  {
    id: "005_cache_recommendation_cache",
    database: "cache",
    sql: `
      CREATE TABLE IF NOT EXISTS recommendation_cache (
        cache_key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_recommendation_cache_expires_at
        ON recommendation_cache(expires_at);
    `,
  },
  {
    id: "006_cache_schedule_cache",
    database: "cache",
    sql: `
      CREATE TABLE IF NOT EXISTS schedule_cache (
        cache_key TEXT PRIMARY KEY,
        source TEXT,
        mode TEXT,
        payload_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_schedule_cache_expires_at
        ON schedule_cache(expires_at);

      CREATE INDEX IF NOT EXISTS idx_schedule_cache_mode
        ON schedule_cache(mode, expires_at);
    `,
  },
  {
    id: "007_cache_release_progress",
    database: "cache",
    sql: `
      CREATE TABLE IF NOT EXISTS release_progress_cache (
        title_id TEXT PRIMARY KEY,
        media_kind TEXT NOT NULL,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        anchor_season INTEGER,
        anchor_episode INTEGER NOT NULL,
        latest_aired_season INTEGER,
        latest_aired_episode INTEGER,
        new_episode_count INTEGER NOT NULL DEFAULT 0,
        next_airing_season INTEGER,
        next_airing_episode INTEGER,
        next_airing_at TEXT,
        latest_known_release_at TEXT,
        status TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        next_check_at TEXT NOT NULL,
        stale_after_at TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        error_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_release_progress_next_check
        ON release_progress_cache(next_check_at ASC);

      CREATE INDEX IF NOT EXISTS idx_release_progress_status
        ON release_progress_cache(status, new_episode_count DESC);

      CREATE INDEX IF NOT EXISTS idx_release_progress_stale_after
        ON release_progress_cache(stale_after_at ASC);
    `,
  },
  {
    id: "008_cache_title_provider_health",
    database: "cache",
    sql: `
      CREATE TABLE IF NOT EXISTS title_provider_health (
        title_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        health_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (title_id, provider_id)
      );

      CREATE INDEX IF NOT EXISTS idx_title_provider_health_expires_at
        ON title_provider_health(expires_at ASC);
    `,
  },
  {
    id: "009_cache_release_progress_new_season",
    database: "cache",
    sql: `
      ALTER TABLE release_progress_cache ADD COLUMN new_season_json TEXT;
    `,
  },
];

export function runMigrations(
  db: KunaiDatabase,
  database: MigrationDatabase,
  migrations: readonly Migration[] = database === "data" ? dataMigrations : cacheMigrations,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __kunai_migrations (
      id TEXT PRIMARY KEY,
      database_name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .query<{ id: string }, [string]>(
        "SELECT id FROM __kunai_migrations WHERE database_name = ? ORDER BY id",
      )
      .all(database)
      .map((row) => row.id),
  );

  const applyMigration = db.transaction((migration: Migration, now: string) => {
    db.exec(migration.sql);
    db.query("INSERT INTO __kunai_migrations (id, database_name, applied_at) VALUES (?, ?, ?)").run(
      migration.id,
      migration.database,
      now,
    );
  });

  for (const migration of migrations) {
    if (migration.database !== database || applied.has(migration.id)) {
      continue;
    }

    applyMigration(migration, new Date().toISOString());
  }
}
