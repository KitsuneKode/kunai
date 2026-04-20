# KitsuneSnipe — Roadmap

Last updated: 2026-04-21

Use this file as the planning index. It should stay short. Put implementation detail in the linked plan files, not here.

## Current State

### Stable

- Core Playwright interception flow works
- Movie/series providers and anime providers are both wired into the main loop
- Search, playback, history, subtitles, and auto-next all exist
- `AGENTS.md`, `.docs/`, and `.plans/` now have separated responsibilities

### Active Follow-Ups

- Settings pre-search gate polish
- `mpv` reopen reliability bug investigation
- `cineby-anime` click handling parity

## Planned Tracks

| Track                      | Status   | Doc                                                    |
| -------------------------- | -------- | ------------------------------------------------------ |
| CLI UX overhaul            | Planned  | [.plans/cli-ux-overhaul.md](.plans/cli-ux-overhaul.md) |
| Ink UI migration           | Planned  | [.plans/ink-migration.md](.plans/ink-migration.md)     |
| Search/provider decoupling | Deferred | [.plans/search-service.md](.plans/search-service.md)   |
| YouTube provider research  | Idea     | [.plans/yt-provider.md](.plans/yt-provider.md)         |

## Rules For This Folder

- Keep `roadmap.md` high-level and current
- Give each major initiative its own file when it needs implementation detail
- When a plan becomes stale, update or delete it instead of letting it drift
