---
status: current
lastReviewed: "2026-08-24"
---

# Kunai — Runtime Architecture

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Use this doc first when changing flow control, playback lifecycle, provider orchestration, persistence, or any code that affects recovery behavior.

This is the canonical architecture entry doc. It explains:

- the current production runtime shape
- the boundaries that already exist and should not be broken casually
- where to read next depending on whether you are fixing current behavior or implementing the persistent-shell target

Read next:

- current runtime and invariants: this file
- target runtime direction: [.docs/architecture-v2.md](./architecture-v2.md)
- shell and interaction model: [.docs/ux-architecture.md](./ux-architecture.md)
- implementation sequencing: [.plans/persistent-shell-implementation.md](../.plans/persistent-shell-implementation.md)

## System Shape

Kunai is a terminal CLI that:

1. Searches titles
2. Lets the user pick a title, season, episode, and provider
3. Resolves a playable stream URL
4. Launches `mpv`
5. Returns to the same shell for post-playback actions, settings, and provider changes

```text
user input -> Ink shell -> picker -> ProviderEngine resolve -> direct HTTP provider modules
    -> PlaybackRouter -> LocalPlaybackBackend -> mpv -> shell
                      -> GoogleCastPlaybackBackend -> Google Cast receiver
```

## Entrypoint

`apps/cli/src/main.ts` is the only runtime entrypoint. It owns the DI container,
config service, history store, cache store, provider registry, shared shell
workflows, and the search/playback phases. Package scripts and the build both
point at it.

The old `apps/cli/index.ts` compatibility wrapper has been **removed**. Do not
reintroduce a second entrypoint; migrate behavior into `main.ts` instead.

## Control Flow

The old legacy two-loop runtime has been collapsed into the `apps/cli/src/main.ts` path. Preserve search/playback boundaries in the new state-driven runtime instead of reviving a second entrypoint.

## Runtime Modules

| Area                  | Files                                                                                   | Responsibility                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Entry + orchestration | `apps/cli/src/main.ts`, `apps/cli/src/app/*`                                            | The only entrypoint; `app/` holds bootstrap, session, search, playback, discover, post-play, offline phases |
| DI + provider engine  | `apps/cli/src/container/*` (`container.ts` is a re-export barrel)                       | `bootstrap-providers.ts` builds the engine; also wires SQLite repos, resolve/download/presence services     |
| Shell UI              | `apps/cli/src/app-shell/*`, `apps/cli/src/session-flow.ts`                              | Ink shell, commands, settings, history, and structured pickers                                              |
| Search                | `apps/cli/src/search.ts`, `apps/cli/src/services/search/*`, `apps/cli/src/app/search/*` | Search backends, metadata fetches, and routing policy                                                       |
| Catalog metadata      | `apps/cli/src/tmdb.ts`, `apps/cli/src/services/catalog/*`                               | TMDB/Videasy season data and title enrichment (migration target: catalog services)                          |
| Playback routing      | `apps/cli/src/services/playback/PlaybackRouter.ts`                                      | Selects a target backend; local playback remains the default                                                |
| Local playback        | `apps/cli/src/services/playback/LocalPlaybackBackend.ts`, `apps/cli/src/infra/player/*` | Adapts the existing `PlayerService`; owns `mpv` launch, IPC, and Lua-assisted progress tracking             |
| Google Cast playback  | `apps/cli/src/services/playback/cast/*`                                                 | Experimental mDNS discovery, Cast V2 control, and direct-compatible receiver playback                       |
| Persistence           | `apps/cli/src/services/persistence/*`, `packages/storage`                               | Config JSON, SQLite history/cache, tuning                                                                   |
| Providers             | `packages/providers/src/*`, `apps/cli/src/services/providers/ProviderRegistry.ts`       | Direct HTTP provider modules + CLI registry adapter                                                         |
| Terminal UI           | `apps/cli/src/menu.ts`, `packages/design`                                               | ANSI helpers, design tokens, posters                                                                        |
| Observability         | `apps/cli/src/logger.ts`, `apps/cli/src/services/diagnostics/*`                         | Structured debug logs and diagnostics events                                                                |

