# KitsuneSnipe — Roadmap

Last updated: 2026-04-25

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
- Auto-next is now app-driven: mpv exits cleanly at EOF, then KitsuneSnipe launches the next episode when enabled
- The repo now has a dedicated `test/` tree for integration, live smoke, provider templates, and VHS tapes
- Browser/embed scraping in the new runtime now reads and writes the shared stream cache
- AllAnime family parity code is explicitly named `allanime-family.ts`
- `src/main.ts` is now the default runnable and build entrypoint
- Shell-local debug POST instrumentation has been removed from the Ink UI path
- Browse and post-playback now keep provider, help, about, history, and diagnostics inside the mounted shell instead of bouncing into separate helper screens

### Active Follow-Ups

- Mounted root `AppShell` migration so home, browse, and playback stop remounting as separate shells
- Overlay-driven settings, provider, history, diagnostics, season, episode, and subtitle workflows
- Settings, season, episode, and subtitle overlay migration so those flows stop falling back to helper shells
- `Esc` and back-stack correctness for the remaining shell helpers
- `mpv` reopen reliability bug investigation
- `cineby-anime` click handling parity
- Final legacy runtime drain from `index.ts` into `src/main.ts`
- First-run dependency guardrails for `mpv` and Playwright
- Developer-mode diagnostics surface for stream, subtitle, and provider resolution stages
- Metadata-store and preview-service migration beyond the current in-memory caches

### Recently Improved

- Diagnostics overlay now includes recent runtime events for search, provider resolution, subtitle decisions, playback, and cache hits
- Anime episode fallback no longer silently drops into episode 1 when metadata is missing

## Planned Tracks

| Track                           | Status      | Doc                                                                                    |
| ------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| CLI UX overhaul                 | Planned     | [.plans/cli-ux-overhaul.md](.plans/cli-ux-overhaul.md)                                 |
| Persistent shell implementation | In Progress | [.plans/persistent-shell-implementation.md](.plans/persistent-shell-implementation.md) |
| Ink UI migration                | Planned     | [.plans/ink-migration.md](.plans/ink-migration.md)                                     |
| Provider hardening              | Planned     | [.plans/provider-hardening.md](.plans/provider-hardening.md)                           |
| Runtime entry consolidation     | Planned     | [.docs/architecture-v2.md](.docs/architecture-v2.md)                                   |
| Search/provider decoupling      | Deferred    | [.plans/search-service.md](.plans/search-service.md)                                   |
| YouTube provider research       | Idea        | [.plans/yt-provider.md](.plans/yt-provider.md)                                         |

## Rules For This Folder

- Keep `roadmap.md` high-level and current
- Give each major initiative its own file when it needs implementation detail
- When a plan becomes stale, update or delete it instead of letting it drift
- When runtime ownership changes between `index.ts` and `src/main.ts`, update both this file and the persistent-shell plan in the same task
