# Kunai Shell v4 — Ranked Implementation Map

> Ranked by **User Impact / Effort**. Companion to [kunai-shell-v4.html](./kunai-shell-v4.html), [surfaces/shell-v4-state-inventory.md](./surfaces/shell-v4-state-inventory.md), [02-state-ux.md](./02-state-ux.md), and [03-component-boundaries.md](./03-component-boundaries.md).
>
> **Scope boundary:** Onboarding (install, setup wizard, first Browse intro, first stream card) is owned separately and excluded here except at explicit handoff seams.

## Strategy: Shrink the Five Giant Files While Raising Shell UX to 9+

Today, four monolithic shell files hold **11,068 lines** (`browse-shell.tsx` 2,903L, `workflows/shell-workflows.ts` 2,837L, `root-overlay-shell.tsx` 2,791L, `ink-shell.tsx` 2,537L), plus `loading-shell.tsx` (1,061L) and `SearchPhase.ts` (1,631L). Because each surface re-implements footers, confirmations, focus cues, loading rails, and narrow-width clamping inline, states drift across screens.

Every item below either fits an existing primitive in `03-component-boundaries.md` or **extracts one new shared primitive** so those five files **shrink rather than grow**:

| New Shared Primitive | Replaces inline code across | Target Line Reduction |
| --- | --- | --- |
| `ConfirmStrip` (`primitives/ConfirmStrip.tsx` + `confirm-strip.model.ts`) | `root-overlay-shell.tsx` (History, Up Next, Notifications), `library-shell.tsx`, `download-manager-shell.tsx`, `shell-workflows.ts` | ~380 lines removed across 4 files |
| `resolveEscStack` (`esc-stack.ts`) | `root-overlay-shell.tsx:1776-1835`, `browse-shell.tsx`, `library-shell.tsx:318`, `download-manager-shell.tsx:378`, `ink-shell.tsx:1730` | ~180 lines consolidated into 1 pure reducer |
| `ContinueSourcePrompt` (`primitives/ContinueSourcePrompt.tsx`) | `root-overlay-shell.tsx:2533`, `smart-auto-launch.ts`, `browse-shell.tsx`, `post-play-shell.tsx` | Fixes "Ask" seam on all 3 entry points with 1 component |
| `FailoverBanner` (`primitives/FailoverBanner.tsx`) | `loading-shell.tsx:992-1007`, `playback-recovery.ts:413`, `run-mpv-playback-session.ts` | ~110 lines extracted from `loading-shell.tsx` |
| `OverlayListChrome` (`primitives/OverlayListChrome.tsx`) | `root-overlay-shell.tsx` (History, Up Next, Notifications, Diagnostics, Help, Guide) + `library-shell.tsx` + `download-manager-shell.tsx` | ~520 lines removed from `root-overlay-shell.tsx` |
| `emptySafeFooterActions` (`shell-primitives.tsx` helper) | `root-overlay-shell.tsx`, `library-shell.tsx`, `download-manager-shell.tsx`, `browse-shell.tsx`, `SettingsOverlay.tsx` | Eliminates dead footer keys on every empty surface |
| `PlainQuietPolicy` (`plain-mode.ts` helper) | `loading-shell.tsx`, `use-history-overlay-input.ts`, `SettingsShell.tsx`, `root-overlay-shell.tsx`, `browse-shell.tsx` | Stops screen-reader timer & `onRedraw()` chatter globally |

---

## Ranked Backlog (User Impact / Effort)

Scores use a 1–5 scale (`Impact` 5 = fixes broken trust/usability on daily path; `Effort` 1 = <0.5 day, 5 = multi-day refactor).