If your change is broad enough to blur these module boundaries, stop and check whether the work belongs in the v2 migration path instead.

Diagnostics note:

- the new runtime also keeps a small in-memory diagnostics event buffer for live inspection in the diagnostics overlay
- the new runtime preserves browse search state across pre-playback cancel paths, so episode-picker escape can return to the prior result list without a fresh search
- startup mode is now part of persisted config and is applied by `apps/cli/src/main.ts` before the session loop starts
- mpv now exits normally at episode EOF; auto-next decisions happen in the playback phase so the shell can keep control of the transition
- **Skip timing (IntroDB / AniSkip, MAL resolution, provider context):** [.docs/playback-timing-and-aniskip.md](./playback-timing-and-aniskip.md)
- this is currently the main developer-facing trace surface inside the shell while broader report/export work is still pending

## Provider Model

Active beta providers implement `CoreProviderModule` in `packages/providers/src/*/direct.ts` and are registered in `apps/cli/src/container/bootstrap-providers.ts` — `loadProductionProviderModules()` lazily imports each module, then `createProviderEngine({ modules: [...] })` builds the engine. The CLI `ProviderRegistry` is a compatibility wrapper over the engine.

A module existing under `packages/providers/src/` does **not** make it a production provider; only membership in `loadProductionProviderModules()` does.

Legacy Playwright provider shapes remain under `.archive/legacy/apps/cli/src/providers/` for reference only. They are not part of the active beta runtime.

Use [.docs/providers.md](./providers.md) for provider-specific details.

For new providers or major provider hardening, do not jump straight from this doc into code. Use:

- [.docs/provider-intake.md](./provider-intake.md)
- [.docs/provider-agent-workflow.md](./provider-agent-workflow.md)
- [.docs/provider-examples.md](./provider-examples.md)

## Why Key Decisions Exist

| Decision                          | Reason                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| Direct-provider modules first     | Active beta providers resolve over HTTP/provider APIs without launching browser runtime |
| Archive Playwright reference code | Browser interception remains useful for research evidence, not production defaults      |
| Future runtime-browser package    | Any renewed Playwright path should be isolated behind a runtime boundary/lease model    |
| Detached `mpv`                    | Keeps the terminal usable and matches ani-cli style behavior                            |
| Lua position reporter             | `mpv` does not reliably expose final playback position on exit                          |
| Search-service registry           | Keeps room for multiple search backends without hardwiring everything into one provider |
| `isAnimeProvider` flag            | Anime routing should be explicit and cheap to evaluate                                  |

Identity (`ContentKind`: anime / series / movie / video) is the badge, history stamp, and language profile. Structure (`TitleInfo.type`: movie / series) is whether season/episode chrome is product-visible. An AniList `format: MOVIE` title is kind `anime` and type `movie` — `@ anime`, runtime, no S/E. Host episode lists do not override catalog format.

## Critical Invariants

### Provider and anime invariants

- `isAnimeProvider: true` is what includes a provider in anime mode
- Episode numbering in the UI is always 1-based
- `packages/providers/src/allmanga/api-client.ts` should stay aligned with the specific ani-cli/AllManga-inspired API assumptions it implements unless the codebase deliberately chooses a new contract

### AllManga-Compatible API-client invariants

- `KNOWN_SOURCES = ["Default", "Yt-mp4", "S-mp4", "Luf-Mp4", "Fm-mp4", "Ak"]`
- `hexDecode` mirrors ani-cli provider decoding logic
- Episode source resolve uses persisted GET + `aaReq` AES-256-GCM attestation (`x-build-id`, epoch/build_id); missing `aaReq` yields `AA_CRYPTO_MISSING`
- Response blob decrypt is `AES-256-CTR` with the ani-cli hex key (not SHA-256 of a passphrase)
- The current blob layout is `1-byte version prefix + 12-byte IV + ciphertext + 16-byte footer`
- IV is derived from bytes `1..12` of the provider blob
- `counter[15] = 2`
- `countryOrigin: "ALL"` is required for broad search coverage
- `tobeparsed` stays out of the GraphQL selection set
- `m3u8Referer` comes from the JSON response body, not the static config referer
- Keep crypto constants aligned with ani-cli `origin/fix` (`get_aa_req`) when upstream rotates

