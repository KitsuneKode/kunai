# Kunai — Roadmap

Last updated: 2026-05-17

Use this file as the planning index. It should stay short. Put implementation detail in the linked plan files, not here.

**Plan vs code:** When a linked plan disagrees with the repo, read [.plans/plan-implementation-truth.md](.plans/plan-implementation-truth.md) first, then update the plan in the same change set.

## Current State

### Stable

- Core Playwright interception flow works
- Movie/series providers and anime providers are both wired into the main loop
- Search, playback, history, subtitles, and auto-next all exist
- `AGENTS.md`, `.docs/`, and `.plans/` now have separated responsibilities
- New runtime subtitle policy is restored: `none`, interactive picker, and provider-default flows all work again
- New runtime now preserves the previous browse/result state when episode selection is cancelled before playback starts
- Default startup mode is now configurable and honored by `apps/cli/src/main.ts`
- Autoplay is now app-driven: mpv exits cleanly at EOF, then Kunai launches the next actually available released episode when enabled
- The CLI now has a dedicated `apps/cli/test/` tree for integration, live smoke, provider templates, and VHS tapes
- Browser/embed scraping in the new runtime now reads and writes the shared stream cache
- AllManga-compatible parity code lives in `@kunai/providers` so it is not mistaken for the generic anime provider base
- `apps/cli/src/main.ts` is now the default runnable and build entrypoint
- Shell-local debug POST instrumentation has been removed from the Ink UI path
- Browse and post-playback now keep provider, help, about, history, and diagnostics inside the mounted shell instead of bouncing into separate helper screens
- Playback navigation labels and availability now come from real episode metadata or provider catalogs instead of blind episode math
- History persistence is hardened so completed playback still saves even if mpv reports a weak final playback position
- History browsing and clearing in the new runtime now use the shared `HistoryStore` instead of bypassing it through legacy helper wiring
- Footer hints are now configurable, and the browse, playback, and picker shells use the calmer task-first footer model
- Browse and post-playback settings now stay inside the mounted shell and save through the shared runtime config path
- Post-playback now exposes a direct fresh-search path so users can keep browsing without quitting the app
- Post-playback episode selection now stays inside the playback shell instead of opening a separate helper screen
- Shell screens now share one Ink root host internally, reducing remount churn while the full browse/playback state-machine merge continues
- Interactive shell handoffs now keep the outgoing screen visible until the next screen replaces it, reducing blank transitions
- Browse and playback now share one runtime binding helper for provider options, settings persistence, and info-panel loaders
- Post-playback helper fallbacks for provider, settings, history, diagnostics, help, and about were removed now that the playback shell owns those panels directly
- Browse and post-playback now render through the mounted root shell content bridge instead of the normal helper-shell path
- Fullscreen TUI convergence is now an explicit next milestone: viewport-contained layouts, resize blockers, and one dominant shell frame
- Browse results now have an expanded title overview panel with poster availability, rating when provided by search metadata, and explicit placeholders for provider-native gaps
- Subtitle status is surfaced before mpv launches so missing subtitles are visible during playback startup, not only after returning to the shell
- Minimal Turborepo workspace scaffold is in place with the current CLI package under `apps/cli` and provider scratchpads under `apps/experiments`
- Repo infrastructure guardrails are in place: PR CI, main CI, Husky hooks, lint-staged, PR template, and issue-template config
- Shared design tokens live in `@kunai/design`, with CLI shell helpers consuming the same visual vocabulary
- `/discover` recommendations are wired as an explicit lazy-loaded surface with a post-playback nudge and opt-in startup hint
- Optional Discord presence has a first-party service seam; setup/help polish remains

### Active Follow-Ups

