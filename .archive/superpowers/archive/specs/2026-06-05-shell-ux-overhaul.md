# Shell UX Overhaul — Findings + Slice Plan

Status: draft, grounded in live screenshots (2026-06-05)
Owner: app-shell

Goal: fix the Ink anti-patterns and lift the main interactive surfaces (browse
details, playback, post-playback, download flow, episode/provider selection) to a
clean, efficient, premium feel. Worked as **verified slices** — each slice is one
surface, the user runs it and confirms before the next.

Working mode (important): these are visual changes the agent cannot verify by
running the TUI. Each slice ships with a unit test on the pure view-model where
possible, and a user screenshot confirm before it is considered done.

---

## 1. Browse "Title overview" detail overlay (screenshot-confirmed)

**Symptoms:** sparse "spam" layout with blank lines between every value; values
shown without their labels (`Series`, `2008`, `8.9/10 TMDB` floating); a stray
overlap artifact (`Breaking Bad`**ew**); no inline poster; needless scroll
(`Showing 6–11 of 21`).

**Diagnosed causes (code):**

- `DetailsSheetUI` (`details-pane-ui.tsx`) does `lines.slice(headerLines.length)` —
  it drops the first N panel lines on the _assumption_ they equal the header
  lines, which misaligns the body and hides labels.
- `buildBrowseDetailsPanel` (`details-panel.ts`) emits redundant content: an
  "At a glance" line (`Series · 2008 · 8.9/10`) AND separate `Type` / `Year` /
  `Rating` facts; plus an "Open · Press Enter" line the footer already states; plus
  `─── Selection / ─── Local / ─── Details / ─── Synopsis / ─── Availability`
  section headers that each cost a row. ~21 lines for ~5 real facts.
- No poster is rendered in the inline/overlay detail path (the `imageUrl` is built
  but the inline renderer doesn't draw it).

**Fix direction:**

- Stop the blind `slice`; render the panel lines as authored.
- Collapse to one compact card: poster (left, `usePosterPreview` `detail` variant)
  - title + `type · year · rating` + tracked/continue chip + 3–4 line synopsis.
    Drop "At a glance" duplication, the "Open" line, and most section rules.
- Target: no scroll for typical titles; labels aligned; poster visible.
- Verify: unit test asserts the line model has no duplicate Type/Year/Rating and ≤
  ~8 rows for a typical option; user screenshot confirm.

## 2. Playback "Now Playing" screen (screenshot-confirmed)

**Symptoms:** control lines crammed at the top as dense `·`-separated rows
(`NOW …`, `GO n next · p prev · b skip · o source · v quality · e episodes…`,
`r recover · f fallback · t tracks · d diagnostics`); the **same shortcuts repeated**
in the bottom footer (`[q] stop [e] episodes [t] tracks [space] pause`); redundant
copy (`subs subtitle selected`); a large dead vertical void; no poster / no real
"up next" card using the space.

**Fix direction:**

- One source of truth for shortcuts: keep the footer action row, remove the
  duplicated inline `GO …` / `r recover …` rows (or vice-versa) — never both.
- Group status as a compact line: `1080p · sub · autoskip · autoplay` (drop
  "subtitle selected" redundancy; one token each).
- Use the void: a poster + "Up next S01E03" card (with its thumbnail), centered,
  so the screen reads as a player, not a wall of keys.
- Buffering notice as a single quiet inline status, not a red block competing with
  controls.
- Verify: view-model test for the status/should-show logic; user screenshot.

## 3. Post-playback screen

**Symptoms (reported "lame/spam"):** same family of issues — dense option rows,
weak hierarchy, poor use of space.

**Fix direction:** mirror the playback cleanup — one clear "what next" card (next
episode / replay / related), poster, and a single action row. Reuse the
playback-screen primitives so both feel like one product.

## 4. Not-working shortcuts (download / details) + Ink input anti-patterns

**Symptoms (reported):** `d` (download) and details (`Shift+Enter` / `i`) "kind of
not working"; selection of some things feels "weird".

**Investigate:** the browse `useInput` handler ordering in `browse-shell.tsx` and
`shell-command-ui.tsx` vs `input-router.ts` — bare-letter shortcuts (`d`, `q`, `i`)
gated behind `listFocused` + `searchState === "ready"` + `!queryDirty`, so they
silently no-op when the focus zone / readiness isn't what the user expects. Likely
fixes: clearer focus model, consistent gating, and a visible hint when a shortcut
is unavailable and why.

**Verify:** focus-zone reducer unit tests for the exact key→action mapping per zone.

## 5. "Weird" selection states

**Needs specifics per surface** (which list, what looks wrong). Capture each with a
screenshot; likely the same `surfaceActive` band / highlight inconsistency the
Ember Dusk palette already improved — confirm against the new tokens first.

## 6. Manual per-episode provider switch (feature)

**Want:** switch the provider for a _specific_ episode manually (not just the
session default).

**Direction:** in the episode picker / source picker, add a "switch provider for
this episode" action that re-resolves only that episode against a chosen provider,
preserving the rest of the chain. Touches the source/provider picker routing and
the resolve coordinator — design before building; do NOT change provider scraping.

---

## 7. Rich source/server picker (feature)

**Want:** a `/source` picker like the web "Servers" tab — each row a named server with
an audio-language flag/label and a quality hint ("Original audio", "may have 4K"),
selectable, with favorite/pin.

**Already present:** `serverName` + `audioLanguages` on the stream model
(`packages/types`), a `track-capabilities` "source" section, the `/source`/`o`
picker, and `PlaybackSourceInventory*`. **Work:** enrich the source-section view
model to surface server name + language label (flag emoji from language code) +
quality hint, render them as a rich list, and add favorite/pin (persisted in config).
Do NOT change provider scraping — only surface what resolve already returns.

## 8. Rich detail overlay + trailer (feature)

Poster + structured colored sections + cast/availability, and **trailer** via TMDB
`/{type}/{id}/videos` → YouTube key → open in browser/mpv (how vidking/cineby show
trailers). The detail overlay currently uses the generic line renderer with no poster.

## Calendar visual polish (rendering-loop items)

Tab-label truncation (Ink background-color bleed on the active pill), kitty/chafa
poster artifacts bleeding into rows, theme tweaks. Need a screenshot loop — not
test-reproducible.

## Slice order (each user-verified)

1. Detail overlay compaction + poster (#1) — clearest, self-contained.
2. Shortcut/input audit + fixes (#4) — correctness, unblocks the rest.
3. Playback screen layout (#2).
4. Post-playback screen layout (#3).
5. Selection-state polish (#5) — needs per-surface screenshots.
6. Per-episode provider switch (#6) — feature, own brainstorm.

## Release posture

The current `main` bundle (unified calendar, Ember Dusk palette, command-palette
fix, branded README, 0.2.3) is verified green and independent of this overhaul.
Recommendation: ship it as 0.2.3 now; land this overhaul as verified slices toward
0.2.4 rather than bundling unverified UI into one push.
