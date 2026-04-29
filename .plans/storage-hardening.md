# Kunai CLI Storage Plan

Status: CLI-first SQLite planned

Use this plan when changing config, history, stream cache, provider health cache, source inventory, resolve traces, local playback events, or future sync persistence.

## Current Decision

Kunai is pre-release and currently focused on the full-fledged CLI. Do not spend effort preserving repo-local `stream_cache.json` or old cache/history formats unless the project explicitly decides to support existing external users.

Use SQLite now for local runtime state:

```text
kunai-data.sqlite
  durable user data:
  - watch history
  - playback progress
  - local playback events
  - bookmarks later
  - subtitle/audio/provider preferences later

kunai-cache.sqlite
  disposable derived data:
  - stream cache
  - source inventory
  - provider health
  - resolve traces
  - metadata cache when safe
```

Config can remain JSON for now because it is low-churn and user-facing. Remote sync is not part of the current CLI phase.

## Why SQLite Now

JSON is acceptable for tiny single-process state, but Kunai is being remodeled before release. SQLite gives the CLI a better foundation now:

- indexed watch history and continue-watching queries
- appendable local playback events later
- cache TTL and pruning queries
- provider health aggregation
- source inventory lookups
- resolve trace ring buffers
- transaction safety
- WAL mode for future IPC/daemon pressure

Use `bun:sqlite` plus small typed repository classes. Do not introduce Prisma. Consider Drizzle only if query composition becomes painful after the schema proves itself.

## Package Direction

Create `packages/storage` as `@kunai/storage`.

```text
packages/storage/
  src/paths.ts
  src/sqlite.ts
  src/migrations.ts
  src/ttl.ts
  src/cache-key.ts
  src/repositories/history.ts
  src/repositories/stream-cache.ts
  src/repositories/provider-health.ts
  src/repositories/source-inventory.ts
  src/repositories/resolve-trace.ts
```

Storage package rules:

- expose typed repository APIs, not raw SQL to app code
- validate SQLite rows at the storage boundary with `@kunai/schemas`
- keep cache writes best-effort for playback
- never store raw signed media URLs in exportable reports
- keep durable data and disposable cache in separate DBs
- use idempotent migrations
- use WAL mode

## Storage Locations

Linux:

- Config JSON: `~/.config/kunai/config.json`
- Data DB: `~/.local/share/kunai/kunai-data.sqlite`
- Cache DB: `~/.cache/kunai/kunai-cache.sqlite`

macOS:

- Config JSON: `~/Library/Application Support/kunai/config.json`
- Data DB: `~/Library/Application Support/kunai/kunai-data.sqlite`
- Cache DB: `~/Library/Caches/kunai/kunai-cache.sqlite`

Windows:

- Config JSON: `%APPDATA%\kunai\config.json`
- Data DB: `%LOCALAPPDATA%\kunai\kunai-data.sqlite`
- Cache DB: `%LOCALAPPDATA%\kunai\kunai-cache.sqlite`

## Durable Data

### History

History belongs in `kunai-data.sqlite`.

Initial model:

- materialized latest progress per title/episode for fast Continue Watching
- provider used
- timestamps and duration
- completed/partial state

Later model:

- append-only local playback events
- materialized latest-progress view
- bookmarks
- local preference memory per title

Remote sync is much later and should build on the local event model.

### Preferences

Config remains JSON for now. Per-title subtitle/audio/provider preferences may move into SQLite when they become part of the CLI experience.

## Disposable Cache

### Stream Cache

Stream cache belongs in `kunai-cache.sqlite`.

Cache key fields should include:

```text
providerId
providerVersion
targetId
titleType
season
episode
audioLanguage
subtitleLanguage
qualityPreference
resolverRuntime
authMode
regionHint
```

TTL guidance:

- direct signed media URL: 30 seconds-5 minutes
- HLS master manifest URL: 2-15 minutes
- embed URL: 15-60 minutes if provider-stable
- subtitle list: 24 hours
- source inventory without final URL: 15-60 minutes
- provider mapping: hours to days depending on source

Cache writes should be best-effort. Playback must continue if a cache write fails.

### Provider Health

Provider health belongs in `kunai-cache.sqlite`.

Track:

- provider ID
- status
- last success/failure
- median resolve time
- recent failure rate
- subtitle success rate
- stream survival hints

Provider health should inform source confidence and fallback ranking. It must never block playback.

### Resolve Trace Store

Resolve traces belong in `kunai-cache.sqlite` as a bounded ring buffer.

Trace storage rules:

- redact headers and signed URLs
- keep enough context for diagnostics
- prune by count and age
- export only through explicit user action later

## Implementation Phases

### Phase 3A: Storage Foundation

1. Create `@kunai/storage`.
2. Add OS path resolver.
3. Add SQLite connection helper.
4. Add migration runner.
5. Add initial `kunai-data.sqlite` and `kunai-cache.sqlite` migrations.
6. Add TTL and cache-key helpers.
7. Add repository interfaces and basic tests.

### Phase 3B: CLI Wiring

1. Replace JSON history with SQLite history.
2. Replace JSON stream cache with SQLite stream cache.
3. Remove repo-local cache assumptions.
4. Update settings/copy/diagnostics to show the real local storage model.
5. Keep config JSON.

### Phase 3C: CLI Intelligence Stores

1. Add provider health persistence.
2. Add source inventory persistence.
3. Add resolve trace ring buffer persistence.
4. Surface these in diagnostics/cache inspector.

### Phase 3D: Local Playback Events

1. Add append-only local playback event table.
2. Keep materialized latest progress for fast UI.
3. Use this for stronger history semantics and future sync readiness.

Remote sync is not scheduled in the current CLI-first phase.

## Acceptance Criteria

- app no longer writes default stream cache to the repo root
- history and stream cache use SQLite
- DB paths are OS-correct
- migrations are idempotent
- cache entries carry expiry and schema version
- cache pruning prevents unbounded growth
- playback continues if cache writes fail
- storage paths in README, AGENTS, quickstart, and diagnostics match runtime behavior
