# Feature Map

Routing table from a user-visible feature to the code that owns it. Use this to
answer "where does X live" without grepping the whole tree.

**This file routes; it does not describe behavior.** For behavior, read the
owning code or the doc in the last column. If a row disagrees with the tree, the
tree is right — fix the row.

Verified against the tree on 2026-08-14. Paths are checked by
`bun run verify:doc-paths`.

## How a session flows

```text
cli-args.ts → main.ts → container/ → app/bootstrap → app/session (SessionController)
                                          ↓
          app/search ⇄ app-shell (Ink)  →  app/playback (PlaybackPhase)
                                          ↓
   services/playback → @kunai/core engine → @kunai/providers → infra/player (mpv)
                                          ↓
                          app/post-play → packages/storage (history, queue)
```

## Launch surface

| Feature                                                             | Owned by                                                               | Docs                                                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Flag parsing (33 flags)                                             | `apps/cli/src/cli-args.ts`, re-exported as `main.ts` `parseArgs()`     | `docs/users/cli-reference.mdx` (generated from `--help`)                                            |
| Modes: `-a` anime, `-y` youtube, `-m` minimal, `-z` zen, `-q` quick | `apps/cli/src/app/session/*`                                           | [.plans/kunai-execution-passes-and-cli-modes.md](../.plans/kunai-execution-passes-and-cli-modes.md) |
| Bootstrap, first run, `--setup`                                     | `apps/cli/src/app/bootstrap/*`                                         | [download-offline-onboarding.md](./download-offline-onboarding.md)                                  |
| `--open` / `kunai://` protocol                                      | `apps/cli/src/domain/share/*`, `app/bootstrap/resolve-share-target.ts` | [share-links.md](./share-links.md)                                                                  |
| Container / DI wiring                                               | `apps/cli/src/container/*` (`container.ts` is a barrel)                | [architecture.md](./architecture.md)                                                                |

## Shell (Ink)