- Current execution mode: full-fledged CLI first. Web, desktop, remote sync, paid cloud, premium dashboards, and account-required flows are parked.
- Daily-use UX hardening is the current coordinating track for discover/calendar/recommendations, random picks, language switching, fullscreen TUI polish, loading/playback visuals, offline visibility, and runtime soak: [.plans/daily-use-ux-discovery-and-runtime-hardening.md](.plans/daily-use-ux-discovery-and-runtime-hardening.md)
- Phase 3 storage foundation is implemented with `@kunai/storage`.
- Phase 4F Provider SDK contracts are landed; Phase 4G provider package migration is active, with VidKing already moved into `@kunai/providers`.
- CLI history and stream cache now use SQLite-backed stores.
- Fullscreen shell convergence (flatten nested borders, root-owned chrome): [.plans/fullscreen-root-shell-redesign.md](.plans/fullscreen-root-shell-redesign.md)
- Phase 1.8 single mounted content tree (collapse `SearchPhase` / `PlaybackPhase` UI launcher loops): [.plans/phase-1.8-single-mounted-content-tree.md](.plans/phase-1.8-single-mounted-content-tree.md)
- `Esc` / back-stack correctness across browse ↔ overlays ↔ playback (partial; root overlays landed)
- Beta UI/provider hardening remainder (split `ink-shell`, central input routing, display honesty): [.plans/beta-ui-provider-runtime-hardening.md](.plans/beta-ui-provider-runtime-hardening.md)
- `mpv` reopen reliability bug investigation
- **Windows / cross-platform mpv IPC parity** (named pipes, bridge, docs, packaging clarity): [.plans/cross-platform-mpv-ipc-and-playback-parity.md](.plans/cross-platform-mpv-ipc-and-playback-parity.md)
- **Series catalog end-state & upcoming episodes** (TMDB “coming soon”, honest anime next, autoplay/prefetch safety): [.plans/series-catalog-end-state-and-upcoming-episode-ux.md](.plans/series-catalog-end-state-and-upcoming-episode-ux.md)
- `cineby-anime` click handling parity
- Final compatibility wrapper cleanup once `apps/cli/index.ts` is no longer useful
- Phase 1.5 true root shell foundation after the scoped Turborepo move
- First-run dependency guardrails for `mpv`, `yt-dlp`, optional `ffprobe`, and terminal image support
- Developer-mode diagnostics surface for stream, subtitle, and provider resolution stages
- Metadata-store and preview-service migration beyond the current in-memory caches
- Image-pane service migration for safe Kitty/Ghostty poster rendering inside the persistent shell without Ink scroll flicker
- Phase 2 playback/media runtime now has the controller seam, persistent autoplay mpv session, built-in subtitle priority, credits-aware completion timing, loading cancel, and player-side skip controls
- Manual runtime verification is now tracked in [VERIFICATION.md](../VERIFICATION.md)
- Provider SDK candidate model: provider -> source/mirror -> variant, with selected stream plus discovered candidates, subtitles, trace, cache policy, and health deltas
- Beta UI/provider runtime hardening now has an execution plan for modal pickers, source inventory cache, provider-internal retry, fallback policy, hardsub/source/quality display, and deterministic trending: [.plans/beta-ui-provider-runtime-hardening.md](.plans/beta-ui-provider-runtime-hardening.md)
- Runtime-browser package plan for JIT Playwright leases, interception, cooldown, evidence capture, and teardown
- Interactive resolution UX follow-up is now mostly narrowed to richer non-playback cancel surfaces plus later source/quality/subtitle chooser polish
- Deferred resolve UX items (provider-level Playwright abort, episode memory after cancel, per-provider timeout config, provider health indicator) tracked in [.plans/resolve-ux-and-playwright-lifecycle.md](.plans/resolve-ux-and-playwright-lifecycle.md)
- Download/offline/onboarding is now a canonical planned track rather than a generated superpowers-only spec: [.plans/download-offline-onboarding.md](.plans/download-offline-onboarding.md)
- Catalog release schedules need a shared service for anime next-airing, TV upcoming episodes, and releasing-today surfaces: [.plans/catalog-release-schedule-service.md](.plans/catalog-release-schedule-service.md)
- Provider reliability, fallback visibility, diagnostics bundles, report issue flow, and local debug tracing are tracked in [.plans/provider-reliability-diagnostics-and-reporting.md](.plans/provider-reliability-diagnostics-and-reporting.md)
- Production recovery hardening now coordinates recovery policy modes, network/offline suggestions, diagnostics/reporting UX, offline artwork, developer debugging, and provider/player harness tests: [.plans/production-recovery-hardening.md](.plans/production-recovery-hardening.md)
- The implementation pass for production-ready usage, UX behavior, and recovery harness coverage is tracked in [.plans/production-readiness-usage-hardening.md](.plans/production-readiness-usage-hardening.md)
- Advanced search input, local-first offline library read models, and continuation decision engines are tracked in [.plans/search-offline-continuation-engines.md](.plans/search-offline-continuation-engines.md)
- Autonomous reliability and coherence handoff path is tracked in [.plans/autonomous-reliability-and-coherence-path.md](.plans/autonomous-reliability-and-coherence-path.md)
- Reliability core hardening and codebase coherence passes are implemented; the coherence report tracks deferred architecture work: [.plans/codebase-coherence-and-redundancy-report.md](.plans/codebase-coherence-and-redundancy-report.md)
- Diagnostics now carry optional session/playback/provider correlation IDs across provider resolve, cache checks, mpv runtime events, presence background tasks, debug JSONL, and support bundles.

