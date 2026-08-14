# Sakura Surface Polish + Bug Triage

Branch: `design/sakura-rollout`. Source of truth for surface designs:
`.design/cli/surfaces/*.md`. Core finding: the Sakura rollout shipped the
token/color migration but **not the layout redesigns** — most surfaces still
render the old generic list UI. Specs exist; implementation lagged.

Derived from a full live-terminal review (2026-05-24). Order: **bugs first, then
redesigns** (user-chosen).

> **The real visual target is the HTML mockups, not these `.md` specs.** See
> `.prototypes/` (manifest maps screen→source): `shell-atlas/atlas-harness-v1.html`,
> `playback-postplay/workbench-rec-v1.html`, `ui-audit/mockups-rec-v1.html`,
> `calendar-schedule/calendar-rec-v1.html`; plus `.design/cli/*.html`. Build from
> those (`bun run prototype:serve`); the `.md` specs are lossy summaries that
> caused visual drift (sloppy border, letter-tile, sparse post-play).

## A. Correctness bugs

- [x] **A1 — false "complete" when playback didn't start.** A movie exited on
      load showed "movie complete / you finished". Fixed `a6e2fdf1`: added
      `playbackStarted` (eof OR ≥30s OR resume>10s) + `did-not-start` post-play
      state. `post-play-state.ts`, `post-play-input.ts`, `PlaybackPhase.ts:~2449`,
      `post-play-shell.tsx`.
- [x] **A2 — session context bleeds into fresh search.** "autoplay paused" banner
  - `/download` context active after returning from playback. Fixed `68ee5a16`:
    `SessionController.ts` now dispatches `RESET_CONTENT` on `back_to_search`.
- [x] **A3 — post-play recommendations never show.** `649e8930`: the seed-empty
      path warmed recs into a background task whose result was only logged (no
      re-render path). Replaced with a budgeted live load (≤1200ms) before first
      paint, loaded at most once per post-play session, so the rail is populated
      when the shell opens. **Needs live confirm** recs render after a finish.
- [x] **A4 — search-result poster never renders.** `c57b1ceb`: root cause was
      `PreviewRail` only ever drawing the letter tile (`buildContextCardTile`) +
      a stray single-line border — the poster `browse-shell` already resolved was
      never passed in. Now renders the real chafa/Kitty poster in a borderless,
      height-reserved slot (matches the earlier version the user preferred).
      **Needs live confirm** the poster paints at their size.
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
- [~] **B9 — palette overflows/corrupts layout** on results/playback (Img 10/30/31).
  `27223b06`: the companion preview stayed rendered with the palette open and
  its taller content overlapped/garbled the palette rows — now hidden while
  command mode is active. **Remaining:** the in-palette "▼ more"/row collision
  ("moreloads") if it persists after the B8 reserved-line fix — needs live confirm.
- [x] **B10 — calendar layout garbled** (Img 23/24). `6fd9020d`: `CalendarScheduleRow`
      guessed the title budget as `rowWidth-22`, so long availability labels +
      badges overflowed and wrapped into the next row. Now the title is truncated
      to the measured remaining width after marker+glyph+label+badge so the line
      always fits. **Needs live-terminal confirm** the interleave is gone.

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
- [x] **C14 — Post-play = "episode page + remote"** → `e79b7dbf`: rebuilt
      `post-play-shell.tsx` to `.prototypes/playback-postplay/workbench-rec-v1.html`
      — per-state heroes (⏸ stopped early + resume / NEXT <ep> / ✦ SERIES COMPLETE
      / ◉ caught up / season finale w/ progress), labelled discovery divider, and
      numbered inline picks (1·2·3). **Needs live verify** + the 1–3 pick keybinds
      may still need wiring in the playback shell input handler.
- [ ] **C15 — History** consistency polish (Img 20). Spec: `stats-history-library.md`.
- [x] **C16 — Calendar tabs** → `6fd9020d`: Tab/Shift+Tab cycle the type tabs
      (number keys removed; mode toggle suppressed in calendar view); tab strip +
      footer hints updated. Pairs with B10.

## D. Cross-cutting

- [ ] **D17 — color hierarchy.** Palette reads monotonic — everything at one
      weight. Within the Sakura discipline (color = state/focus), establish real
      hierarchy: strong primary/selected, dim secondary, structural contrast, less-flat
      footer. Apply per-surface during C.

## Notes

- Live-only verification (A4/A6/A7/B9/B10 visual confirmation, all C/D) requires
  the user's terminal — no TTY/Kitty/streams here.
- Commit each fix in its own scope; gate `typecheck + lint + test` stays green.
