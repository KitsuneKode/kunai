---
"@kitsunekode/kunai": minor
---

Kunai 0.2.0 is the beta-shell release. It bundles the large runtime, playback, provider, offline, diagnostics, and docs work landed since 0.1.4, with release notes written from the current codebase instead of plan shorthand.

**Playback, recovery, and mpv**

- Added the persistent mpv runtime path with IPC-backed controls, Lua bridge wiring, episode navigation from the player window, in-process reconnects, subtitle/audio/source updates, and clearer teardown so autoplay chains do not repeatedly respawn mpv.
- Added typed playback phases and user-facing playback problem state: preparing provider, waiting for player, active playback, did-not-start, failed, post-playback, recovery, replay, fallback, and stop-after-current now flow through explicit state instead of scattered copy.
- Added dead-stream and preflight safeguards: stalled/dead playback is detected separately from slow-but-healthy playback, suspected dead cached URLs are invalidated, retry/fallback decisions are bounded, and local/offline failures no longer poison provider health.
- Added `/recover`, `/recompute`, `/fallback`, `/tracks`, `/source`, `/quality`, `/next`, `/previous`, autoplay/autoskip toggles, and stop-after-current into the stable active-playback and post-playback command surfaces with availability reasons instead of dead commands.
- Added a unified tracks panel and capability model for source, quality, audio, hardsub, and subtitles. Single-option sections render as facts, switchable alternatives stay selectable, and failed/current tracks are shown without enabling dead choices.
- Added source/quality picker routing from already-resolved provider inventory, preserving provider source intent across cache, prefetch, retry, provider switching, and download enqueue.
- Added next-episode prefetch and startup policy plumbing so playback can prepare useful post-play actions without delaying the visible shell. Next/auto-next no longer stalls on a stale loading overlay.
- Fixed movie playback identity: movies no longer accidentally render as series, no longer carry season/episode state, use movie language profiles, and offer resume/restart instead of always starting at 0.
- Added playable-ref and content-kind domain helpers so title type wins over shell mode for playback, status crumbs, episode labels, and handoff behavior.
- Improved autoskip/timing wiring with provider-native timing metadata, IntroDB/AniSkip context, startup diagnostics, and clearer skip/autoplay state in the live playback surface.

**Provider engine and stream inventory**

- Added the provider-cycle engine and provider-cycle contracts in shared packages, with bounded retries, cancellation handling, network-offline classification, retryable/non-retryable failure taxonomy, and fallback decisions.
- Added provider metadata v2 across types, schemas, providers, app adapters, and history so native ids, release metadata, artwork, audio/subtitle language evidence, source labels, and seek-thumbnail evidence survive provider-to-UI boundaries.
- Added normalized source inventory helpers, provider inventory facade, startup selection helpers, and variant tree utilities so VidKing, Rivestream, Miruro, and AllManga expose comparable source/stream/subtitle/quality facts.
- Hardened VidKing with source flavors, source ids, evidence fixtures, lazy source probing, direct payload filtering, fallback source cycling, blocked-host fixtures, and deterministic phase-A/phase-B flavor ordering.
- Hardened Rivestream and Miruro with provider service caching, ready-order startup selection, source inventory normalization, seek-thumbnail evidence, parse/network failure fixtures, and fallback behavior for discovery failures.
- Hardened AllManga with ani-cli parity-focused API behavior, Ak fallback handling, source-family separation, startup priority handling, deferred Ak DASH materialization, language evidence, and result-cache keys that include startup priority.
- Added provider attempt timelines, title-provider health, provider-health evidence, source-inventory cache invalidation, resolve work ledgers, and cache decision reporting so diagnostics can explain why a provider was selected, skipped, retried, or marked down.
- Added live provider matrix smoke coverage and richer fixture suites for direct providers, negative cases, language normalization, source presentation, startup selection, and m3u8 variant extraction.

**Shell, Sakura design system, and shortcuts**

- Migrated the CLI shell to the Sakura semantic palette and primitive kit: selection rows, tab/segmented controls, switches, progress bars, heatmaps, context cards, preview rails, action lists, state blocks, headers, and responsive layout helpers are now shared instead of duplicated.
- Rebuilt the launch, loading, active playback, post-playback, browse idle, search/details, discover, calendar, history, library, downloads, setup, diagnostics, settings, help, and picker surfaces around calmer hierarchy and fewer bordered/card-heavy layouts.
- Added a keybinding registry as the source of truth for help and stable footer hints. Help no longer drifts from runtime shortcuts, browse hotkeys no longer hijack the search input, command palette rows are width-aware, and footer keys use consistent glyph/label treatment.
- Added zen mode and `--zen` support with single-column behavior across browse, library, downloads, and offline shelves.
- Added viewport policy and resize blocking for terminals that are too narrow, plus more stable medium/wide/narrow layout snapshots for the shell surfaces.
- Improved browse and discover with focus zones, filter chips, per-section discovery rails, rerollable discovery sections, typed empty states, preview rails, artwork, and safer command-palette overlay behavior.
- Improved calendar with day strip navigation, type tabs, release-state copy, cached schedule rows, airing-vs-available separation, and row widths that avoid overlap.
- Improved post-playback with four-state post-play modeling, queue-aware Up Next, clean replay/episode/search/fallback actions, title detail artwork, next-episode stills, and caught-up recommendation behavior.
- Improved history and continue watching with grouped rows, progress bars, poster fallback blocks, continue/restart actions, new-episode labels, mark-as-watched, and stable row selection.

