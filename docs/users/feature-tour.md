# Feature Tour

This tour maps Kunai's terminal-only features to repeatable VHS demos. The GIFs are intended for README snippets, release notes, and a future Astro/MDX site without tying this CLI repo to a website framework yet.

## Demo Map

| Flow          | Command                                       | Tape                                              | Shows                                                              |
| ------------- | --------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| First run     | `bun run --cwd apps/cli test:vhs:onboarding`  | `apps/cli/test/vhs/onboarding.tape`               | setup, dependency hints, poster/download choices, final next steps |
| Browse        | `bun run --cwd apps/cli test:vhs:browse`      | `apps/cli/test/vhs/browse-shell.tape`             | search shell, browse layout, command-ready empty state             |
| Commands/help | `bun run --cwd apps/cli test:vhs:help`        | `apps/cli/test/vhs/help-overlay.tape`             | command palette and help overlay                                   |
| Discover      | `bun run --cwd apps/cli test:vhs:discover`    | `apps/cli/test/vhs/discover-random-calendar.tape` | `/discover`, `/random`, `/calendar` entry points                   |
| Offline       | `bun run --cwd apps/cli test:vhs:offline`     | `apps/cli/test/vhs/offline-library.tape`          | zen/offline shelf and downloads command route                      |
| Diagnostics   | `bun run --cwd apps/cli test:vhs:diagnostics` | `apps/cli/test/vhs/diagnostics-reporting.tape`    | diagnostics panel and report issue route                           |
| Launch story  | `bun run --cwd apps/cli test:vhs:launch`      | `apps/cli/test/vhs/launch-story.tape`             | cinematic walkthrough for README or landing pages                  |

Run all demos:

```sh
bun run --cwd apps/cli test:vhs:all
```

## Website-Ready Story

When this becomes an Astro/MDX site, keep the order simple:

1. **Hero:** terminal-first playback that stays in one shell.
2. **Start:** install, run `kunai`, search, press Enter.
3. **Discover:** `/discover`, `/random`, `/calendar`.
4. **Playback:** mpv handoff, next/replay/recover/fallback.
5. **Offline:** `/download`, `/downloads`, `/offline`, `--zen --offline`.
6. **Diagnostics:** `/diagnostics`, `/export-diagnostics`, `/report-issue`.
7. **Provider reality:** third-party providers drift; recovery paths are expected.

## Capture Rules

- Prefer VHS for terminal UX and local screen recording for real `mpv` windows.
- Keep tapes short and paced; one feature cluster per tape.
- Avoid relying on a specific provider title unless the flow explicitly demonstrates live provider behavior.
- Store generated GIFs under `apps/cli/test/vhs/golden/` and screenshots under `apps/cli/test/vhs/screenshots/`.
- Treat VHS as visual documentation and regression review, not as a substitute for unit, integration, live, and release dry-run checks.
