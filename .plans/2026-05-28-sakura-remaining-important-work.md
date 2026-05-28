# Sakura — Remaining Important Work (delegatable execution plan)

Status: **active** · Branch: `design/sakura-canonical`
Design authority: [`.design/cli/kunai-sakura-canonical.html`](../.design/cli/kunai-sakura-canonical.html)
Source-of-truth order: **runtime code > `.docs/design-system.md` > this plan**.

## How to use this plan (for the executing agent)

- **One task at a time. Disjoint file ownership** — do not touch files owned by another task or by the lead.
- **Lead owns the shared seams** (`shell-theme.ts`, `tokens` in `@kunai/design`, `ink-shell.tsx`, `types.ts`) and final validation. If a task needs a change there, the brief says exactly what; propose it, don't free-edit.
- **No worktrees** (repo rule). **No new deps.** Bun runtime conventions per `CLAUDE.md`.
- **Quality rules:** DRY, one source of truth, no inline component definitions, no effect-derived state, reserve space before async loads, color encodes **state/focus only** (media-type hue → Stats only).
- **Validate every slice** and paste the evidence into the PR/commit body:
  1. `bun run typecheck && bun run lint && bun run test` — all green (suite is **1231** at plan time, 0 fail).
  2. Capture the touched surface(s) with the F1 harness (`apps/cli/test/harness/render-capture.ts` → `captureSurface`) at 72/100/140 and read the frames. Layout/regression must be _seen_, not assumed.
  3. Anything image/animation/terminal-takeover related (T1, T2) needs a **live `bun run dev` check** with a note describing what was observed — the harness strips ANSI and can't prove it.
- **Commit each task in its own scope** with a message that states the root cause and the fix.

## Already closed (do not redo)

- Focus zones + `[i]` details (A5), post-play rail artwork + up-next name + next-episode thumbnail + non-blocking prefetch, header crumb bleed, persistent "notifications" alert line, season-finale `next-season` action correctness.

---

## Task T1 — A6: kill the ghost poster on Now Playing · P0 bug

**Symptom:** a stale "Screenshot Error"/leftover poster image lingers top-right once playback starts (mpv takes over). Kitty/terminal-graphics images are positioned out-of-band and survive React unmounts.

**Owner files:** `apps/cli/src/app-shell/image-pane.ts`, `apps/cli/src/app-shell/loading-shell.tsx`, and the active-playback surface in `apps/cli/src/app-shell/ink-shell.tsx` (render path only — coordinate the call site with the lead).

**Do:**

- Trace where rendered Kitty images are tracked (`clearRenderedPosterImages` in `image-pane.ts`) and ensure it is called on **every transition out of a poster-bearing surface into playback** (loading → playing, post-play → playing), not only inside `loading-shell.tsx:368`.
- Prefer a single `useEffect` cleanup tied to surface identity over scattered manual calls (one source of truth).

**Acceptance:** entering playback from search/loading/post-play leaves **no** lingering image cell. Re-entering a poster surface re-renders cleanly.
**Validate:** live `bun run dev` on a Kitty-protocol terminal; describe before/after. Plus the existing `image-pane`/poster unit tests stay green.

---

## Task T2 — A7: loading dot-matrix animation desync · P1 bug

**Symptom:** the startup loader animation desyncs / double-renders (part of the autonext jank).

**Owner files:** `apps/cli/src/app-shell/dot-matrix-loader.tsx` (+ its test).

**Do:**

- Use the F1 **flicker probe** (`countCommits`) on the loader in isolation — an idle loader frame should be deterministic per tick. Find the desync (timer not cleared, state set after unmount, non-memoized frame derivation).
- Fix with a single interval, cleared on unmount; derive the frame from a tick counter, not from wall-clock in render.

**Acceptance:** `countCommits` shows one distinct frame per tick (no extra commits at a fixed tick); no animation while a key is held.
**Validate:** a `countCommits` assertion in a new/updated unit test + live `bun run dev` startup observation.

---

## Task T3 — B9: command palette layout corruption + scope · P1 bug

**Symptom:** opening the palette on results/playback overflows or garbles the layout; it can also target the wrong surface.

**Owner files:** `apps/cli/src/app-shell/shell-command-ui.tsx`, `apps/cli/src/app-shell/command-router.ts` (do **not** touch `domain/session/command-registry.ts` — that's T5's neighbor; coordinate).

**Do:**

- While the palette is open, **hide the companion/preview rail** and clamp the palette to the content width (reuse `getBrowseCommandPaletteMaxVisible` already in `browse-shell.tsx`; mirror for playback).
- Ensure the palette renders within the reserved region and never pushes the surface past `shellWidth`.

