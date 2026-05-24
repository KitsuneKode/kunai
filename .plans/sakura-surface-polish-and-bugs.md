# Sakura Surface Polish + Bug Triage

Branch: `design/sakura-rollout`. Source of truth for surface designs:
`.design/cli/surfaces/*.md`. Core finding: the Sakura rollout shipped the
token/color migration but **not the layout redesigns** — most surfaces still
render the old generic list UI. Specs exist; implementation lagged.

Derived from a full live-terminal review (2026-05-24). Order: **bugs first, then
redesigns** (user-chosen).

## A. Correctness bugs

- [x] **A1 — false "complete" when playback didn't start.** A movie exited on
      load showed "movie complete / you finished". Fixed `a6e2fdf1`: added
      `playbackStarted` (eof OR ≥30s OR resume>10s) + `did-not-start` post-play
      state. `post-play-state.ts`, `post-play-input.ts`, `PlaybackPhase.ts:~2449`,
      `post-play-shell.tsx`.
- [x] **A2 — session context bleeds into fresh search.** "autoplay paused" banner
  - `/download` context active after returning from playback. Fixed `68ee5a16`:
    `SessionController.ts` now dispatches `RESET_CONTENT` on `back_to_search`.
- [ ] **A3 — post-play recommendations never show.** `PostPlayShell` supports
      `recommendations` and `PlaybackPhase.ts:2509` passes `recommendationRailItems`,
      but they're seeded synchronously and only _warmed_ fire-and-forget
      (`PlaybackPhase.ts:2447`) — post-play opens before warm completes and there's
      **no re-render when recs arrive**. Fix: refresh the post-play shell when the
      warm finishes (or await a short budget before first paint when seed is empty).
- [ ] **A4 — search-result poster never renders.** Companion shows only the
      letter tile (Img 8/9). Episode stills DO render in the picker, so the pipeline
      works for some sizes. Likely the detail/companion variant URL or capability.
      Trace `usePosterPreview` in `browse-shell.tsx` DetailsSheet/companion path.
      Needs live terminal.
