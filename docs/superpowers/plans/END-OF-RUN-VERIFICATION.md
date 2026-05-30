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

- [ ] `/history` lists correctly (continue/completed/new-episodes/all tabs).
- [ ] Continue Watching row shows correct anchor per title, recency-ordered.
- [ ] `/calendar`, `/discover`, search badges still show correct history-derived state.
- [ ] Episode picker shows accurate per-episode progress dots.

## Plan R (rescope) — render robustness

- [ ] Resize the terminal during the shell + during playback bootstrap: no flicker,
      no artifacts, layout reflows cleanly.
- [ ] Quit / Ctrl-C / kill: terminal restored, prior scrollback intact, cursor shown,
      no ghost posters (A6).
- [ ] Loading dot-matrix animation is smooth, no desync (A7).
- [ ] Lists don't "dance" on paging (B8).