### Rank 1 · Fix Post-play Narrow Overflow, Wrong Header Chip, Double Resume & Phantom `x cancel`
- **Impact / Effort:** 5 / 1 (**Ratio: 5.0**)
- **Why:** Live L2 captures at 120×32, 54×25, and 40×20 proved four defects on the screen every user hits after every episode: header says `Up Next` instead of `Post-play`, `NextUpHeroCard` renders 58 cols wide inside 40- and 54-col terminals (garbling text and dropping `[/] commands`), `stopped early` duplicates Resume twice, and an inline hint advertises `x cancel` with no active countdown.
- **Files touched:** `apps/cli/src/app-shell/post-play-shell.tsx` (`:434-466, :510-515, :647-720`), `apps/cli/src/app-shell/post-play-view.ts`, `apps/cli/src/app-shell/ink-shell.tsx` (post-play `AppHeader` destination pill).
- **Component boundary:** Fits existing `ActionList` + `ShellFooter` + `MediaPanel` (`03-component-boundaries.md`); removes ad-hoc inline footer (`post-play-shell.tsx:697-720`), shrinking `post-play-shell.tsx` by ~45 lines.
- **Proof test (L2):** `cd apps/cli && bun run agent:drive -- --width 40 --rows 20 --mpv fake --show frame,keys --keys smoke "<enter>" "<wait:Smoke>" "<enter>" "<wait:Post-play>"` — assert `--verify-citation "Post-play"`, `--verify-citation "[/]"`, zero lines >40 cols, and no `x cancel` when `autoplay` countdown is absent.
- **Dependencies:** None.

### Rank 2 · Fix Calendar Error Header (`● Searching…`), Leaked Browse Footer & `aired · resolving` Guard
- **Impact / Effort:** 5 / 1 (**Ratio: 5.0**)
- **Why:** Live L2 capture showed Calendar error rendering `● Searching…` in the header, keeping `← → day · ⇥ type` hints over an error, and leaking Browse's `[enter] play  [Tab/⇧Tab] anime mode` footer instead of `[r] retry  [esc] back  [/] commands`. Also fixes naming drift (`Schedule` vs `Calendar`) and prevents dead playback attempts on `aired · resolving`.
- **Files touched:** `apps/cli/src/app-shell/browse-shell.tsx` (`:2240-2277, :2463-2477, :2665-2720`), `apps/cli/src/app-shell/calendar-ui.tsx`, `apps/cli/src/app-shell/calendar-ui.model.ts`, `apps/cli/src/app-shell/hooks/use-calendar-route.ts`.
- **Component boundary:** Fits existing `CalendarSchedule` + `StateBlock` + `ShellFooter`; extracts `calendarFooterActions()` out of `browse-shell.tsx` into `calendar-ui.model.ts` (shrinks `browse-shell.tsx` by ~70 lines).
- **Proof test (L2):** `cd apps/cli && bun run agent:drive -- --width 120 --rows 32 --providers none --show frame,keys --keys "/" "<wait:GLOBAL>" calendar "<enter>" "<wait:Schedule unavailable>"` — assert header contains `● issue` (not `Searching…`) and footer contains `[r] retry` (not `anime mode`).
- **Dependencies:** None.

### Rank 3 · Fix 40-col Browse Scroll-Indicator Overwrite, Palette 1-Row Peephole & `AppHeader` Bleed
- **Impact / Effort:** 5 / 1.5 (**Ratio: 3.3**)
- **Why:** Three verified live L2 layout bugs: (1) Search at 40×22 overwrites row 1 (`  ▼ ...e Movie (2026)`); (2) Browse Command Palette at 120×32 shows only **1 command** with 12 blank lines above it (`getBrowseCommandPaletteMaxVisible`); (3) Now Playing at 40×20 truncates brand + pill into `🦊 Kun  ·  Now Playin● Playing · 40×20` and drops `[q] stop` + `[/] commands`.
- **Files touched:** `apps/cli/src/app-shell/layout-policy.ts` (`:151-167, :311-352`), `apps/cli/src/app-shell/primitives/AppHeader.tsx` (`:54-94`), `apps/cli/src/app-shell/shell-primitives.tsx` (`selectFooterActions` `:58-116` — pin critical stop + `[/] commands` at narrow widths), `apps/cli/src/app-shell/browse-shell.tsx` (`:2221, :2631` remove double divider + duplicate `actionFeedback`).
- **Component boundary:** Fits existing `ShellFrame` / `AppHeader` / `Footer` / `layout-policy.ts`.
- **Proof test (L2):** Three L2 assertions at 40×20 (Search, Home, Now Playing) + 120×32 Palette: verify ≥6 visible commands in Palette, zero line collisions at 40 cols, and `[/]` present in every footer.
- **Dependencies:** None.