This parity policy only applies to the concrete AllAnime / AllManga-style API client and other deliberate compatibles. It is not a universal standard for every anime provider in the repo.

## Playback and Recovery

### Queue playback lifecycle

Up Next / playlist queue consumption is a compare-and-set state machine owned by
storage (`packages/storage` queue repository) and applied by domain/app adapters
(`QueueService`, `createQueuePlaybackAttempt`, PlaybackPhase):

- Lifecycle is exactly `pending → in-flight → played` (plus `skipped` / `failed`
  for non-playback exits).
- Only confirmed `playback-started` acknowledges a claimed row. Process spawn and
  IPC connection are insufficient.
- Every handoff carries the exact queue entry ID and absolute anime episode
  identity when present; auto-next and post-play must not substitute a reordered
  head.
- Pre-start failure restores the same row and position with failure context.
- Crash / handled shutdown leaves `in-flight` work recoverable; restart restore
  prefers that exact row as the resume head and never autoplays.
- Finished content without authoritative release evidence is up to date — do not
  fabricate a next episode from catalog bounds alone.

Contract proof (fake-player / render-capture, no live providers):
`apps/cli/test/integration/queue-playback-lifecycle.test.ts`. Product vocabulary:
[.docs/features/queue.md](./features/queue.md).

### Provider resolve flow

Production resolution is browserless by default:

1. `apps/cli/src/container/bootstrap-providers.ts` (`loadProductionProviderModules()`) selects the registered provider modules.
2. `apps/cli/src/services/playback/PlaybackResolveService.ts` coordinates cache, inventory, health, and fallback policy.
3. `packages/core` runs the bounded provider engine.
4. `packages/providers/src/*/direct.ts` returns stream, subtitle, source, and trace facts.
5. Legacy Playwright interception remains quarantined under `.archive/legacy/` and is not imported by the active runtime.

### `mpv` flow

`apps/cli/src/mpv.ts`:

- launches and registers the owned `mpv` child for shutdown backstop cleanup
- binds the active one-shot control to a playback generation and abort signal,
  so shutdown stops the current player without clearing a replacement's control
- connects Bun IPC and derives readiness, progress, EOF, tracks, and playback
  start from observed player events
- treats IPC bootstrap failure as an ownership failure: terminate and reap the
  exact spawned child before provider fallback can create another player
- keeps socket cleanup and final playback stats bounded after process exit

This is part of the repo's reliability contract. Changes are fine, but recovery under kill signals, EOF, or expired stream URLs needs to remain solid.

Observability matters here too: failures around stream resolution, cache reuse, or provider retries should leave enough logging context to explain what path the app took.

## Persistence and Data Ownership

| Data          | Path                                | Owner                                |
| ------------- | ----------------------------------- | ------------------------------------ |
| Config        | `~/.config/kunai/config.json`       | `ConfigService` + `ConfigStoreImpl`  |
| Watch history | OS app data dir `kunai-data.sqlite` | `@kunai/storage` + CLI history store |
| Stream cache  | OS cache dir `kunai-cache.sqlite`   | `@kunai/storage` + CLI cache store   |
| Debug logs    | `./logs.txt`                        | `apps/cli/src/logger.ts`             |

**Watch ledger (2026-06):** `history_progress` is the single source of truth for resume position, completion, and engaged watch time. Columns `watched_seconds`, `last_watched_at`, and `completed_at` (migration `024`) back Stats and continuation. All mark-watched/unwatched surfaces write through `HistoryRepository.markWatched` / `markUnwatched` (preserve resume on unmark). `playback_events` receives fire-and-forget instrumentation from the mpv position tick via `PlaybackEventRepository`. Stats aggregation lives in `WatchStatsRepository` (`packages/storage`).