| Feature                                                       | Owned by                                          | Docs                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Command palette, `/` commands                                 | `apps/cli/src/domain/session/command-registry.ts` | [ux-architecture.md](./ux-architecture.md)                            |
| Keybindings                                                   | `apps/cli/src/app-shell/keybindings.ts`           | [keybindings.md](./keybindings.md)                                    |
| Shell host, overlays, footer                                  | `apps/cli/src/app-shell/*`                        | [ux-architecture.md](./ux-architecture.md)                            |
| Pickers (episode, provider, source, quality, audio, subtitle) | `apps/cli/src/app-shell/pickers/*`                | [runtime-boundary-map.md](./runtime-boundary-map.md#picker-ownership) |
| Settings overlay                                              | `apps/cli/src/app-shell/settings/*`               | [ux-architecture.md](./ux-architecture.md)                            |
| Theme + design tokens                                         | `packages/design`                                 | [design-system.md](./design-system.md)                                |
| Poster previews (Kitty / iTerm2 / sixel / half-block)         | `apps/cli/src/image/*`                            | [poster-image-rendering.md](./poster-image-rendering.md)              |

## Search and catalog

| Feature                               | Owned by                                                                                                        | Docs                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Search routing and backends           | `apps/cli/src/services/search/*`, `apps/cli/src/app/search/*`                                                   | [.plans/search-service.md](../.plans/search-service.md)              |
| Search intent parsing                 | `apps/cli/src/domain/search/*` — `SearchIntentParser` / `SearchIntentEngine` turn raw input into a typed intent | [.plans/search-service.md](../.plans/search-service.md)              |
| TMDB season/episode metadata          | `apps/cli/src/tmdb.ts`, `apps/cli/src/services/catalog/*`                                                       | [architecture.md](./architecture.md)                                 |
| Anime identity / title reconciliation | `apps/cli/src/domain/catalog/*`, `packages/storage` `catalog-crosswalk`                                         | [architecture.md](./architecture.md)                                 |
| `/discover`, `/trending`, `/random`   | `apps/cli/src/app/discover/*`, `services/recommendations/*`                                                     | [recommendations-and-discover.md](./recommendations-and-discover.md) |
| `/calendar`, release schedules        | `apps/cli/src/domain/calendar/*`, `services/release-reconciliation/*`                                           | [recommendations-and-discover.md](./recommendations-and-discover.md) |
| AniList / TMDB account sync           | `apps/cli/src/services/sync/*`                                                                                  | `docs/users/reliability-and-privacy.mdx`                             |

## Providers and resolution

| Feature                                      | Owned by                                                                                                                                   | Docs                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Production registry                          | `apps/cli/src/container/bootstrap-providers.ts` — `loadProductionProviderModules()`                                                        | [providers.md](./providers.md)                                                                         |
| CLI-side provider adapters                   | `apps/cli/src/services/providers/*` — `ProviderRegistry` (engine compat wrapper), priority, lanes, relay settings, request/result adapters | [providers.md](./providers.md)                                                                         |
| Attempt timeline, failure classification     | `apps/cli/src/domain/provider/*` — pure classification of what a failed attempt means                                                      | [debugging-map.md](./debugging-map.md)                                                                 |
| Resolve engine, fallback, hedging            | `packages/core/src/provider-engine.ts`                                                                                                     | [providers.md](./providers.md)                                                                         |
| Provider modules                             | `packages/providers/src/*/direct.ts`                                                                                                       | [provider-examples.md](./provider-examples.md)                                                         |
| Adding a provider                            | —                                                                                                                                          | [provider-intake.md](./provider-intake.md), [provider-agent-workflow.md](./provider-agent-workflow.md) |
| Source inventory (source/quality/audio/subs) | `apps/cli/src/services/playback/*`, `packages/storage` `source-inventory`                                                                  | [playback-source-inventory-contract.md](./playback-source-inventory-contract.md)                       |
| Provider health + `/reset-provider-health`   | `packages/storage` `provider-health`, `title-provider-health`, `provider-endpoint-health`                                                  | [title-provider-health-and-cache-reset.md](./title-provider-health-and-cache-reset.md)                 |
| Geo relay (user-owned)                       | `packages/relay/*`, `apps/relay-server`                                                                                                    | [runtime-boundary-map.md](./runtime-boundary-map.md#provider-relay-ownership)                          |
| Provider research                            | `apps/experiments/*`, `.docs/provider-dossiers/*`                                                                                          | [provider-intake.md](./provider-intake.md)                                                             |

## Playback

| Feature                                    | Owned by                                                                                                            | Docs                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Playback state machine                     | `apps/cli/src/app/playback/PlaybackPhase.ts`                                                                        | [architecture.md](./architecture.md)                                             |
| mpv launch + IPC (socket / named pipe)     | `apps/cli/src/infra/player/*`, `apps/cli/src/mpv.ts`                                                                | [quickstart.md](./quickstart.md)                                                 |
| Persistent session + autoplay              | `apps/cli/src/infra/player/PersistentMpvSession.ts`                                                                 | [mpv-in-process-reconnect.md](./mpv-in-process-reconnect.md)                     |
| Intro/credits auto-skip (IntroDB, AniSkip) | `apps/cli/src/aniskip.ts`, `apps/cli/src/introdb.ts`                                                                | [playback-timing-and-aniskip.md](./playback-timing-and-aniskip.md)               |
| Timing sources and merge                   | `apps/cli/src/infra/timing/*` — `PlaybackTimingAggregator` merges IntroDB, AniSkip, and provider-native timings     | [playback-timing-and-aniskip.md](./playback-timing-and-aniskip.md)               |
| Subtitles                                  | `apps/cli/src/subtitle.ts`                                                                                          | [playback-source-inventory-contract.md](./playback-source-inventory-contract.md) |
| Recovery / fallback / `/recover`           | `apps/cli/src/domain/recovery/*`                                                                                    | [debugging-map.md](./debugging-map.md)                                           |
| Post-playback actions                      | `apps/cli/src/app/post-play/*`                                                                                      | [ux-architecture.md](./ux-architecture.md)                                       |
| Playback rules (pure, no I/O)              | `apps/cli/src/domain/playback/*` — playable refs, progress/completion policy, problem classification, local streams | [architecture.md](./architecture.md)                                             |
| Source selection (pure)                    | `apps/cli/src/domain/playback-source/*` — `SourceSelectionEngine`, offline availability                             | [playback-source-inventory-contract.md](./playback-source-inventory-contract.md) |

## Library and personal state

Vocabulary is locked — see [adr/0001-personal-media-vocabulary.md](./adr/0001-personal-media-vocabulary.md).
Do not reuse these nouns for anything else.

| Feature                        | Owned by                                                                                                                                             | Docs                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| History + continue             | `packages/storage` `history`, `apps/cli/src/services/continuation/*`, `domain/continuation/*` (`ContinuationEngine`, watch-progress, catalog bounds) | [features/new-episode-tracking.md](./features/new-episode-tracking.md)                 |
| History identity repair        | `apps/cli/src/services/history-metadata/*` — consolidator, healer, ledger backfill for rows whose title identity drifted                             | [title-provider-health-and-cache-reset.md](./title-provider-health-and-cache-reset.md) |
| Row-scoped media actions       | `apps/cli/src/services/media-actions/MediaActionRouter.ts` — routes an action at a specific media item rather than session state                     | [runtime-boundary-map.md](./runtime-boundary-map.md)                                   |
| Watchlist / playlists          | `packages/storage` `lists`, `playlists`; `services/playlists/*`                                                                                      | [features/playlists.md](./features/playlists.md)                                       |
| Up Next queue                  | `packages/storage` `queue`, `apps/cli/src/domain/queue/*`                                                                                            | [features/queue.md](./features/queue.md)                                               |
| Follow / new-episode attention | `packages/storage` `followed-titles`; `services/attention/*`                                                                                         | [features/new-episode-tracking.md](./features/new-episode-tracking.md)                 |
| Notifications inbox            | `packages/storage` `notifications`; `services/notifications/*`                                                                                       | [features/notifications.md](./features/notifications.md)                               |
| Watch stats                    | `packages/storage` `watch-stats`                                                                                                                     | [features/privacy-and-storage.md](./features/privacy-and-storage.md)                   |
| Lists and stats domain         | `apps/cli/src/domain/lists/*` — `ListService`, `StatsService`, genre stats, formatting                                                               | [features/playlists.md](./features/playlists.md)                                       |

## Offline and downloads

| Feature                       | Owned by                                                                                                                          | Docs                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Download jobs                 | `apps/cli/src/services/download/*`, `services/ytdlp/*`                                                                            | [download-offline-onboarding.md](./download-offline-onboarding.md) |
| Offline library + assets      | `apps/cli/src/services/offline/*`, `app/offline/*`, `domain/offline/OfflineLibraryEngine.ts`, `packages/storage` `offline-assets` | [download-offline-onboarding.md](./download-offline-onboarding.md) |
| Network status / offline mode | `apps/cli/src/services/network/*`                                                                                                 | [download-offline-onboarding.md](./download-offline-onboarding.md) |

## Diagnostics, privacy, distribution

| Feature                               | Owned by                                                                                        | Docs                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/diagnostics`, `/export-diagnostics` | `apps/cli/src/services/diagnostics/*`, `app-shell/diagnostics/*`                                | [diagnostics-guide.md](./diagnostics-guide.md)                                                                   |
| Debug logging, tracing                | `apps/cli/src/logger.ts`, `infra/tracer/*`, `infra/diagnostics/*`                               | [diagnostics-guide.md](./diagnostics-guide.md)                                                                   |
| Usage analytics (opt-in)              | `apps/cli/src/services/analytics/*`, `apps/cli/src/domain/analytics/*`, `apps/analytics-ingest` | [analytics-privacy-contract.md](./analytics-privacy-contract.md)                                                 |
| Discord Rich Presence                 | `apps/cli/src/services/presence/*`                                                              | [presence-integrations.md](./presence-integrations.md)                                                           |
| Update check                          | `apps/cli/src/services/update/*`                                                                | [release-reliability-gate.md](./release-reliability-gate.md)                                                     |
| Installers, binaries, npm packages    | `install.sh`, `install.ps1`, `apps/cli/scripts/build*.ts`, `scripts/publish-npm-release.ts`     | [repo-infrastructure.md](./repo-infrastructure.md), [release-reliability-gate.md](./release-reliability-gate.md) |

## Cross-cutting plumbing

Not features. Listed because they own a mechanism that several features depend
on, and because guessing wrong here produces a layering violation.

| Mechanism                     | Owned by                                                                                                                            | Note                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Config and stores             | `apps/cli/src/services/persistence/*` — `ConfigService`, `ConfigStore`, `CacheStore`, `SyncTokenStore`, `StorageMaintenanceService` | The only writer of `config.json`; startup maintenance prunes cache-class rows                         |
| Media vocabulary and identity | `apps/cli/src/domain/media/*` — content kind, episode cursor, media-item identity and adapters, track model, preferences            | Locked nouns live in [adr/0001-personal-media-vocabulary.md](./adr/0001-personal-media-vocabulary.md) |
| Background work lanes         | `apps/cli/src/infra/work/*` (`WorkControlService`), `services/background/BackgroundWorkScheduler.ts`                                | Scheduling and cancellation for background jobs; not a place for policy                               |
| Atomic file writes            | `apps/cli/src/infra/fs/atomic-write.ts` (`writeAtomicJson`)                                                                         | Use this for whole-file JSON rather than hand-rolling temp-file + rename                              |
| OS integration                | `apps/cli/src/infra/os/*` — external open, protocol handler, reveal in file manager                                                 | Backs `--install-protocol-handler` and `kunai://`                                                     |
| Build-time shims              | `apps/cli/src/infra/build/*` — compiled entrypoint, react-devtools stub                                                             | Only touched by the binary build; not runtime behavior                                                |
| Cancellation and deadlines    | `apps/cli/src/infra/abort/timeout-signal.ts`                                                                                        | One helper. Do not hand-roll another `AbortSignal` timeout                                            |
| Structured logging            | `apps/cli/src/infra/logger/*`, `apps/cli/src/logger.ts`                                                                             | `logger.ts` is the legacy flat entry; new work uses `infra/logger`                                    |
| File and path mechanics       | `apps/cli/src/infra/storage/*` (`FileStorage`, `kunai-paths.ts`)                                                                    | Wraps `packages/storage` paths for the CLI                                                            |
| Terminal shell-outs           | `apps/cli/src/infra/shell/*` (`open-external-url.ts`)                                                                               | The only place that launches an external program other than mpv and yt-dlp                            |
| Stream resolve cache          | `apps/cli/src/services/cache/stream-resolve-cache.ts`                                                                               | Distinct from `packages/storage` `stream-cache` — see the doc column below                            |
| Storage read models           | `apps/cli/src/services/storage/storage-read-models.ts`                                                                              | Shapes repository rows for the app layer so UI never reads repositories                               |
| Feature flags                 | `apps/cli/src/domain/features/feature-flags.ts`                                                                                     | Experimental gates                                                                                    |
| YouTube lane                  | `apps/cli/src/services/youtube/*`                                                                                                   | Invidious health, diagnostics probes, history metadata, recommendations                               |
| Share link copy               | `apps/cli/src/infra/share/copy-share-link.ts`                                                                                       | Mechanism; `domain/share` owns the model — see [share-links.md](./share-links.md)                     |

The two caches are intentionally separate layers, not duplication:
`services/cache/stream-resolve-cache.ts` is the resolve-time memo, and
`packages/storage` `stream-cache` is the durable one.

## Shared packages

Dependency direction between these is enforced — see
[runtime-boundary-map.md](./runtime-boundary-map.md#package-dependency-direction).

| Package            | Owns                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `@kunai/types`     | Serializable contracts crossing package, storage, and provider boundaries. Depends on nothing. |
| `@kunai/design`    | Design tokens and color resolution. Depends on nothing.                                        |
| `@kunai/schemas`   | Runtime validation for untrusted or persisted data                                             |
| `@kunai/core`      | Provider engine, cycle engine, failure classifier, cache-key and manifest policy               |
| `@kunai/config`    | Config schema, defaults, and parsing — the shape `ConfigService` persists                      |
| `@kunai/providers` | Provider-specific extraction, decryption, source evidence                                      |
| `@kunai/relay`     | Relay validation, host allowlists, fetch-port adapter                                          |
| `@kunai/storage`   | SQLite paths, migrations, repositories, TTL helpers                                            |

## Not in the active runtime

Present in the tree, deliberately not wired into production. Do not cite these
as capabilities.

| Path                                                  | What it is                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `archive/legacy/apps/cli/src/browser/*`               | Playwright interception reference; awaiting `@kunai/runtime-browser` |
| `archive/legacy/apps/cli/src/providers/*`             | Pre-`packages/providers` provider reference                          |
| `apps/experiments/*`                                  | Provider research lab and scratchpads                                |
| `packages/providers/src/cineby`, `rgshows`, `vidrock` | Modules that exist but are not in `loadProductionProviderModules()`  |
| `apps/docs`                                           | The public docs site — content, not runtime                          |

Active runtime code must not import any of the first three; the boundary test
enforces it.
