# Feature Map

Routing table from a user-visible feature to the code that owns it. Use this to
answer "where does X live" without grepping the whole tree.

**This file routes; it does not describe behavior.** For behavior, read the
owning code or the doc in the last column. If a row disagrees with the tree, the
tree is right — fix the row.

Verified against the tree on 2026-07-29. Paths are checked by
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
| Poster previews (Kitty / sixel / chafa)                       | `apps/cli/src/image/*`                            | [poster-image-rendering.md](./poster-image-rendering.md)              |

## Search and catalog

| Feature                               | Owned by                                                                | Docs                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Search routing and backends           | `apps/cli/src/services/search/*`, `apps/cli/src/app/search/*`           | [.plans/search-service.md](../.plans/search-service.md)                                     |
| TMDB season/episode metadata          | `apps/cli/src/tmdb.ts`, `apps/cli/src/services/catalog/*`               | [architecture.md](./architecture.md)                                                        |
| Anime identity / title reconciliation | `apps/cli/src/domain/catalog/*`, `packages/storage` `catalog-crosswalk` | [.plans/catalog-identity-parity.md](../.plans/catalog-identity-parity.md)                   |
| `/discover`, `/trending`, `/random`   | `apps/cli/src/app/discover/*`, `services/recommendations/*`             | [recommendations-and-discover.md](./recommendations-and-discover.md)                        |
| `/calendar`, release schedules        | `apps/cli/src/domain/calendar/*`, `services/release-reconciliation/*`   | [.plans/catalog-release-schedule-service.md](../.plans/catalog-release-schedule-service.md) |
| AniList / TMDB account sync           | `apps/cli/src/services/sync/*`                                          | `docs/users/reliability-and-privacy.mdx`                                                    |

## Providers and resolution

| Feature                                      | Owned by                                                                                  | Docs                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Production registry                          | `apps/cli/src/container/bootstrap-providers.ts` — `loadProductionProviderModules()`       | [providers.md](./providers.md)                                                                         |
| Resolve engine, fallback, hedging            | `packages/core/src/provider-engine.ts`                                                    | [providers.md](./providers.md)                                                                         |
| Provider modules                             | `packages/providers/src/*/direct.ts`                                                      | [provider-examples.md](./provider-examples.md)                                                         |
| Adding a provider                            | —                                                                                         | [provider-intake.md](./provider-intake.md), [provider-agent-workflow.md](./provider-agent-workflow.md) |
| Source inventory (source/quality/audio/subs) | `apps/cli/src/services/playback/*`, `packages/storage` `source-inventory`                 | [playback-source-inventory-contract.md](./playback-source-inventory-contract.md)                       |
| Provider health + `/reset-provider-health`   | `packages/storage` `provider-health`, `title-provider-health`, `provider-endpoint-health` | [title-provider-health-and-cache-reset.md](./title-provider-health-and-cache-reset.md)                 |
| Geo relay (user-owned)                       | `packages/relay/*`, `apps/relay-server`                                                   | [runtime-boundary-map.md](./runtime-boundary-map.md#provider-relay-ownership)                          |
| Provider research                            | `apps/experiments/*`, `.docs/provider-dossiers/*`                                         | [provider-intake.md](./provider-intake.md)                                                             |

## Playback

| Feature                                    | Owned by                                             | Docs                                                                             |
| ------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Playback state machine                     | `apps/cli/src/app/playback/PlaybackPhase.ts`         | [architecture.md](./architecture.md)                                             |
| mpv launch + IPC (socket / named pipe)     | `apps/cli/src/infra/player/*`, `apps/cli/src/mpv.ts` | [quickstart.md](./quickstart.md)                                                 |
| Persistent session + autoplay              | `apps/cli/src/infra/player/PersistentMpvSession.ts`  | [mpv-in-process-reconnect.md](./mpv-in-process-reconnect.md)                     |
| Intro/credits auto-skip (IntroDB, AniSkip) | `apps/cli/src/aniskip.ts`, `apps/cli/src/introdb.ts` | [playback-timing-and-aniskip.md](./playback-timing-and-aniskip.md)               |
| Subtitles                                  | `apps/cli/src/subtitle.ts`                           | [playback-source-inventory-contract.md](./playback-source-inventory-contract.md) |
| Recovery / fallback / `/recover`           | `apps/cli/src/domain/recovery/*`                     | [debugging-map.md](./debugging-map.md)                                           |
| Post-playback actions                      | `apps/cli/src/app/post-play/*`                       | [ux-architecture.md](./ux-architecture.md)                                       |

## Library and personal state

Vocabulary is locked — see [adr/0001-personal-media-vocabulary.md](./adr/0001-personal-media-vocabulary.md).
Do not reuse these nouns for anything else.

| Feature                        | Owned by                                                             | Docs                                                                   |
| ------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| History + continue             | `packages/storage` `history`, `apps/cli/src/services/continuation/*` | [features/new-episode-tracking.md](./features/new-episode-tracking.md) |
| Watchlist / playlists          | `packages/storage` `lists`, `playlists`; `services/playlists/*`      | [features/playlists.md](./features/playlists.md)                       |
| Up Next queue                  | `packages/storage` `queue`, `apps/cli/src/domain/queue/*`            | [features/queue.md](./features/queue.md)                               |
| Follow / new-episode attention | `packages/storage` `followed-titles`; `services/attention/*`         | [features/new-episode-tracking.md](./features/new-episode-tracking.md) |
| Notifications inbox            | `packages/storage` `notifications`; `services/notifications/*`       | [features/notifications.md](./features/notifications.md)               |
| Watch stats                    | `packages/storage` `watch-stats`                                     | [features/privacy-and-storage.md](./features/privacy-and-storage.md)   |

## Offline and downloads

| Feature                       | Owned by                                                                                | Docs                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Download jobs                 | `apps/cli/src/services/download/*`, `services/ytdlp/*`                                  | [download-offline-onboarding.md](./download-offline-onboarding.md) |
| Offline library + assets      | `apps/cli/src/services/offline/*`, `app/offline/*`, `packages/storage` `offline-assets` | [download-offline-onboarding.md](./download-offline-onboarding.md) |
| Network status / offline mode | `apps/cli/src/services/network/*`                                                       | [download-offline-onboarding.md](./download-offline-onboarding.md) |

## Diagnostics, privacy, distribution

| Feature                               | Owned by                                                                                    | Docs                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `/diagnostics`, `/export-diagnostics` | `apps/cli/src/services/diagnostics/*`, `app-shell/diagnostics/*`                            | [diagnostics-guide.md](./diagnostics-guide.md)                                                      |
| Debug logging, tracing                | `apps/cli/src/logger.ts`, `infra/tracer/*`, `infra/diagnostics/*`                           | [diagnostics-guide.md](./diagnostics-guide.md)                                                      |
| Opt-in telemetry                      | `apps/cli/src/services/telemetry/*`, `apps/telemetry-ingest`                                | [telemetry-privacy-contract.md](./telemetry-privacy-contract.md)                                    |
| Discord Rich Presence                 | `apps/cli/src/services/presence/*`                                                          | [presence-integrations.md](./presence-integrations.md)                                              |
| Update check                          | `apps/cli/src/services/update/*`                                                            | [release-reliability-gate.md](./release-reliability-gate.md)                                        |
| Installers, binaries, npm packages    | `install.sh`, `install.ps1`, `apps/cli/scripts/build*.ts`, `scripts/publish-npm-release.ts` | [repo-infrastructure.md](./repo-infrastructure.md), [../plans/README.md](../plans/README.md) wave 6 |

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