**Title writes are additive on identity (2026-08):** a write carries whatever metadata its launching lane happened to have, and a lane that knows less than the stored row must never subtract from it. `HistoryRepository.upsertProgress` takes progress fields (position, duration, completion, provider) from the newest write, but protects identity: `poster_url` is `COALESCE`d, `external_ids_json` is merged (stored ids win per key), and a title that is a placeholder for its own id — `TMDB <id>` from `-i/--id`, or a share ref that named a title after itself — never replaces a real stored name. `ListRepository.addItem` and `FollowedTitleRepository.upsert` follow the same rule, so re-adding a title to a Watchlist or muting it cannot rename it. Placeholder names are minted and recognised in one place, `@kunai/core` `directIdTitleName` / `isPlaceholderTitleName`, because both the CLI and storage have to agree on the shape.

This matters beyond rendering: with `external_ids_json` erased and a bare title id, `resolveTmdbIdentity` (`services/sync/sync-identity.ts`) returns `null` and the row silently stops mirroring to the user's tracker.

A session upgrades its own working `TitleInfo` the moment the catalog answers, through `domain/catalog/apply-title-detail.ts` — used by both `PlaybackPhase` and the `SET_TITLE_DETAIL` reducer, so the rendered title and the persisted one cannot disagree. `--download` never reaches `PlaybackPhase`, so it resolves the same way up front via `app/bootstrap/resolve-placeholder-title.ts`; that lane matters most because `resolveDownloadOutputPath` builds the folder and file name from the title, and no later heal can rename a file on disk. Rows written before that (their title still a placeholder) are repaired at startup by `HistoryMetadataHealer`, which resolves them by **id** rather than by searching their own text; a placeholder over an opaque provider-native id is left alone, because nothing could resolve it and a wrong repair is unrecoverable.

The SQLite storage model is described in [.plans/storage-hardening.md](../.archive/plans/storage-hardening.md), with durable history/progress in the OS app data directory and disposable cache in the OS cache directory.

Automatic storage maintenance is conservative:

- it may prune expired `stream_cache`, `source_inventory`, `recommendation_cache`, and `schedule_cache` rows
- it may cap `resolve_traces` and age out stale provider-health cache
- it may run `PRAGMA optimize` and an explicit passive WAL checkpoint
- it is admitted through the owned background-work scheduler only after the
  persistent shell mounts, then yields an event-loop turn before synchronous
  SQLite begins; shutdown cancels admission and drains active work before the
  database handles close
- it must not run automatic `VACUUM`
- it must not delete user-owned facts such as `history_progress`, lists, config, sync tokens, or completed download records

When adding a new table, decide whether it is durable user data or recomputable cache before wiring cleanup. Durable tables belong in the data DB and are never automatically pruned without an explicit user action or migration plan. Cache tables belong in the cache DB and need a TTL, cap, or documented retention rule plus a maintenance test.

Migration rule:

- do not add new architecture around repo-local `stream_cache.json`
- do not treat old JSON history/cache as a compatibility contract unless external-user support is explicitly reintroduced
- keep config and provider overrides as JSON for now

## Migration Guidance

If you are touching architecture during the persistent-shell rewrite, follow this rule:

- this file describes the current runtime
- `architecture-v2.md` describes the target runtime
- the implementation plan decides the order of migration

Do not silently update one without checking whether the others should also move.

## External Services

| Service                | Purpose                             |
| ---------------------- | ----------------------------------- |
| `db.videasy.net`       | TMDB-format search and season proxy |
| `api.themoviedb.org`   | fallback season metadata            |
| `api.allanime.day`     | AllAnime GraphQL                    |
| `anime-db.videasy.net` | HiAnime search                      |
| `sub.wyzie.io`         | subtitle lookup                     |
| `image.tmdb.org`       | poster images                       |
