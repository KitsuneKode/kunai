# Test suite audit (post-play convergence)

Date: 2026-06-25. Anchor: `.docs/testing-strategy.md`.

## Kill

| Path                                                             | Reason                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/cli/test/unit/app/playback-phase-characterization.test.ts` | Duplicates `playback-phase-events.test.ts` and `playback-advance.test.ts` |
| `keybindings.test.ts` → `"every binding has a unique id"`        | Duplicate of `keybindings-collision.test.ts`                              |

## Fix

| Path                                                              | Action                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| `post-play-h.useinput.test.tsx`                                   | Ctrl+H test uses bell byte; drive real modifier chord |
| `playback-phase-events.test.ts`                                   | Reduce private-method coupling via public seam        |
| `loading-shell-runtime.test.ts` + `loading-stage-mapping.test.ts` | Dedupe normalize/presentation cases                   |
| `post-play-shell.test.tsx`                                        | Slim to layout-only; view-model owns copy assertions  |

## Keep

Keybindings, loading-shell policy tests, post-play view/routing/policy tests, playback integration policy tests, watchdog with fake timers.
