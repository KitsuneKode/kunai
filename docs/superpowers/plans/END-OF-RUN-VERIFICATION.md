# End-of-Run Manual Verification Checklist

Accumulated while executing C2 / 1b / Plan R. Run `bun run dev` and verify all of
these together at the end. Static checks (typecheck/lint/test/build) are run per
chunk; these are the things that need a human watching the live TUI.

## C2 — flow coherence / movie fix

### Done (display layer, committed — verify live)

- Content-kind label + S·E visibility now derive from `TitleInfo.type` (+ mode for
  anime) via `app-shell/content-kind.ts`, wired into: idle shell, Now-Playing crumb
  (`root-status-summary`), playback subtitle (`ink-shell`). Movie internal `{1,1}`
  episode is kept (resolve + history-save need it) but never displayed.

### Still open (next chunks)

- [ ] **Movie continue / restart** (user-requested; covered by Plan C Pillar 1+4 &
      Plan 1 movie edge case): movie must appear in the continue menu and resume its
      saved position; post-play must offer **restart/replay + recommendations** (no
      "next episode"). Verify history→continue for a movie and the post-play menu.
- [ ] **Movie subtitle profile bug:** `root-status-summary.ts:110` (and peers) pick
      `seriesLanguageProfile` for any non-anime — movies should use
      `movieLanguageProfile`. Needs a `mediaLanguageProfileFor(state)` helper + wiring
      the ternary call sites (scattered mode-based logic).
- [ ] **Deep intake / play(PlayableRef):** route surfaces through one `play(ref)`;
      confirm a movie's `currentTitle.type` is `"movie"` from every entrypoint.
- [x] **Movie resume/restart CHOICE — IMPLEMENTED 2026-05-31 (verify live).**
      Real root cause was more upstream than first hypothesized: `PlaybackPhase.execute`
      gated the entire starting-point decision behind `if (title.type === "series")`;
      the movie `else`-branch set episode `{1,1}` and left `pendingStart` at
      `startFromBeginning()`, so a movie alway started at 0 with no menu. Fix:
      `chooseMovieStartingPoint` (`session-flow.ts`) mirrors the series flow using the
      same `openListShell` primitive — when a movie has resumable progress it offers
      **Resume** (seek directly) / **Restart** (from 0); finished/no-progress plays from
      the start with no menu. Pure decision `resolveMovieStartingChoice` is unit-tested.
      **Live check:** play a partially-watched movie from history → menu appears, Resume
      seeks to saved position, Restart starts at 0; a fresh movie plays with no menu.

> **Sequencing note (found 2026-05-29):** movie continue/restart is **entangled with
> 1b**. `isHistoryPickerContinuable` (`panel-data.ts:857`) runs through
> `reconcileContinueHistory` (deleted by 1b) and a **completed movie returns
> not-continuable with no replay path**. The fix is NOT a band-aid here — do **1b
> first** (swap to `projectContinuation`/`ContinueWatchingService`, which handles a
> movie as a single-row anchor: resume if unfinished, else offer **restart**), then the
> movie restart affordance + the `did-not-start`-style post-play movie branch fall out
> cleanly. Done done done: completed-movie ⇒ "Restart"; in-progress movie ⇒ "Resume".

### Live checks

- [ ] Play a **movie** (e.g. "Transformers"): header shows `movie` (not `series`),
      **no** `S01E01` label anywhere (Now-Playing header, idle shell, loading shell).
- [ ] Movie has **no autoplay countdown** at end; post-play offers recommendations,
      not "next episode".
- [ ] Movie **continue/resume** works from history (resumes saved position, no S/E).
- [ ] A **series** still shows `S·E`, autoplays next, resumes correctly (no regression).
- [ ] An **anime** still labels `anime`, autoplays, resumes (no regression).
- [ ] Play a **recommendation** / **trending** / **queue** item — each launches via the
      same path, correct kind/label, no dead-end.

## 1b — history facade retirement

**Anchor-rule behavior fix landed 2026-05-31 (verify live).** Both live engines
(`reconcileContinueHistory`, `projectContinuationState`) did `.find(unfinished)` over
recency-sorted rows — resuming an OLDER abandoned episode when the most-recent was
finished. Both now anchor on the most-recent row (resume if unfinished, else advance),
matching the already-tested `projectContinuation`. This is the user-visible behavior;
the full facade/`HistoryEntry` retirement is now a behavior-preserving mechanical swap.

- [ ] Title whose most-recent episode is **finished** but has an older unfinished
      episode: Continue shows **advance/up-to-date**, NOT resume-the-old-one.
- [ ] Title whose most-recent episode is **unfinished**: resumes that episode.
- [ ] `/history` lists correctly (continue/completed/new-episodes/all tabs).
- [ ] Continue Watching row shows correct anchor per title, recency-ordered.
- [ ] `/calendar`, `/discover`, search badges still show correct history-derived state.
- [ ] Episode picker shows accurate per-episode progress dots.

### Remaining mechanical retirement (de-risked, do when wiring deep-intake)

- Dead JSON `HistoryStoreImpl` removed 2026-05-31.
- Still present: `HistoryStore`/`SqliteHistoryStoreImpl` facade, `HistoryEntry` (143
  uses / 27 files), the two near-duplicate engines. Because the engines now behave
  identically to `projectContinuation`, swapping callers to
  `ContinueWatchingService` + `HistoryProgress` is a pure refactor (no behavior delta).

## Plan 2 / Plan 3 foundations (committed, unit-tested — mostly dormant until wired)

- `computeReleaseProgress` numbering-axis guard: cross-cour / absolute-vs-cour mismatch
  now yields `unknown`, not a false `caught-up`. Wired into `buildProjection`.
- `classifyReleaseStatus`: TMDB date-only episodes dated **today** stay `upcoming`
  (not prematurely `released`). Wired (used by the schedule classification).
- `resolveUpNext` (Plan 3/F): pure unifier of episode-chain vs cross-title queue.
  **Not yet wired** into the shell — verify when the Up Next surface is built.
- `ContinueWatchingService` / `projectContinuation` / `PlayableRef` / `buildPlayIntent`:
  **registered but dormant** (no surface consumes them yet) — they go live in 1b / the
  deep-intake wiring; verify then.

## Plan R (rescope) — render robustness

- [ ] Resize the terminal during the shell + during playback bootstrap: no flicker,
      no artifacts, layout reflows cleanly.
- [ ] Quit / Ctrl-C / kill: terminal restored, prior scrollback intact, cursor shown,
      no ghost posters (A6).
- [ ] Loading dot-matrix animation is smooth, no desync (A7).
- [ ] Lists don't "dance" on paging (B8).