**Acceptance:** palette opens at 72/100/140 over browse results AND active playback with no overflow, no companion bleed, correct command set per context.
**Validate:** F1 captures of browse+palette and playback+palette at all three widths.

---

## Task T4 — D17: color hierarchy (the "feels flat" fix) · P0 polish, cross-cutting

**Symptom:** everything sits at one dusk-plum brightness; nothing leads the eye. Root cause of the recurring "not polished" reaction.

**Split to avoid seam conflicts:**

- **Lead (me):** confirm/extend the text ramp + accent tokens in `@kunai/design` `tokens` and `shell-theme.ts` `palette` so there is a real ladder: `text` (titles, brightest) → `textDim` → `muted` (metadata) → `dim` (chrome). No new colors — adjust luminance steps only.
- **Agent task:** apply the ladder per surface against a strict checklist. **Owner files:** the render files for browse rows, post-play, episode picker, calendar, stats footer, panels — one surface per commit. Do **not** edit `shell-theme.ts`/tokens (lead's).

**Rules (from `.docs/design-system.md`):** titles win by **weight + brightness**, never hue. Selection/focus = rose accent. Metadata = `muted`. Chrome/separators = `dim`. Type hue stays Stats-only. One accent per row max.

**Acceptance:** on each surface a clear 3-tier read (title / metadata / chrome); selected row is unmistakable; no rainbow; capture diffs show the contrast lift.
**Validate:** F1 captures before/after per surface (the harness strips ANSI, so _also_ paste a 1-line note on which tier each element now uses) + live spot check.

---

## Task T5 — fuzzy-match fix · P1

**Symptom:** palette/search don't reliably hit the obvious target (e.g. typing the start of a command/title ranks it below noise).

**Owner files:** `apps/cli/src/domain/session/fuzzy-match.ts` (+ its test). Pure logic — no UI.

**Do:**

- Add scoring that rewards prefix matches, contiguous runs, and word-boundary hits over scattered-subsequence matches; tie-break by shorter target. Keep it allocation-light (hot path).
- Lock behavior with table-driven tests: exact > prefix > word-boundary > subsequence; real palette/title examples from current failures.

**Acceptance:** documented ranking cases pass; existing fuzzy consumers (palette, search) unaffected except better ordering.
**Validate:** unit tests only (pure); note which real queries improved.

---

## Task T6 — Settings as switch/segment rows + `Switch` primitive · P2 surface

**Owner files:** new `apps/cli/src/app-shell/primitives/Switch.tsx`; settings option/render in `apps/cli/src/app-shell/panel-data.ts` (`buildSettingsOptions`, ~line 354) and the settings branch of `apps/cli/src/app-shell/overlay-panel.tsx`. Coordinate the overlay render seam with the lead.

**Do:**

- `Switch` primitive: boolean (mint-on `palette.ok` / muted-off) and segmented variant, glyph **and** word (never color-only — accessibility), reserved width so toggling never reflows.
- Render settings as grouped rows using it; keep the existing config plumbing (one source of truth — don't fork config state).

**Acceptance:** settings reads as grouped switch/segment rows matching canonical; toggling is instant, no reflow; values persist via existing `ConfigService`.
**Validate:** F1 capture of settings at 72/100/140 + a `Switch` unit/snapshot test.

---

## Task T7 — Diagnostics as calm grouped status (not a log dump) · P2 surface

**Owner files:** `apps/cli/src/app-shell/panel-data.ts` (`buildDiagnosticsPanelLines`, ~line 286) only. Render path is the shared line-overlay in `overlay-panel.tsx` (don't change the renderer; shape the data into clear `tone`-coded sections).

**Do:** group into Session / Provider / Network / Playback-startup sections with a one-line health verdict each; tone = state (ok/warn/error), not decoration. Keep `/export-diagnostics` pointer.

**Acceptance:** diagnostics reads as scannable grouped status, not a flat event dump.
**Validate:** F1 capture + the existing `support-bundle`/diagnostics tests stay green.

---

## Suggested order

1. **T1, T2, T3** (bugs — restore trust) → 2. **T4** (hierarchy — broadest polish) → 3. **T5** (fuzzy) → 4. **T6, T7** (surfaces).

T1/T2 are independent. T4 depends on the lead's token/palette step landing first. T6/T7 are independent of each other.

## Definition of done (every task)

Typecheck + lint + test green · F1 captures (and live note where required) pasted · committed in its own scope · this file's task checkbox ticked.