### Rank 4 · Unify Destructive Confirmations (`ConfirmStrip`) & Global `Esc` Stack (`resolveEscStack`)
- **Impact / Effort:** 5 / 2 (**Ratio: 2.5**)
- **Why:** Four incompatible confirm patterns exist today (`y/Esc` printed 3× in History with dead footer chips; double-press `x` in Library; double-press `x`/`X` in Downloads; double-press `x`/`c`/`C` in Up Next where **Esc closes the overlay instead of cancelling confirm** because `queueConfirm` was omitted at `root-overlay-shell.tsx:1783-1789`; full-screen modal in Playlists).
- **Files touched:** **NEW** `apps/cli/src/app-shell/primitives/ConfirmStrip.tsx`, **NEW** `apps/cli/src/app-shell/esc-stack.ts`, `apps/cli/src/app-shell/root-overlay-shell.tsx`, `apps/cli/src/app-shell/library-shell.tsx`, `apps/cli/src/app-shell/download-manager-shell.tsx`, `apps/cli/src/app-shell/workflows/shell-workflows.ts`.
- **Component boundary:** **Needs 2 new shared primitives** (`ConfirmStrip` + pure `resolveEscStack`) — directly shrinks `root-overlay-shell.tsx` (~220L), `library-shell.tsx` (~50L), `download-manager-shell.tsx` (~60L), and `shell-workflows.ts` (~50L).
- **Proof test (L2):** Drive History `x` → assert `[y] delete` + `[esc] cancel` in footer (no `[enter] resume`), press `<esc>` → assert History stays open and row remains; repeat for Up Next `x` → `<esc>` (proves Up Next stays open!).
- **Dependencies:** None.

