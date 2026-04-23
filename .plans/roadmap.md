# KitsuneSnipe — Roadmap

Last updated: 2026-04-23

Use this file as the planning index. It should stay short. Put implementation detail in the linked plan files, not here.

## Current State

### Stable

- Core Playwright interception flow works
- Movie/series providers and anime providers are both wired into the main loop
- Search, playback, history, subtitles, and auto-next all exist
- `AGENTS.md`, `.docs/`, and `.plans/` now have separated responsibilities

### Active Follow-Ups

- Search/results migration into the persistent shell path
- Overlay-driven settings and provider workflows
- `mpv` reopen reliability bug investigation
- `cineby-anime` click handling parity
- Runtime entrypoint consolidation around `src/main.ts`
- First-run dependency guardrails for `mpv` and Playwright
- Engineering and test discipline docs for the persistent shell and provider-hardening tracks
- Canonical PRD and persistent-shell implementation sequencing
- Provider demo patterns and intake templates for agent-led provider work

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
