# Regression baseline

Established: 2026-06-25

## Gate chain (all green)

| Gate                | Result | Notes                                                |
| ------------------- | ------ | ---------------------------------------------------- |
| `bun run typecheck` | pass   | 14 tasks                                             |
| `bun run lint`      | pass   | 2 warnings (unused import/param in browse-shell.tsx) |
| `bun run fmt:check` | pass   |                                                      |
| `bun run test`      | pass   | 2326 pass, 7 skip, 0 fail, 437+ files                |
| `bun run build`     | pass   | dist/kunai.js 2.2 MiB                                |
| `bun run pkg:check` | pass   | @kitsunekode/kunai@0.2.5                             |

## Test suite

- Unit: `apps/cli/test/unit/`
- Integration: `apps/cli/test/integration/`
- Live (opt-in): `apps/cli/test/live/`
- Skipped (env-gated): native installer docker smoke, compiled linux binary smoke, install.ps1 dry-run (7 total)

## Regression policy

No phase in post-play correctness convergence may regress this baseline. Each slice must pass the full gate chain before merge.
