# KitsuneSnipe — Roadmap

Last updated: 2026-04-28

Use this file as the planning index. It should stay short. Put implementation detail in the linked plan files, not here.

## Current State

### Stable

- Core Playwright interception flow works
- Movie/series providers and anime providers are both wired into the main loop
- Search, playback, history, subtitles, and auto-next all exist
- `AGENTS.md`, `.docs/`, and `.plans/` now have separated responsibilities
- New runtime subtitle policy is restored: `none`, interactive picker, and provider-default flows all work again
- New runtime now preserves the previous browse/result state when episode selection is cancelled before playback starts
- Default startup mode is now configurable and honored by `src/main.ts`
- Autoplay is now app-driven: mpv exits cleanly at EOF, then KitsuneSnipe launches the next actually available released episode when enabled
- The repo now has a dedicated `test/` tree for integration, live smoke, provider templates, and VHS tapes
- Browser/embed scraping in the new runtime now reads and writes the shared stream cache
- AllAnime family parity code is explicitly named `allanime-family.ts`
- `src/main.ts` is now the default runnable and build entrypoint
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
- Fullscreen TUI convergence is now an explicit next milestone: viewport-contained layouts, resize blockers, and one dominant shell frame
- Browse results now have an expanded title overview panel with poster availability, rating when provided by search metadata, and explicit placeholders for provider-native gaps
- Subtitle status is surfaced before mpv launches so missing subtitles are visible during playback startup, not only after returning to the shell

### Active Follow-Ups

- Mounted root `AppShell` migration so home, browse, and playback stop remounting as separate shells
- Fullscreen shell convergence so the UI stops reading like stacked full-width cards and stays inside the viewport
- Fullscreen root-shell redesign spec is now tracked in [.plans/fullscreen-root-shell-redesign.md](.plans/fullscreen-root-shell-redesign.md)
- Overlay-driven settings, provider, history, diagnostics, season, episode, and subtitle workflows
- Settings, season, starting episode, and subtitle overlay migration so those flows stop falling back to helper shells
- `Esc` and back-stack correctness for the remaining shell helpers
- `mpv` reopen reliability bug investigation
- `cineby-anime` click handling parity
- Final legacy runtime drain from `index.ts` into `src/main.ts`
- First-run dependency guardrails for `mpv` and Playwright
- Developer-mode diagnostics surface for stream, subtitle, and provider resolution stages
- Metadata-store and preview-service migration beyond the current in-memory caches
- Image-pane service migration for safe Kitty/Ghostty poster rendering inside the persistent shell without Ink scroll flicker

### Recently Improved

- Diagnostics overlay now includes recent runtime events for search, provider resolution, subtitle decisions, playback, and cache hits
- Anime episode fallback no longer silently drops into episode 1 when metadata is missing

## Planned Tracks

| Track                            | Status      | Doc                                                                                                  |
| -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| Fullscreen root shell redesign   | In Progress | [.plans/fullscreen-root-shell-redesign.md](.plans/fullscreen-root-shell-redesign.md)                 |
| Kunai architecture hardening     | Planned     | [.plans/kunai-architecture-and-cache-hardening.md](.plans/kunai-architecture-and-cache-hardening.md) |
| Kunai experience and growth moat | Planned     | [.plans/kunai-experience-and-growth-moat.md](.plans/kunai-experience-and-growth-moat.md)             |
| Kunai principal grill Q&A        | Planned     | [.plans/kunai-principal-grill-qa.md](.plans/kunai-principal-grill-qa.md)                             |
| Kunai V2 ecosystem and Debrid    | Planned     | [.plans/v2-ecosystem-and-debrid.md](.plans/v2-ecosystem-and-debrid.md)                               |
| Kunai V3 metadata and sync       | Planned     | [.plans/v3-metadata-and-sync.md](.plans/v3-metadata-and-sync.md)                                     |
| CLI UX overhaul                  | Planned     | [.plans/cli-ux-overhaul.md](.plans/cli-ux-overhaul.md)                                               |
| Persistent shell implementation  | In Progress | [.plans/persistent-shell-implementation.md](.plans/persistent-shell-implementation.md)               |
| Ink UI migration                 | Planned     | [.plans/ink-migration.md](.plans/ink-migration.md)                                                   |
| Provider hardening               | Planned     | [.plans/provider-hardening.md](.plans/provider-hardening.md)                                         |
| Runtime entry consolidation      | Planned     | [.docs/architecture-v2.md](.docs/architecture-v2.md)                                                 |
| Search/provider decoupling       | Deferred    | [.plans/search-service.md](.plans/search-service.md)                                                 |
| YouTube provider research        | Idea        | [.plans/yt-provider.md](.plans/yt-provider.md)                                                       |

## Rules For This Folder

- Keep `roadmap.md` high-level and current
- Give each major initiative its own file when it needs implementation detail
- When a plan becomes stale, update or delete it instead of letting it drift
- When runtime ownership changes between `index.ts` and `src/main.ts`, update both this file and the persistent-shell plan in the same task