### Rank 5 · Eliminate Dead Footer Keys on Empty States & Migrate Settings + Downloads to `ShellFooter`
- **Impact / Effort:** 4.5 / 1.5 (**Ratio: 3.0**)
- **Why:** Live captures showed History, Library, Up Next, and Notifications advertising `[enter] resume`, `[x] delete`, `[J/K] reorder`, `[a] actions` on 0-row empty screens, while Settings (`SettingsOverlay.tsx`) and Downloads (`download-manager-shell.tsx`) bypass `ShellFooter` completely (so `--show keys` sees zero keys and mouse chips don't work). Also fixes `1 titles` plural bug (`root-overlay-shell.tsx:2504`) and removes contradicting `🦊 empty for now` above `For you now`.
- **Files touched:** `apps/cli/src/app-shell/shell-primitives.tsx` (**NEW helper** `emptySafeFooterActions`), `apps/cli/src/app-shell/primitives/StateBlock.tsx`, `apps/cli/src/app-shell/root-overlay-shell.tsx`, `apps/cli/src/app-shell/library-shell.tsx`, `apps/cli/src/app-shell/download-manager-shell.tsx`, `apps/cli/src/app-shell/settings/SettingsOverlay.tsx`, `apps/cli/src/app-shell/settings/SettingsShell.tsx`.
- **Component boundary:** Fits `Footer` + `StateBlock` (`03-component-boundaries.md`); adds one shared empty-gating helper instead of per-surface conditionals.
- **Proof test (L2):** Drive empty History, Library, Downloads, Up Next, Notifications, Settings with `--show keys` — assert zero row-scoped keys (`x`, `m`, `q`, `J / K`) when count is 0, and assert bracketed keys appear on Settings and Downloads.
- **Dependencies:** None.

### Rank 6 · Fix Home Focus Handoff ("For you now" Visible `↓` Cue + Enter-on-Empty Behavior)
- **Impact / Effort:** 5 / 2 (**Ratio: 2.5**)
- **Why:** Reviewers explicitly called out *"The home row needs ↓ before Enter, and only the footer says so."* Live capture also showed double horizontal rules and `🦊 empty for now` right above `For you now`.
- **Files touched:** `apps/cli/src/app-shell/browse-shell.tsx` (`:2220-2240, :2528-2601`), `apps/cli/src/app-shell/browse-idle-actions.ts`, `apps/cli/src/app-shell/shell-frame.tsx` (`InputField`).
- **Component boundary:** Fits existing `InputField` + `BrowseIdleReturnLoopModel`; extracts `HomeIdleDeck` component out of `browse-shell.tsx` (shrinks `browse-shell.tsx` by ~110 lines).
- **Proof test (L2):** Drive empty Browse home: verify `For you now  ·  ↓ to pick`, press `<enter>` on empty query → verify focus visibly transfers `▌` onto row 1 (or `<down>` → `<enter>` activates row 1 without silent no-op).
- **Dependencies:** Rank 5 (suppress contradicting `StateBlock(empty)` when idle rows exist).

### Rank 7 · Wire Continue "Ask" (`ContinueSourcePrompt`) & VLC Resume Timestamp Honesty Across All Seams
- **Impact / Effort:** 5 / 2.5 (**Ratio: 2.0**)
- **Why:** Reviewers explicitly flagged *"Seams drop choices the user made. Resuming after episode navigation starts at 0:00 on VLC, Continue 'Ask' never asks."* Currently `continueSourcePreference = "ask"` is ignored in `smart-auto-launch.ts` (Browse / Post-play) and buried as plain footer text in History (`root-overlay-shell.tsx:2533`).
- **Files touched:** **NEW** `apps/cli/src/app-shell/primitives/ContinueSourcePrompt.tsx`, `apps/cli/src/app-shell/title-control/smart-auto-launch.ts`, `apps/cli/src/app/playback/playback-episode-bootstrap.ts`, `apps/cli/src/app-shell/root-overlay-shell.tsx`, `apps/cli/src/app-shell/history-selection-launch.ts`, `apps/cli/src/infra/player/vlc/vlc-player-service.ts` (surface seek capability flag to shell view model — UI reads capability, never guesses).
- **Component boundary:** **Needs 1 new shared primitive** (`ContinueSourcePrompt`, reusable inside "Where to start?", History, and Post-play) so all three entry points honor `Ask` identically.
- **Proof test (L2 + L3):** Seed history + completed offline download + `continueSourcePreference: "ask"`; drive Browse `Enter`, History `Enter`, and Post-play `Enter` → assert `[l] offline file` and `[s] stream` prompt renders and launches the chosen source (verified in backend journal). For VLC, verify `--start-time` or explicit `(starts at 0:00 on VLC)` row copy.
- **Dependencies:** Rank 4 (`resolveEscStack` so `Esc` disarms `ContinueSourcePrompt`).

### Rank 8 · Mid-Stream Provider-Failover Banner (`FailoverBanner`) & Stop Silent Dump to `Tracks` on Failure
- **Status:** done
- **Impact / Effort:** 5 / 2.5 (**Ratio: 2.0**)
- **Why:** Live L2 capture proved that total startup failure dumps the user straight into `Tracks` showing `● ready` with 5 `× Retry` rows and zero explanation; mid-stream failover shows raw `sourceId` strings (`playback-recovery.ts:413`) without showing preserved timestamp or from→to clarity; `loading-shell.tsx` also renders `Now Playing` + `● ready` while still resolving and shows an out-of-sync stage rail (`◓ Providers` under `Launching player`).
- **Files touched:** **NEW** `apps/cli/src/app-shell/primitives/FailoverBanner.tsx`, `apps/cli/src/app-shell/loading-shell.tsx`, `apps/cli/src/app-shell/loading-shell-runtime.ts`, `apps/cli/src/app-shell/playback-recovery-view-model.ts`, `apps/cli/src/app/playback/playback-recovery.ts` (structured failover state), `apps/cli/src/app/playback/playback-episode-iteration.ts`.
- **Component boundary:** **Needs 1 new shared primitive** (`FailoverBanner`) + refactors `PlaybackRecoveryView` to consume structured `failureClass` instead of English substring matching (`playback-recovery-view-model.ts:20-40`); shrinks `loading-shell.tsx` by ~110 lines.
- **Proof test (L2):** Drive `--mpv fake --fake-mpv-mode fail-pre-loaded` → assert `Playback issue` + `● issue` + `not marked watched` + `[r] recover` (NOT `Tracks` with `● ready`). Unit + L2 test for mid-stream failover event asserting `Switching` + preserved timestamp `14:22` + `warn` tone.
- **Dependencies:** None.

### Rank 9 · Eliminate Screen-Reader Redraw Chatter (`PlainQuietPolicy`) & Fix Plain-Mode Leaks
- **Impact / Effort:** 4.5 / 2 (**Ratio: 2.25**)
- **Why:** Reviewers flagged *"Screen-reader redraw chatter."* Live `--plain` captures and code audit found: 1s `useElapsed` / polling timers firing repaints in `loading-shell.tsx`, `onRedraw()` (`clearShellScreen`) called on every keypress in `use-history-overlay-input.ts` and `SettingsShell.tsx`, 92-char `────` rule in Browse plain mode, `⏸` emoji in Post-play plain mode, `Breaking Bad` placeholder indistinguishable from typed text, and `DownloadConfirmationContent` completely ignoring `plainModeEnabled()`.
- **Files touched:** `apps/cli/src/app-shell/plain-mode.ts` (**NEW** `shouldSuppressRedraw()`, `plainPlaceholder()`), `apps/cli/src/app-shell/loading-shell.tsx`, `apps/cli/src/app-shell/use-history-overlay-input.ts`, `apps/cli/src/app-shell/settings/SettingsShell.tsx`, `apps/cli/src/app-shell/browse-shell.tsx`, `apps/cli/src/app-shell/post-play-shell.tsx`, `apps/cli/src/app-shell/download-confirmation-shell.tsx`, `apps/cli/src/app-shell/shell-frame.tsx`.
- **Component boundary:** Fits `plain-mode.ts` shared policy; enforces via a new unit test (`plain-mode-quietness.test.tsx`, parallel to `motion-policy-coverage.test.tsx`).
- **Proof test (L2):** Drive Home, Search, Now Playing, Post-play, History, Settings with `--set-env KUNAI_PLAIN=1` — assert zero `─`/`╭`/`⏸`/`❀` characters, explicit `(empty, e.g. …)` placeholder, explicit `Focus:` line, and zero frame-count increase over 3s idle wait in Now Playing / Resolving.
- **Dependencies:** Rank 5 (Settings & Downloads on `ShellFooter`).

### Rank 10 · Fix Diagnostics False `· Retry` on Healthy Verdict, Offline Network Lie & `kunai doctor` Ordering
- **Impact / Effort:** 4 / 1.5 (**Ratio: 2.7**)
- **Why:** Live captures showed `/diagnostics` printing `Verdict  Healthy · No issues detected · Retry` and `Subtitles  Unknown · disabled by preference · Retry`, reporting `Network OK` offline, burying "why a title won't start" under 47 lines, and `kunai doctor` burying `[error]` findings below 30 lines of `(none)` metadata.
- **Files touched:** `apps/cli/src/app-shell/diagnostics-panel-lines.ts`, `apps/cli/src/services/diagnostics/diagnostics-insight.ts`, `apps/cli/src/services/update/run-doctor.ts`.
- **Component boundary:** Fits existing diagnostics view-model layer (pure builder changes, zero new shell bloat).
- **Proof test (L2 + L1):** Drive `/diagnostics` on fresh session → assert NO `· Retry` on `Healthy` or `disabled by preference`; run `kunai doctor` with unwritable shadow HOME → assert `[error]` appears in top 10 lines before `Locks`/`Transactions`.
- **Dependencies:** None.

### Rank 11 · Fix Details Sheet Overlay Framing, PreviewRail Threshold (120 cols) & Episode Busy Copy Bug
- **Impact / Effort:** 4 / 2 (**Ratio: 2.0**)
- **Why:** Live capture of `i` on Search showed garbled `  Smoke Movieer`, unframed `S`, search input still sitting above Details, and footer still advertising `[i] details`. Search at 120×32 dumped raw `DetailsSheetUI` (`Title ali… No alternate titl…`) instead of Sakura `PreviewRail` (gated at 140 cols in `layout-policy.ts:96`). `overlay-panel.tsx:197` prints `"Saving settings…"` when `episode-picker` is busy! And `m` on season-fetch failure silently bounces back to Search.
- **Files touched:** `apps/cli/src/app-shell/browse-shell.tsx` (`:2437-2460`), `apps/cli/src/app-shell/layout-policy.ts` (`:96`), `apps/cli/src/app-shell/details-sheet-ui.tsx`, `apps/cli/src/app-shell/overlay-panel.tsx` (`:192-198`), `apps/cli/src/app-shell/pickers/tmdb-season-episode-pickers.ts`.
- **Component boundary:** Fits existing `PreviewRail` + `DetailsSheet` + `OverlayPanel`; removes `DetailsSheetUI` fallback in Browse at 120 cols (shrinks `browse-shell.tsx` by ~40 lines).
- **Proof test (L2):** Drive `smoke <enter> i` at 120×32 and 54×25 → assert header pill `Details`, no `Smoke Movieer`, no `[i] details` in footer, and poster collapsed at 54×25. Drive `smoke <enter> <down> m` with offline/failing catalog → assert visible `× Could not load seasons` error instead of silent bounce.
- **Dependencies:** None.

### Rank 12 · Tracks Panel: Fix Left-Pane Truncation, Pane Focus Cue, Failure Reasons & Narrow Tab Strip
- **Impact / Effort:** 4 / 2 (**Ratio: 2.0**)
- **Why:** Live capture at 120×32 clipped `Provider Smoke Vi…`, `Source SmokeSer…`, `Subtitles Subtitle…`, omitted `[←→] pane` from the footer, and showed `× Killjoy Retry` with zero reason; at 54×25 stacked view showed only **1 option** out of 16! Single-option sections (e.g. `Quality: Auto`) still act like selectable rows.
- **Files touched:** `apps/cli/src/app-shell/tracks-panel-shell.tsx`, `apps/cli/src/app-shell/tracks-panel-layout.ts`, `apps/cli/src/domain/playback/track-capabilities.ts`, `apps/cli/src/app-shell/root-overlay-shell.tsx` (`:2627-2690`).
- **Component boundary:** Fits existing `CapabilityRows` / `TracksPanelShell`; keeps single-option sections as facts per `surfaces/tracks-panel.md`.
- **Proof test (L2):** Drive Now Playing → `o` at 120×32 and 54×25 → assert untruncated `SmokeServer` in left pane, `[←→]` in 120×32 footer, and ≥6 visible rows with section tab strip at 54×25.
- **Dependencies:** Rank 8 (ensure failure doesn't dump into Tracks).

### Rank 13 · Extract `OverlayListChrome` to Shrink `root-overlay-shell.tsx` & Fix Up Next `▌` Column + History PreviewRail
- **Impact / Effort:** 4 / 3 (**Ratio: 1.33**)
- **Why:** `root-overlay-shell.tsx` (2,791L) repeats `ContextStrip` + list + `CommandPalette` + `ShellFooter` + duplicate inner headings across History, Up Next, Notifications, Library, Downloads, Help, and Guide. Live captures also revealed `SM   ▌ Smoke Movie` (focus bar at col 6 instead of col 0 in Up Next), missing `PreviewRail` in History at 120×32, clipped `Tab / ⇧Ta` in Help, and triple-repeated key hints in Guide.
- **Files touched:** **NEW** `apps/cli/src/app-shell/primitives/OverlayListChrome.tsx`, `apps/cli/src/app-shell/root-overlay-shell.tsx`, `apps/cli/src/app-shell/queue-shell.tsx`, `apps/cli/src/app-shell/history-shell.tsx`, `apps/cli/src/app-shell/guide-shell.tsx`.
- **Component boundary:** **Needs 1 new shared primitive** (`OverlayListChrome`) — cuts `root-overlay-shell.tsx` by ~520 lines and guarantees uniform header/context/palette/footer chrome across every overlay.
- **Proof test (L2):** Drive History, Up Next, Help, Guide at 120×32 and 54×25 → assert `▌` at col 0 in Up Next (`^  ▌`), `PreviewRail` visible in History at 120×32, untruncated `Tab / ⇧Tab` in Help, and `[enter] run` in Guide `ShellFooter`.
- **Dependencies:** Ranks 4 & 5 (`ConfirmStrip` + `emptySafeFooterActions`).

### Rank 14 · Offline-First Search Fallback, Offline Calendar Cache & Offline Downloads Guard
- **Impact / Effort:** 4 / 2.5 (**Ratio: 1.6**)
- **Why:** Offline mode currently shows dead online rows (`Trending this week`, online `Continue`, online Calendar error without cached fallback, enabled `/trending` in Palette, retryable failed downloads). Users with downloaded libraries expect Kunai to behave like a true local-first media shelf offline.
- **Files touched:** `apps/cli/src/app/search/SearchPhase.ts`, `apps/cli/src/app-shell/browse-idle-actions.ts`, `apps/cli/src/app-shell/calendar-ui.model.ts`, `apps/cli/src/domain/session/command-registry.ts`, `apps/cli/src/app-shell/download-manager-shell.tsx`, `apps/cli/src/app-shell/post-play-view.ts`.
- **Component boundary:** Fits existing services/view-models (zero new UI primitives).
- **Proof test (L3):** `bun run agent:session -- start --name off1 --command "--offline"` with seeded local download + history → search local title → assert local match + `⬇ offline` + `● offline` header; open `/` → assert `/trending` disabled with offline reason.
- **Dependencies:** Rank 2 (Calendar route), Rank 5 (empty/offline footers).

### Rank 15 · Settings Effect-Timing Tags, Env-Lock Reasons, No-Op Setting Audit & Compact 40-Col Rows
- **Status:** **Done**
- **Impact / Effort:** 3.5 / 2 (**Ratio: 1.75**)
- **Why:** Reviewers flagged *"some settings do nothing"*, live 40×20 capture showed `▌▸Default startup · Series` / `mode  mode` collision, double glyph `▌ ▸`, and missing effect-timing labels (`applies immediately` / `next playback` / `next launch`).
- **Files touched:** `apps/cli/src/app-shell/settings/SettingsOverlay.tsx`, `apps/cli/src/app-shell/settings/components/SettingRow*.tsx`, `apps/cli/src/app-shell/settings/registry/*.ts`.
- **Component boundary:** Fits existing `settings/` registry + row components; add `effectTiming` field to setting definition contract (`settings/types.ts`) and a contract-conformance test ensuring every registered setting has a live reader.
- **Proof test (L2 + L1):** Drive `/settings` at 40×20 and 120×32 → assert zero column wrap collision, single `▌` glyph, visible effect-timing tag on focused row, and inline env-var message when pressing Space on an `(env)` row; `contract-conformance.test.ts` asserts 0 unwired settings.
- **Dependencies:** Rank 5 (`ShellFooter` in Settings).

### Rank 16 · Compact "Where to start?" Action Dialog & Palette Prefix-Over-Fuzzy + Search Fallback
- **Status:** Done.
- **Impact / Effort:** 3.5 / 2 (**Ratio: 1.75**)
- **Why:** "Where to start?" currently uses a full `chooseFromListShell` with a `Filter` text box for 3–4 fixed actions; Command Palette `/sm` matched `/history` above `JUMP TO: Smoke Movie` and dead-ends when a user types `/frieren` expecting search.
- **Files touched:** `apps/cli/src/app-shell/title-control/title-control-menu.ts`, `apps/cli/src/app-shell/ink-shell.tsx` (suppress filter input when `options.length <= 6 && !forceFilter`), `apps/cli/src/app-shell/shell-command-model.ts`, `apps/cli/src/app-shell/shell-command-ui.tsx`.
- **Component boundary:** Fits existing `ActionList` + `CommandPalette`; shrinks `ink-shell.tsx` picker chrome branch.
- **Proof test (L2):** Drive `/` + `sm` with queued `Smoke Movie` → assert `JUMP TO: Smoke Movie` outranks unrelated fuzzy commands; drive `/` + `frieren` → assert `Search catalog for "frieren"` fallback row.
- **Dependencies:** Rank 3 (Palette height), Rank 7 (`ContinueSourcePrompt`).

### Rank 17 · Now Playing Control Deck Polish (`GO` Strip, Framed Poster Slot & VLC Capability Copy)
- **Impact / Effort:** 3 / 1.5 (**Ratio: 2.0**)
- **Why:** Live 120×32 capture of Now Playing showed `● ready` instead of `▸ playing`, a floating `❀` in 7 rows of blank rail space, and no scannable `GO` episode-shortcut strip (`n next · p prev · b skip · e episodes · o tracks`).
- **Files touched:** `apps/cli/src/app-shell/loading-shell.tsx` (`:908-1055`), `apps/cli/src/app-shell/MediaPanel.tsx`, `apps/cli/src/app-shell/ink-shell.tsx` (header status `▸ playing` / `⏸ paused` / `◌ buffering`).
- **Component boundary:** Fits existing `MediaPanel` + `LoadingShell`.
- **Proof test (L2):** Drive `--mpv fake --fake-mpv-mode hold` at 120×32 → assert header `▸ playing`, framed poster tile (no floating `❀`), and `GO` strip rendered.
- **Dependencies:** Rank 8 (Resolving vs Playing header split).

### Rank 18 · Narrow `DownloadConfirmation` Cleanup & Library Partial/Repairable Badges
- **Impact / Effort:** 3 / 1.5 (**Ratio: 2.0**)
- **Why:** `DownloadConfirmationContent` repeats an 8-part concatenated profile string on commit rows that wraps into 6 lines at 54×25; Library shelf doesn't surface `△ 1 repairable` or `4/12 ep` partial counts without drilling into detail.
- **Files touched:** `apps/cli/src/app-shell/download-confirmation-shell.tsx`, `apps/cli/src/app-shell/library-shell.tsx`, `apps/cli/src/app-shell/library-view.ts`.
- **Component boundary:** Fits existing `DownloadConfirmationContent` + `MediaListShell`.
- **Proof test (L2):** Drive download confirmation at 54×25 and `--plain` → assert 1-line compact profile rows and valid plain-mode output; seed 1 repairable job → assert `△` badge on Library row.
- **Dependencies:** Rank 9 (`PlainQuietPolicy`).

---

## Giant-File Shrinkage Summary

Executing Ranks 1–18 moves shared chrome and state logic into small, unit-tested primitives instead of adding more branches to the monoliths:

| Monolith | Today | After Shell v4 | What moves out |
| --- | --- | --- | --- |
| `apps/cli/src/app-shell/browse-shell.tsx` | 2,903 lines | ~2,350 lines (-553) | `HomeIdleDeck`, `calendarFooterActions`, `resolveEscStack`, `DetailsSheetUI` fallback, duplicate feedback/rules |
| `apps/cli/src/app-shell/workflows/shell-workflows.ts` | 2,837 lines | ~2,620 lines (-217) | Inline delete confirm pickers → `ConfirmStrip`, offline guards |
| `apps/cli/src/app-shell/root-overlay-shell.tsx` | 2,791 lines | ~1,980 lines (-811) | `OverlayListChrome`, `ConfirmStrip`, `resolveEscStack`, `ContinueSourcePrompt`, `emptySafeFooterActions` |
| `apps/cli/src/app-shell/ink-shell.tsx` | 2,537 lines | ~2,340 lines (-197) | `resolveEscStack`, compact `ActionList` mode for small pickers, unified header status resolver |
| `apps/cli/src/app-shell/loading-shell.tsx` | 1,061 lines | ~890 lines (-171) | `FailoverBanner`, `PlainQuietPolicy` timer gate, structured recovery routing |

## Recommended Execution Waves

1. **Wave A (Trust & Broken Layouts — Ranks 1, 2, 3, 4):** Fixes every live visual corruption (40-col overwrite, Post-play overflow, Palette 1-row peephole, Calendar `● Searching…` error, Up Next Esc bug) and establishes `ConfirmStrip` + `resolveEscStack`.
2. **Wave B (Seamless Choices & Recovery — Ranks 5, 6, 7, 8):** Eliminates dead empty footers, makes Home focus unmistakable, wires Continue "Ask" + VLC honesty, and builds `FailoverBanner` + structured playback failure recovery.
3. **Wave C (Accessibility, Diagnostics & Daily Polish — Ranks 9, 10, 11, 12, 13):** Silences screen-reader chatter, fixes Diagnostics/Doctor triage, fixes Details/Tracks narrow & wide UX, and extracts `OverlayListChrome` to shrink `root-overlay-shell.tsx`.
4. **Wave D (Offline-First & Final Polish — Ranks 14, 15, 16, 17, 18):** Completes offline-first Search/Calendar/Post-play/Downloads, Settings effect-timing + no-op audit, compact "Where to start?", and Now Playing deck polish.
