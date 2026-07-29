# Sakura Release + Experience Roadmap

Continuation plan for a fresh session. Branch: `design/sakura-rollout`. Source is truth; design contract is [.docs/design-system.md](../.docs/design-system.md).

## Where we are

Sakura theme (dusk-plum · rose · mint) is live and committed. Done: S0 tokens, S1 migration (all 25 app-shell surfaces, 0 deprecated names), S2 foundation (ContextCard/ActionList/StateBlock/PreviewRail + playback recovery view model, wired into LoadingShell + post-play), S4 (search/details/discover, pickers+scoped commands), S5 (calendar/history/library return-loop logic), composition fixes (de-duplicated title in Now Playing/Post-play), and two polish passes (browse preview-rail content; playback legend + post-play density). Gate is green (only the unrelated pre-existing discord WIP needed a 1-line fixture fix, applied uncommitted).

Tests: app-shell 265 pass. typecheck/lint clean for Sakura.

## RELEASE PATH (do in order → then merge to main)

> **Status 2026-05-23 (verifier):** Items 1–4 landed on `design/sakura-rollout`
> (commits `5c83bbd0` S3 portability + token-alias removal, `ffd8851f` Now
> Playing poster clear, `d25cf474` Agent C return-loop wiring). Gate green:
> typecheck 8/8, test 1004/0, build ok, lint 0 errors. Remaining: **5**
> (merge-readiness/install verification — entangled with the user's uncommitted
> WIP) and **6** (manual narrow/non-truecolor pass → merge). Do NOT merge until
> the WIP-vs-Sakura split is decided (see "NOT OURS" below).

1. ~~**Wire Agent C's return-loop exports into `browse-shell.tsx`**~~ — DONE (`d25cf474`). These were built + tested but nothing called them (dead until wired):
   - `buildBrowseIdleReturnLoopModel` (browse-idle-actions.ts) → browse idle still renders old inline copy
   - `buildCalendarPreviewRailModel` → swap in when `isCalendarView`
   - calendar section headers (`buildCalendarRenderRows` sets `showSectionHeader`) → pass into `CalendarScheduleRow`
   - calendar loading/empty/error (`CalendarScheduleStatus` + `buildCalendar*State()`) → calendar empty path still plain text
   - history "new since E#" (`formatNewSinceEpisodeLabel`/`describeHistoryReturnLoopDetail` in root-history-bridge.ts) → root overlay still uses old row copy; a duplicate `buildRootHistorySelection` remains in the overlay until consolidated
2. ~~**Empty poster box (Now Playing)**~~ — DONE (`ffd8851f`). Root cause: the Now Playing/bootstrap surfaces render no poster, but a Kitty image placed by the prior surface (picker/browse/details) stayed uploaded — `usePosterPreview` cleanup deliberately skips clearing, and nothing cleared it on entry. Fix: `LoadingShell` clears rendered poster images on mount (cache + terminal in sync). Deleted the dead `shouldShowLoadingPosterCompanion`; runtime-health line now uses `statusColor()`.
3. ~~**S3 portability**~~ — DONE (`5c83bbd0`). truecolor→256→16 fallback via `packages/design/src/color-resolution.ts` (`tokens` now level-resolved, `rawTokens` is the literal set); preview rail collapses before list on narrow/SSH/tmux; CJK/long-title truncation + double-width alignment via display-column helpers in `shell-text.ts`.
4. ~~**Delete deprecated token aliases**~~ — DONE (`5c83bbd0`). Removed from `tokens.ts`, `shell-theme.ts`, and the `color-resolution.ts` fallback table; `grep -rE "palette\.(amber|teal|pink|info|lavender|green|red|gray|yellow|purple)" apps/cli/src` → 0.
5. **Merge-readiness + install verification** (parallelizable now — disjoint from app-shell): confirm `install.sh`, `README.md`, `docs/users/install-and-update.md`, root + `apps/cli` `package.json` scripts, `turbo.json`, and `.github/workflows/*` are correct so the branch merges cleanly and contributors can build/run/test from a fresh clone. Verify `install.sh` actually works (shellcheck + dry run), `bun install && bun run build && bun run test` succeed from clean, and CI matches the local gate. Note: `install.sh` is currently part of the user's uncommitted pre-existing WIP — decide whether it ships with Sakura or separately.
6. **Full gate + manual narrow/non-truecolor terminal pass** (`bun run dev`) → merge `design/sakura-rollout` → main.

## EXPERIENCE TRACK (premium / sticky — parallel or post-release)

6. **Engine audit** — provider cycle / resolve-with-fallback / cache (`packages/core`, `apps/cli/src/services/playback`). Goal: reliability + perf under provider churn. See [.docs/debugging-map.md], [.plans/kunai-playback-reliability-implementation.md].
7. **Prefetch audit** — `apps/cli/src/app/episode-prefetch.ts` (pre-existing WIP). Verify it warms the next episode smartly without hammering providers; measure cost.
8. **History reconciliation / latest-episode sync** — THE ep6→ep8 problem. Requirements:
   - If the user last watched E6 and E7/E8 have aired, surface "N new episodes" (ready-for-you in browse idle + history + calendar).
   - **Do NOT scrape providers to detect new episodes.** Use catalog/schedule data (TMDB/AniList via the schedule service) — see [.plans/catalog-release-schedule-service.md] and [.plans/attention-queue-notifications-audit.md].
   - Background reconcile: compare local history's known-latest vs catalog's actual-aired-latest; update history accurately so when next week's episode airs on its day, history reflects it without a manual refresh.
   - Must be performant (no per-keystroke or per-frame cost; debounced/cached background pass), smooth, reliable.
   - History surface polish rides on this (resume-first + new-since accuracy).

## NOT OURS — user's pre-existing WIP (uncommitted, leave alone)

`apps/cli/src/app/episode-prefetch.ts`, `apps/cli/src/services/presence/discord-activity-links.*` (test got a 1-line uncommitted fixture fix from us), `PresenceServiceImpl.ts`, `PlaybackPhase.ts`, `handoff-url.ts`, `operation-taxonomy.ts`, `install.sh`, `README.md`, several docs. User should commit/stash these separately.

## Discipline (every change)

Color = state/focus, never identity (type hue only in Stats). Semantic palette only. Footer ≤ 4 + commands. Per-surface loading/empty/error. Verify: `bun run typecheck && bun run lint && bun run test`. Open design calls to tune later: mint vs rose-gold success, petal sparseness, library glyphs vs words.