### Recently Improved

- Diagnostics overlay now includes recent runtime events for search, provider resolution, subtitle decisions, playback, and cache hits
- Anime episode fallback no longer silently drops into episode 1 when metadata is missing
- Autoplay end-reason hardened with position-ratio fallback for HLS sources (AllAnime)
- Timing sources unified under `PlaybackTimingAggregator` — IntroDB + AniSkip in parallel
- AniSkip integrated for anime intro/credits skip using AniList → MAL ID mapping
- mpv N/P/I keys, OSD episode transitions, near-EOF prefetch, and window title sync landed
- Shell now fills full terminal viewport (fullscreen gap fixed)
- Anime episode cache scoped per title+provider (was provider-only, caused wrong availability across titles)

## Planned Tracks

| Track                             | Status        | Doc                                                                                                                  |
| --------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Daily-use UX hardening**        | **Active**    | [.plans/daily-use-ux-discovery-and-runtime-hardening.md](.plans/daily-use-ux-discovery-and-runtime-hardening.md)     |
| **Beta v1 scope & contracts**     | **Active**    | [.plans/kunai-beta-v1-scope-and-contracts.md](.plans/kunai-beta-v1-scope-and-contracts.md)                           |
| **Execution passes & CLI modes**  | **Active**    | [.plans/kunai-execution-passes-and-cli-modes.md](.plans/kunai-execution-passes-and-cli-modes.md)                     |
| **Beta readiness**                | **Active**    | [.plans/beta-readiness.md](.plans/beta-readiness.md)                                                                 |
| Repo infrastructure               | Completed     | [.plans/repo-infrastructure.md](.plans/repo-infrastructure.md)                                                       |
| Design system and Discover        | Polish        | [.plans/kitsune-design-system-and-recommendations.md](.plans/kitsune-design-system-and-recommendations.md)           |
| Presence integrations             | Polish        | [.plans/presence-integrations.md](.plans/presence-integrations.md)                                                   |
| Catalog release schedules         | In Progress   | [.plans/catalog-release-schedule-service.md](.plans/catalog-release-schedule-service.md)                             |
| Download/offline/onboarding       | Planned       | [.plans/download-offline-onboarding.md](.plans/download-offline-onboarding.md)                                       |
| Provider reliability diagnostics  | Planned       | [.plans/provider-reliability-diagnostics-and-reporting.md](.plans/provider-reliability-diagnostics-and-reporting.md) |
| Production recovery hardening     | Planned       | [.plans/production-recovery-hardening.md](.plans/production-recovery-hardening.md)                                   |
| Production usage hardening        | Planned       | [.plans/production-readiness-usage-hardening.md](.plans/production-readiness-usage-hardening.md)                     |
| Search/offline engines            | Planned       | [.plans/search-offline-continuation-engines.md](.plans/search-offline-continuation-engines.md)                       |
| Reliability core autonomous sweep | Implemented   | [.plans/reliability-core-autonomous-sweep.md](.plans/reliability-core-autonomous-sweep.md)                           |
| Codebase coherence sweep          | Implemented   | [.plans/codebase-coherence-and-redundancy-sweep.md](.plans/codebase-coherence-and-redundancy-sweep.md)               |
| Beta UI/provider hardening        | In Progress   | [.plans/beta-ui-provider-runtime-hardening.md](.plans/beta-ui-provider-runtime-hardening.md)                         |
| Fullscreen root shell redesign    | In Progress   | [.plans/fullscreen-root-shell-redesign.md](.plans/fullscreen-root-shell-redesign.md)                                 |
| Phase 1.8 mounted content tree    | In Progress   | [.plans/phase-1.8-single-mounted-content-tree.md](.plans/phase-1.8-single-mounted-content-tree.md)                   |
| Shell responsiveness polish       | Completed     | [.plans/shell-responsiveness-and-polish-pass.md](.plans/shell-responsiveness-and-polish-pass.md)                     |
| Phase 2 playback/media runtime    | In Progress   | [.plans/phase-2-playback-media-runtime.md](.plans/phase-2-playback-media-runtime.md)                                 |
| Cross-platform mpv IPC parity     | Planned       | [.plans/cross-platform-mpv-ipc-and-playback-parity.md](.plans/cross-platform-mpv-ipc-and-playback-parity.md)         |
| Kunai architecture hardening      | Planned       | [.plans/kunai-architecture-and-cache-hardening.md](.plans/kunai-architecture-and-cache-hardening.md)                 |
| Kunai experience and growth moat  | Planned       | [.plans/kunai-experience-and-growth-moat.md](.plans/kunai-experience-and-growth-moat.md)                             |
| Kunai principal grill Q&A         | Planned       | [.plans/kunai-principal-grill-qa.md](.plans/kunai-principal-grill-qa.md)                                             |
| Turborepo and package boundaries  | Phase 4G Prep | [.plans/turborepo-and-package-boundaries.md](.plans/turborepo-and-package-boundaries.md)                             |
| Kunai V2 ecosystem and Debrid     | Planned       | [.plans/v2-ecosystem-and-debrid.md](.plans/v2-ecosystem-and-debrid.md)                                               |
| Kunai V3 metadata and sync        | Planned       | [.plans/v3-metadata-and-sync.md](.plans/v3-metadata-and-sync.md)                                                     |
| CLI UX overhaul                   | In Progress   | [.plans/cli-ux-overhaul.md](.plans/cli-ux-overhaul.md) — sequencing via persistent shell + fullscreen redesign       |
| Persistent shell implementation   | In Progress   | [.plans/persistent-shell-implementation.md](.plans/persistent-shell-implementation.md)                               |
| Ink UI migration                  | Superseded    | [.plans/ink-migration.md](.plans/ink-migration.md) — baseline shipped; see plan-implementation-truth                 |
| Provider hardening                | Planned       | [.plans/provider-hardening.md](.plans/provider-hardening.md)                                                         |
| Resolve UX & Playwright lifecycle | Planned       | [.plans/resolve-ux-and-playwright-lifecycle.md](.plans/resolve-ux-and-playwright-lifecycle.md)                       |
| Runtime entry consolidation       | Planned       | [.docs/architecture-v2.md](.docs/architecture-v2.md)                                                                 |
| Search/catalog service            | Active Design | [.plans/search-service.md](.plans/search-service.md)                                                                 |
| YouTube provider research         | Idea          | [.plans/yt-provider.md](.plans/yt-provider.md)                                                                       |

## Milestone notes

- **2026-05-04** — Beta readiness checkpoint: near-end quit policy in config + Ink/list settings, startup capability guardrails, `--minimal` / `--quick` / `--jump` wired through `SessionController`, redacted diagnostics export command, `StreamResolveCache` helpers + `StreamRequest.animeLang`, shell playback `LoadingShell` remount key for episode transitions, history panel shows TMDB id. Details: [beta-readiness.md](beta-readiness.md), [.docs/lint-policy.md](../.docs/lint-policy.md).

## Rules For This Folder

- Keep `roadmap.md` high-level and current
- Give each major initiative its own file when it needs implementation detail
- When a plan becomes stale, update or delete it instead of letting it drift — reconcile in [plan-implementation-truth.md](.plans/plan-implementation-truth.md)
- When runtime ownership changes between `apps/cli/index.ts` and `apps/cli/src/main.ts`, update both this file and the persistent-shell plan in the same task

## Milestone notes (continued)

- **2026-05-16** — Plan/doc drift reconciliation: added [plan-implementation-truth.md](.plans/plan-implementation-truth.md); corrected roadmap statuses for Ink migration (superseded), CLI UX (in progress), beta UI + catalog schedule (in progress); marked shell responsiveness pass completed.
