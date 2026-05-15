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