- [ ] **A5 — details key + browse focus-zone model.** Shift+Enter can't be
      detected (terminals don't send a distinct code). Decided: rebind to `i`.
      BUT `i` as a plain key would be typed into the query, because browse has no
      focus zones today — typing always edits the query while arrows navigate
      results in parallel (`browse-shell.tsx` main `useInput`). So A5 requires a
      **focus-zone state machine** first: - Zones: `input` (default) → `results` → `filter`. - `input` focused: printable keys edit query; `↓` shifts focus to `results`
      (context moves down, does NOT hijack/clear input). - `results` focused: `↑/↓` navigate; `i` opens details; `enter` plays/opens;
      a key returns focus to `input` (`↑` at top of list, or a dedicated key);
      printable keys do NOT leak into the query. - `filter` bar: reachable as its own zone; `↑/↓` move between filter and
      results/input cleanly. - Footer reflects the active zone's hotkeys; `i` shown as `[i] details`.
      **Build with live verification (input-handling = high regression risk).**
      Implement the zone reducer as a tested pure function, then wire + verify feel.
- [ ] **A6 — "Screenshot Error" ghost poster** top-right of Now Playing (Img 15).
      Stale Kitty image / failed screenshot region. Same cleanup class as the
      LoadingShell fix; check the Now Playing poster/preview path.
- [ ] **A7 — loading dot-matrix animation desyncs** (Img 14). `dot-matrix-loader.tsx`
      timer/frame cadence vs re-render. Needs live terminal.

## B. Layout/render stability

- [x] **B8 — command palette "dancing" on paging.** Fixed `53f08fae`: ▲/▼ "more"
      lines always reserved. **Remaining:** disabled-command reason line + group-header
      margins still shift height by a row — fold into palette polish.
- [ ] **B9 — palette overflows/corrupts layout** on results/playback (Img 10,
      "moreloads" overlap). Palette taller than its slot collides with the list.
      Needs a bounded fixed-height container; verify against `maxVisible` budget.
- [ ] **B10 — calendar layout garbled** (Img 23/24). Day labels, titles, and
      availability strings overlap/interleave — broken column composition in
      `calendar-ui.tsx` / `calendar-results.ts`. Highest-visibility layout bug.

## C. Surface redesigns (spec exists, not implemented)

- [x] **C11 — Episode/Season picker** → two-pane: dense list + right preview rail.
      `faafed26`: `OverlayPanel` episode-picker now renders the list left + a
      height-reserved preview rail right (`EpisodePreviewRail`); rail hides <56
      cols. All gated on episode-picker (provider/history/settings unchanged).
      Spec: `episode-season-picker.md`. **Needs live verify** (poster placement,
      no metadata jump on artwork load). Follow-up: `[s] season` footer binding
      not wired (needs season-switch-from-episode-picker plumbing).
- [x] **C12 — Active playback** → episode control surface. `ce69dc0c`: playing
      body in `loading-shell.tsx` now renders structured rows (health → tracks →
      session → progress → up next), promotes trouble inline, footer = pause·stop·
      episodes·tracks·commands, `t` opens tracks. From existing state, no new
      plumbing. Spec: `active-playback.md`. **Needs live verify** (hierarchy/feel,
      thumbnail slot is still absent — body has no poster; revisit if desired).
- [x] **C13 — Tracks/quality picker** → scoped/grouped (source/quality/audio/
      subtitle sections). Today a flat 30-row dump (Img 18). Spec: `tracks-panel.md`. - [x] Backend contract: `domain/playback/track-capabilities.ts`
      (`buildTrackCapabilities` normalizes the inventory view into sectioned
      `TrackCapability[]`, tested) — `544e02bc`. - [x] Render: `TracksPanelShell` (`tracks-panel-shell.tsx`) — section headers,
      selectable-vs-fact rows, risk hierarchy; pure flatten/nav model
      (`buildTrackPanelRows`, deep-link index, `sectionvalue` encode) — `c95f666e`. - [x] Wire `/tracks` `/source` `/quality` to the unified `tracks_panel`
      overlay (deep-link section), replacing the three flat pickers across the
      active-playback (ink-shell), mid-playback, and post-playback (PlaybackPhase)
      flows; selection mapped via `streamSelectionFromTrackPick` → restart by
      section. Removed dead `openSourcePicker`/`openQualityPicker` — `5681b12c`.
      **Needs live verification** (TTY): panel layout, navigation feel, that a
      source/quality/audio switch actually restarts at the right stream/resume. - [ ] Follow-up cleanup (deferred, low-risk): the `source_picker` /
      `quality_picker` `OverlayState` members + their `root-overlay-shell` render
      branches are now dormant (nothing opens them). Removing them is a reducer-
      guard cascade — do as its own scoped commit, not mixed with feature work.
- [ ] **C14 — Post-play = "episode page + remote"** → action rows + preview rail
  - recs + per-state layout. Today sparse text. Spec: `post-playback.md`.
    (A1/A3 are prerequisites.)
- [ ] **C15 — History** consistency polish (Img 20). Spec: `stats-history-library.md`.
- [ ] **C16 — Calendar tabs** → Tab/Shift+Tab segmented tabs (like Claude Code),
      not "1 2 3 4". Pairs with B10.

## D. Cross-cutting

- [ ] **D17 — color hierarchy.** Palette reads monotonic — everything at one
      weight. Within the Sakura discipline (color = state/focus), establish real
      hierarchy: strong primary/selected, dim secondary, structural contrast, less-flat
      footer. Apply per-surface during C.

## Notes

- Live-only verification (A4/A6/A7/B9/B10 visual confirmation, all C/D) requires
  the user's terminal — no TTY/Kitty/streams here.
- Commit each fix in its own scope; gate `typecheck + lint + test` stays green.