**Lists, queue, sync, attention, and stats**

- Added list, watchlist, favorites, playlist, queue, stats, and sync service/repository foundations with command-palette workflows and shell panels.
- Added durable queue recovery and queue restore behavior that explicitly moves pending items without autoplaying them.
- Added queue planning, queueable post-playback recommendations, playlist import/export, playlist projection, and safe media identity contracts that avoid storing raw stream URLs in durable exports.
- Added local stats and streak UI, watch-kind filters, heatmaps, share-card formatting, status crumb badges, weekly digest/sync health indicators, and streak milestone/at-risk surfaces.
- Added notification/attention foundations: notification inbox, action router, actionable release/download/queue notices, followed-title and refresh-budget services, and release availability rules that do not equate aired with playable.
- Added sync service seams for AniList/TMDB, sync token storage via atomic secret JSON, protocol handoff registration, and safe handoff URL parsing for local actions.

**Continuation, history, release calendar, and catalog data**

- Added canonical HistoryProgress usage through offline shelves, resume-from-history, episode pickers, cleanup, runway planning, and continuation services; retired lossy/dead JSON history/cache implementations where the SQLite path is now authoritative.
- Added continuation read models and Netflix-style anchoring: caught-up/continue decisions anchor on the most-recent episode, finished older episodes do not make ongoing series look complete, and movies are handled separately from episodic chains.
- Added release reconciliation and schedule progress caching: AniList sequel/cross-cour detection, TMDB later-season detection, new-season signals, release progress cache, date-only release boundaries, and background reconciliation services.
- Added title detail services for season/episode summaries, episode thumbnails, poster/still sizing, provider-native release badges, and non-blocking warm-cache peeks.
- Added browse result enrichment for watched/downloaded/local/next-release/provider metadata without unnecessary provider calls.

**Offline downloads and local library**

- Added durable download queue behavior with storage admission, per-job destination overrides, media-server friendly output paths, progress parsing, retries, pause/abort semantics, repair sweeps, and startup recovery.
- Added download artifact states that distinguish completed video from expected/optional sidecar problems. Subtitle/artwork sidecars can be repaired without redownloading a valid video.
- Added offline asset manifests, offline title policies, offline maintenance jobs, runway planning, capacity bounds, and local-only continuation behavior so offline mode does not silently fall back to provider calls.
- Added hardsub/subtitle language preservation, selected source/stream/quality metadata on enqueue, fresh stream re-resolution before download processing, and provider source intent preservation across downloads.
- Removed `ffmpeg` from the active runtime dependency path for this release. Kunai no longer spawns `ffmpeg` for local video thumbnails; offline artwork uses cached poster assets when available, and `ffprobe` remains optional for post-download validation.
- Updated installer, setup copy, root README, package README, user docs, and release docs so `mpv` is the required playback dependency, `yt-dlp` gates downloads, `ffprobe` is optional validation, and `ffmpeg` is not presented as needed for normal Kunai use.

**Diagnostics, support bundles, and runtime feedback**

- Added correlated diagnostic events, operation taxonomy, background task diagnostics, runtime health summaries, memory trend reporting, resolve work evidence, provider selection decisions, playback startup timelines, and redacted support bundle fields.
- Added `--debug-session`, safer `/export-diagnostics` and `/report-issue` flows, redaction boundary tests, and diagnostics panels that group state into scannable verdict sections.
- Added runtime memory and mpv child-process feedback where the platform exposes it, plus docs explaining what is measured and when values can be unavailable.
- Added redaction scope documentation and support-bundle privacy handling so provider/cache/source evidence is useful without leaking stream URLs or local secrets.

**Docs, package, and CI/release readiness**

- Added the docs app, public user/developer docs, docs home page, docs search route, install/update docs, command/shortcut docs, playback/offline/diagnostics/runtime feedback docs, and docs maintenance guidance.
- Fixed the docs CI build by narrowing Fumadocs to the public `docs/users` and `docs/developer` trees. Internal `docs/superpowers` plans/specs remain repository context, not public MDX pages requiring published frontmatter.
- Added CI coverage for docs build and package check, release dry-run installer guidance, package README updates, and a generated 0.2.0 changeset path.
- Updated release verification around `bun run ci`, `bun run build`, `bun run build:docs`, `bun run pkg:check`, and `bun run release:dry-run`.
- Added and expanded tests across app-shell snapshots, playback services, provider contracts, storage repositories, download/offline behavior, diagnostics, catalog/release reconciliation, sync/list/queue/stats services, and docs rendering.
