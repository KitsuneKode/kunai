---
status: draft
lastReviewed: "2026-11-25T05:50:58Z"
---

# Review: features, consistency and phones (Gemini 4 Neon, 2026-11-25)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

A point-in-time feature and product review by Gemini 4 Neon (Antigravity-2, high thinking), the
second pass after [the performance review](./2026-11-25-review-neon-performance.md), run read-only
against `16f4d210c`. Verified by code reading; nothing was run end to end (the worktree had no
dependencies installed). Evidence for planning, not authority: the tree wins where they disagree.

## Verification (2026-11-25, against `main@879b668f4`)

| Finding                                                                                  | Verdict                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 connecting AniList/TMDB syncs nothing                                                  | **Confirmed.** Delivery needs `enabled` and `trackWatched` (progress) or `syncList` (lists) (`SyncService.checkAutomaticAdmission`); all default to false. Setup's post-connect step sets only `enabled`; Settings' Connect sets none. |
| 22 Discord Presence in setup is a one-way door                                           | **Confirmed**: `prefs.presenceDiscord ? "discord" : current.presenceProvider` in `setup-workflows.ts`.                                                                                                                                 |
| 8 / 4.2 no tap targets in History, pickers, Notifications, Downloads, Calendar, `/guide` | **Stale against open work**: #767 (History and every picker) and #775 (Notifications, Downloads, checklist, `/guide`, Schedule). `LibraryTitleDetail`, `DetailsSheet` and the setup screens remain.                                    |
| Others                                                                                   | Traced by the reviewer; not independently re-checked here. Read with `.docs/agents/audit-findings-bar.md` in mind.                                                                                                                     |

## Report

---

> **Scope:** Features, UX coherence, cross-surface consistency, Anime/TMDB lane parity, Termux/mobile/small-terminal usability, competitive gaps, and first-run experience. Pass 1 topics (cold start, binary/bundle size, runtime speed, distribution, provider health) are excluded.
>
> **Verification legend:**
>
> - **Verified (run):** Confirmed by executing read-only scripts in this checkout (`bun run scripts/verify-doc-paths.ts` PASS, `bun run scripts/verify-doc-coverage.ts` PASS; isolated CLI launch attempted under `env -u XDG_CONFIG_HOME -u XDG_DATA_HOME -u XDG_CACHE_HOME -u XDG_STATE_HOME HOME=$(mktemp -d)` — could not execute because this clean worktree has no `node_modules` installed and no prebuilt host binary).
> - **Verified (code):** Confirmed by tracing call-sites through callees in source files; every finding states the concrete failing input/state, traced path, and disproof checked per .docs/agents/audit-findings-bar.md.
> - **Plan ownership:** Existing `.plans/` owners are explicitly noted so owned work is not misreported as undiscovered.

---

## Ranked Top 15 Findings (`impact × reach ÷ effort`)

|   Rank | Finding                                                                                                                                                                                                                                                                                                                                                                      | Surface                     | Impact                                                                                                                                                                                                      | Reach                                      | Effort   | Verification                           | Plan Owner                                                       |
| -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------- | -------------------------------------- | ---------------------------------------------------------------- |
|  **1** | **AniList & TMDB sync connects successfully and silently syncs nothing** — `enabled`, `trackWatched`, and `syncList` stay `false` across Settings, `/sync`, and Setup (which only flips `enabled`); `"Sync now"` never pushes TMDB; UI displays green `"up to date"`.                                                                                                        | Sync / Setup / Settings     | Critical                                                                                                                                                                                                    | All sync users                             | **S**    | Verified (code)                        | Unowned                                                          |
|  **2** | **First-run onboarding mode & language choices do not take effect on the first session** — `SET_MODE` runs before `maybeRunStartupSetup()`, and `runSetupWizard()` writes raw config instead of calling `applySettingsToRuntime()`. Picking Anime or YouTube drops you into Movies & Series until restart.                                                                   | Onboarding / `--setup`      | High                                                                                                                                                                                                        | Every new user (non-default mode/lang)     | **S**    | Verified (code)                        | Unowned                                                          |
|  **3** | **Android/Termux default `--player auto` blocks nearly all subtitled streams** — selects Android chooser with `serveExternalSubtitles: false`, failing with `external-subtitle-unsupported` and no hint for `--player mpv`/`vlc`; no persisted player setting exists; offline local playback unconditionally throws `local-source-unsupported`.                              | Termux / Mobile / Playback  | Critical                                                                                                                                                                                                    | All Android users                          | **S–M**  | Verified (code)                        | Unowned (VLC PRs in flight)                                      |
|  **4** | **DetailsSheet (`i` / `Ctrl+O`) has broken advertised keys, dead live-data fields, and no scrolling** — footer advertises `+ queue · w follow · e episodes`, but `+` does nothing (`q` is bound), `w` opens Watchlist not Follow, `e` is unhandled, `history`/`availability` are hardcoded `null`, and `lines: []` disables ↑/↓ scrolling.                                   | Details / Browse            | High                                                                                                                                                                                                        | Every browse user opening details          | **S**    | Verified (code)                        | Unowned                                                          |
|  **5** | **`kunai --continue` breaks after finishing any movie/show; Home Continue Watching hides completed episodes with a next episode** — three separate Continue Watching engines disagree; `startupCandidate()` only inspects `anchors[0]`.                                                                                                                                      | Continue Watching / History | High                                                                                                                                                                                                        | Every returning user                       | **S**    | Verified (code)                        | Unowned                                                          |
|  **6** | **Live filter typing in Library and History triggers destructive/navigation hotkeys** — typing `p` protects, `x` arms/deletes files, `2` switches tabs in Library; typing `m`/`w`/`q`/`x` triggers menu/watched/queue/delete in History (cannot search _"One Piece"_, _"Spy x Family"_, _"Demon Slayer"_, _"Dune 2"_).                                                       | Library / History           | High                                                                                                                                                                                                        | Every Library & History user               | **S**    | Verified (code)                        | Partially in `.plans/022-shell-interaction-coherence.md`         |
|  **7** | **Hard `<60 cols                                                                                                                                                                                                                                                                                                                                                             |                             | <20 rows` full-screen ResizeBlocker locks out portrait Termux phones** — typical portrait phones (40–55 cols) hit a dead wall that drops all input; even at 60–79 cols, Calendar tabs disappear completely. | Termux / Small Terminals                   | Critical | All portrait mobile / split-pane users | **M**                                                            | Verified (code) | Unowned |
|  **8** | **Touch/mouse (`MouseTarget`) support traps touch users in half the app** — `LibraryTitleDetail`, `HistoryShell`, `DownloadManager`, `Calendar`, `DetailsSheet`, `GuideShell`, `NotificationsShell`, `AnalyticsScreen`, and every modal `OverlayPanel` picker have zero tap targets; tapping a title in Library enters a detail screen with no way back by touch.            | Termux / Mouse / Touch      | High                                                                                                                                                                                                        | All touch & mouse users                    | **M**    | Verified (code)                        | Unowned                                                          |
|  **9** | **In-player keybindings directly contradict `?` help and mpv defaults; left-clicking the Resume card cancels resume** — `s`/`S`, `a`/`d`, `v`/`V`, `c`/`C` mean opposite things in the mpv window vs terminal help; clicking the "Resume at mm:ss" OSD card dismisses it and starts at `0:00`.                                                                               | Playback / mpv Bridge       | High                                                                                                                                                                                                        | Every desktop mpv user                     | **S**    | Verified (code)                        | Partially in `.plans/2026-10-02-share-moment-discoverability.md` |
| **10** | **Browse `/` palette omits ~20 global/reverse commands including `/unfollow`, `/mute`, `/share`, `/watch`, `/sync`, `/playlist-add`** — `/follow` is on Browse but `/unfollow` and `/mute` are missing (one-way door); `"share-qr"` and `"favorites"` are missing from `PALETTE_WORKFLOW_ACTIONS`.                                                                           | Command Palette / Browse    | High                                                                                                                                                                                                        | Every Browse user                          | **S**    | Verified (code)                        | `/queue-season` in `.plans/057`                                  |
| **11** | **Anime mode loses personalized Discover AND excludes Anime Movies from Discover** — `discover-sections.ts` skips `"Because you watched"` and `"From your watch pattern"` in anime mode; `discover-results.ts` filters anime discovery to `item.type === "series"`, dropping anime films.                                                                                    | Both Lanes / Discover       | Medium–High                                                                                                                                                                                                 | All anime users                            | **S**    | Verified (code)                        | Unowned                                                          |
| **12** | **Offline Runway opt-in & per-title cleanup are unreachable dead UI** — `LibraryShell` advertises `runway: title opt-in` and `offline-library-action-router.ts` implements `toggle-continuation` + `edit-cleanup`, but `LibraryTitleDetail` never renders either row (and `openCompletedDownloadsPicker` has zero callers).                                                  | Library / Downloads         | Medium–High                                                                                                                                                                                                 | All offline users                          | **S**    | Verified (code)                        | Unowned                                                          |
| **13** | **Post-play advertises 4 commands that silently no-op** — `/anime-calendar`, `/series-calendar`, `/play-local`, and `/watch-online` appear in the Post-Play palette and silently fail/no-op when invoked.                                                                                                                                                                    | Post-Play / Consistency     | Medium                                                                                                                                                                                                      | Post-play palette users                    | **S**    | Verified (code)                        | Unowned                                                          |
| **14** | **Timestamped share links (`?t=...`) pasted into `/watch` from Browse drop `startSeconds`** — `SearchPhase.ts:1380-1386` forgets `primeShareBootstrapStartSeconds(routedAction.startSeconds)`, unlike `--history` (`SearchPhase.ts:425`) and Playback (`SessionController.ts:229`).                                                                                          | Share Links / Consistency   | Medium                                                                                                                                                                                                      | Share-link recipients                      | **S**    | Verified (code)                        | Unowned                                                          |
| **15** | **`kunai doctor` fails with a false error on Termux & Discord Presence toggle in `/setup` is a one-way door** — `doctor` probes `requireMpv: true` on Android and exits 1; unchecking Discord Presence in `/setup` keeps `"discord"` persisted; `README.md` / `providers.mdx` / `feature-tour.mdx` / `privacy.ts` advertise stale hotkeys (`r` for recover, `m` for memory). | Doctor / Setup / Docs       | Medium                                                                                                                                                                                                      | Termux users, setup rerunners, new readers | **S**    | Verified (code)                        | Provider docs in `.plans/2026-11-24-road-to-9-5.md` W1           |

---

## 1. Feature-by-Feature Audit (Question 1)

### 1.1 Search, Browse & Filters

**What works well:**

- Structured inline query parser (SearchIntentParser.ts:48-173) cleanly parses `mode:`, `type:`, `genre:`, `rating:`, `year:YYYY..YYYY`, `provider:`, `watched:`, `downloaded:`, `release:`, `sort:`, with helpful auto-correction (`type:anime` → `mode:anime`) and filter badges.
- Context-aware empty-state diagnostics (SearchPhase.ts:1572-1585) explain _why_ results are empty (provider failure vs TMDB fallback vs incompatible catalog filter).
- Idle home screen surfaces Continue Watching, Offline Ready, Up Next, and Airing Today nudges, plus instant `Tab` lane switching across Movies & Series / Anime / YouTube.

**What is confusing, half-finished, or missing:**

1. **Discover filters exclude Anime Movies (`type: "movie"`).**
   - **Evidence:** discover-results.ts:151-163. In `shouldIncludeItem`, both `discoverMode === "anime-only"` and `discoverMode === "follow-mode"` (when `mode === "anime"`) check `item.type === "series"`. Yet Kunai's catalog model explicitly represents anime movies as `kind: "anime", type: "movie"` (.docs/feature-map.md:163). _Disproof checked:_ Checked whether AniList discovery normalizes movies to `"series"` — `discover-results.ts` receives `SearchResult` items where anime films carry `type: "movie"`.
   - **User impact:** Anime movies (_Spirited Away_, _Your Name_, _Suzume_) are silently dropped from `/discover`, `/random`, and `/surprise` in anime mode.
   - **Effort:** S · **Verification:** Verified (code).
   - **Fix direction:** Check `item.mediaKind === "anime"` (or allow `type === "movie"` for anime-catalog items) instead of `item.type === "series"`.

2. **Personalized Discover sections are disabled in Anime mode, and `topGenres` is dead code.**
   - **Evidence:** discover-sections.ts:44, 67-93. Line 44 declares `const topGenres: number[] = [];` and never populates it (lines 88–91 `getGenreAffinity` are unreachable). Line 67 restricts `"Because you watched …"` to `hasTmdbLikeRecentId` (explicitly excluding anime). Line 84 restricts `"From your watch pattern"` to `mode !== "anime"`, even though lines 52–58 compute `completedHistorySeeds` for anime.
   - **User impact:** Anime `/discover` only ever renders a single generic `"Anime trending this week"` rail, with zero personalization.
   - **Effort:** M · **Verification:** Verified (code).
   - **Fix direction:** Wire AniList `recommendations` / `genres` edges into `RecommendationService` for anime seeds, and remove or populate `topGenres`.

3. **No multi-facet interactive filter drawer or toggle-off chip UX.**
   - **Evidence:** SearchPhase.ts:1150-1180, 1535-1564. `/filters` (`chooseSearchFilterChip`) inserts only a single token chip per modal invocation and requires reopening `/filters` for each additional facet; reselecting a chip does not remove it (`appendSearchFilterChip` returns `trimmed` unchanged).
   - **User impact:** Filtering by genre + year + min rating requires 3 separate modal trips or memorizing DSL syntax.
   - **Effort:** M · **Verification:** Verified (code).
   - **Fix direction:** Support multi-select toggle chips inside `/filters` (Space to toggle, Enter to apply) and toggle-off on reselect.

---

### 1.2 Details (`DetailsSheet` — `i` / `Ctrl+O` / `Shift+Enter`)

**What works well:**

- Clean modal presentation with synopsis, metadata chips, external links, and expandable seasons/episodes view (details-sheet.model.ts, details-sheet-ui.tsx).

**What is broken or half-finished:**

4. **`DetailsSheet` advertises 3 broken/mismapped hotkeys, hardcodes live progress/availability to `null`, and disables scrolling.**
   - **Evidence:**
     - Footer copy (details-sheet-ui.tsx:161-176): `+ queue · w follow · d download · e episodes · t trailer · l links`.
     - Actual key handler (browse-shell.tsx:1538-1593):
       - `+` is **unbound**; line 1564 binds `q` for queue.
       - `w` (lines 1556–1563) calls `onWatchlistSelected` (**Watchlist**), NOT Follow; Follow is absent.
       - `e` (episodes) is **not handled anywhere** — silent no-op.
       - `l` (lines 1551–1554) blindly opens `links.items[0].url` with no chooser when multiple external links (TMDB, IMDb, AniList, MAL) are displayed.
       - `lines: []` (browse-shell.tsx:934, 1584) makes `maxScroll = 0`, so ↑/↓ never scroll expanded season lists.
     - Live data (browse-shell.tsx:935, 959-960): The sole production caller of `buildDetailsSheet` passes `history: null, availability: null`, making the "Your progress" and "Where: providers · ⬇ offline · Subs" sections in details-sheet-ui.tsx:78-80, 119-125 dead code at runtime.
     - _Disproof checked:_ Grepped all callers of `buildDetailsSheet` and `DetailsSheet`; `browse-shell.tsx` is the only runtime mount.
   - **User impact:** Almost half of the action bar in the primary title-inspection modal either does nothing or runs the wrong command; users cannot see whether a title is already watched/downloaded or scroll long synopses/season lists.
   - **Effort:** S · **Verification:** Verified (code).
   - **Fix direction:** Align footer bindings with `browse-shell.tsx` (`+`/`q` queue, `w` watchlist + `f` follow or relabel `w`, wire `e` to episode picker, link chooser on `l`), pass real `history`/`availability` from browse context, and compute rendered line count for scroll.

---

### 1.3 Playback & In-Player Controls

**What works well:**

- Rich mpv Lua bridge (kunai-bridge.lua) with in-video skip-segment banner (IntroDB + AniSkip), resume banner, Up Next countdown, quality/source switch hooks, and live progress reporting.
- Pre-play confirmation (`prePlayConfirm` in PlaybackPhase.ts:2512-2525) and unified Tracks panel (`o`) for source/quality/audio/subtitle switching.

**What is confusing, broken, or missing:**

5. **In-player keybindings directly contradict `?` help and override mpv built-ins.**
   - **Evidence:** keybindings.ts:14-18, 441-540 claims `"the in-player ('player' scope) chords mirror the mpv Lua bridge exactly"`, yet kunai-bridge.lua:1104-1148 binds:
     - `s` / `S` in mpv → **Choose source** (clobbering mpv's built-in `s` screenshot); in terminal / `?` help → `s` = **Reload subtitles**, `⇧S` = **Return to search** (`o` = Choose source).
     - `a` / `d` in mpv → **Cycle audio / Sub-Dub** (restarts stream on single-track streams); in terminal / `?` help → `a` = **Toggle autoplay**, `d` = **Open diagnostics**.
     - `v` / `V` in mpv → **Quality picker** (clobbering mpv's built-in `v` toggle subtitles).
     - `c` / `C` (cycle source) and `Ctrl+Shift+S` (share timestamp; tracked in `.plans/2026-10-02-share-moment-discoverability.md`) are bound in Lua and omitted from `keybindings.ts`.
   - **User impact:** Pressing `s` to take an mpv screenshot or reload subtitles hijacks playback into a source picker; pressing `v` to hide subtitles opens quality switching; pressing `a` in mpv expecting autoplay toggle switches audio/restarts the stream.
   - **Effort:** S · **Verification:** Verified (code).
   - **Fix direction:** Test/enforce parity between `kunai-bridge.lua` bindings and `keybindings.ts`, and move Kunai mpv overrides off native mpv keys (`s`, `v`) onto shifted/Ctrl chords or matching terminal keys (`o`, `k`).

6. **Left-clicking the in-player "Resume at mm:ss" OSD card dismisses it and restarts from `0:00`.**
   - **Evidence:** kunai-bridge.lua:533-538. While the resume prompt is active, `MBTN_LEFT` is bound to `resume_prompt_dismiss` → `choice = "start"`, whereas `MBTN_MID` (middle-click) and `ENTER` accept resume.
   - **User impact:** Any mouse user clicking the visible "Resume at 14:22" prompt immediately loses their resume prompt and starts at `0:00`.
   - **Effort:** S · **Verification:** Verified (code).
   - **Fix direction:** Check cursor hit-box on `MBTN_LEFT` (resume if clicking the card, dismiss on right-click or `Esc`), or swap left-click = resume / right-click = start from beginning.

7. **Missing quality pre-selection before playback starts (unless `prePlayConfirm` is on) and Wyzie subtitle search requires manual API key.**
   - **Evidence:** `prePlayConfirm` defaults to `false` (defaults.ts); resolution picker before play is a follow-up in `.plans/2026-11-24-road-to-9-5.md`. Wyzie subtitle search requires the user to manually obtain and paste a personal Wyzie key (language.ts:193-208).
   - **User impact:** Users on metered/slow links cannot pick 720p/480p before buffering starts without knowing to enable `prePlayConfirm`; users without a Wyzie key have no subtitle fallback search.
   - **Effort:** M · **Verification:** Verified (code).
   - **Fix direction:** Tracked in `.plans/2026-11-24-road-to-9-5.md` follow-ups; also expose a quick `--quality` launch flag and surface Wyzie setup when subtitle search returns empty.

---

### 1.4 Post-Play

**What works well:**

- Thoughtful distinction between natural end, mid-episode stop, and failed-to-start recovery (run-post-playback-menu.ts), with next-episode / next-season prompt, Watchlist/Playlist/Download actions, and compact recommendation rail.

**What is broken or missing:**

8. **Four commands advertised in the Post-Play `/` palette silently no-op.**
   - **Evidence:**
     - command-registry.ts:231-240 advertises `anime-calendar`, `series-calendar`, `play-local`, and `watch-online` in `COMMAND_CONTEXTS.postPlayback`.
     - For `anime-calendar` and `series-calendar`: command-router.ts:80-106 passes them through via `playbackPassthrough`, but post-playback-routing.ts:52-54 only matches `"calendar"` and `"random"`, so run-post-playback-menu.ts:1023 logs `"Unhandled post-play shell action"` and leaves the user on Post-Play.
     - For `play-local` and `watch-online`: neither is in `playbackPassthrough`, `PALETTE_WORKFLOW_ACTIONS`, nor `run-post-playback-menu.ts` — they are only handled in `active-playback-command-dispatcher.ts` — so on Post-Play they silently return `"unhandled"`.
   - **User impact:** Selecting visible commands from the Post-Play palette does nothing with zero feedback.
   - **Effort:** S · **Verification:** Verified (code).
   - **Fix direction:** Handle `anime-calendar`/`series-calendar` in `resolvePostPlaybackExitOutcome`, and either handle `play-local`/`watch-online` in `run-post-playback-menu.ts` or restrict them to `COMMAND_CONTEXTS.activePlayback`.

---

### 1.5 History & Continue Watching

**What works well:**

- SQLite-backed progress store with Continue Watching (`watching`) vs All History (`all`) tabs, episode-level resume, dual-source local/online launch (`l`/`s`), and Watch-time stats.

**What is broken or confusing:**

9. **Three conflicting Continue Watching implementations break `kunai --continue` and hide series ready for the next episode.**
   - **Evidence:**
     - **Path A (`kunai --continue`):** main.ts:261-282 → ContinueWatchingService.ts:68-76 → `recentDecisions({ limit: 1 })`. continuation-engine.ts:77-151 slices `anchors.slice(0, 1)` _before_ checking `primaryAction`. If the most recently updated history entry is a completed movie (or caught-up series), `anchors[0]` has no `primaryAction` and `kunai --continue` fails with `"No unfinished or ready continuation target yet"` even when unfinished shows sit right behind it at `anchors[1]`.
     - **Path B (Home idle Continue Watching card):** browse-idle-context.ts:52-54 bypasses `ContinueWatchingService` completely and only filters `!entry.completed && entry.positionSeconds > ENGAGE_SECONDS`. Finishing episode 4 of a 12-episode show hides the show from the Home Continue Watching slot instead of offering Episode 5.
     - **Path C (`/history` overlay):** uses `ContinueWatchingService.recentDecisions()` (which _does_ offer Episode 5), so the three surfaces disagree on what is "Continue Watching".
   - **User impact:** Watching a movie breaks `kunai --continue` for every ongoing show you were watching; finishing an episode cleanly makes your show vanish from the Home screen.
   - **Effort:** S · **Verification:** Verified (code).
   - **Fix direction:** Make `startupCandidate()` scan beyond `anchors[0]` for the first entry with an actionable `primaryAction`, and drive Home idle Continue Watching from the same `ContinueWatchingService` candidate.

10. **Live filter typing in History intercepts single-letter action hotkeys (`m`, `w`, `q`, `x`, `X`, `l`, `s`).**
    - **Evidence:** use-history-overlay-input.ts:74-77, 322, 392, 411-430. History accepts printable characters directly to filter the list, _after_ checking action keys `m` (menu), `w` (toggle watched), `q` (queue), `x`/`X` (delete), and `l`/`s` (local/online). Typing _"demon"_ opens the Title Control Menu on `m`; typing _"witcher"_ toggles watched on `w`; typing _"spy x"_ triggers delete confirmation on `x`. _(Partially tracked under `.plans/022-shell-interaction-coherence.md`.)_
    - **User impact:** Searching watch history by title accidentally mutates watch state or prompts deletion.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** Require `/` or `Ctrl+F` to enter filter mode (or move row actions to `Ctrl+` chords / explicit focus mode while filtering).

---

### 1.6 Queue / Up Next, Watchlist & Playlists

**What works well:**

- Clear ADR-0001 separation between ephemeral **Up Next** (`/up-next`), built-in **Watchlist** (`/watchlist`), and named **Playlists** (`/playlists`), with durable session queue recovery on restart and queue reorder (`K`/`J`) + remove (`x`) + clear (`c`) in queue-shell.tsx.

**What is confusing or missing:**

- **Playlist management is bare-bones:** Watchlist and Playlists use generic modal list pickers (`OverlayPanel`) rather than dedicated shelves with posters/progress/bulk-queue-to-Up-Next.
- **`/queue-season` is unavailable from Browse series rows** (tracked in `.plans/057-browse-queue-season.md`) and `/playlist-add` is missing from `SEARCH_BROWSE_COMMAND_IDS` (search-browse-command-ids.ts:3-40).
- **Keybinding label drift:** keybindings.ts:1032-1039 labels Library `Tab` as `"Switch Library / Up Next"` (`"Tab → Up Next"`), whereas library-shell.tsx:111 switches to **Downloads** — violating ADR-0001 vocabulary.
  - **Effort:** S · **Verification:** Verified (code).
  - **Fix direction:** Update `keybindings.ts:1032-1039` to `"Switch Library / Downloads"` and expose `/playlist-add` on Browse.

---

### 1.7 Library & Downloads / Offline

**What works well:**

- SQLite-backed download queue with concurrency, retry, artifact integrity verification (`ffprobe`), subtitle bundling, and cleanup protection (`p`) + explicit offline mode (`--offline`).

**What is broken or half-finished:**

11. **Offline Runway (`toggle-continuation`) and per-title cleanup (`edit-cleanup`) are completely unreachable in the live UI.**
    - **Evidence:** library-shell.tsx:117 advertises `runway: title opt-in` in the Library header, and offline-library-action-router.ts:159-232 implements both `"toggle-continuation"` and `"edit-cleanup"`. However, the live drill-in screen library-title-detail.tsx:98-133 builds `actionRows` with only 4 items (`search-online`, `download-more`, `check-integrity`, `repair-missing`) — omitting `toggle-continuation`, `edit-cleanup`, and `delete-group` even though line 236 still types `actionType` with `"toggle-continuation"` and `"delete-group"`. _Disproof checked:_ Grepped all callers of the older `openCompletedDownloadsPicker` and `openOfflineLibraryGroupPicker` (shell-workflows.ts:148, 213) — **zero** production callers remain.
    - **User impact:** Offline Runway (auto-downloading next episodes while you watch) is advertised in the header and docs, but cannot be enabled on any title.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** Add `toggle-continuation` and `edit-cleanup` rows back to `actionRows` in `library-title-detail.tsx` (and remove orphaned `openCompletedDownloadsPicker`).

12. **Library live filter capture collides with `p` (protect), `x`/`X` (delete), and `2` (Downloads tab); `LibraryTitleDetail` misplaces its `"Actions"` heading.**
    - **Evidence:**
      - library-shell.tsx:300-332 and root-overlay-shell.tsx:1751-1815: `p`, `x`, `X`, and `2` fire before appending to the filter string. Filtering for _"One Piece"_, _"Spy x Family"_, or _"Dune 2"_ toggles protection, arms deletion, or jumps to Downloads.
      - library-title-detail.tsx:321-323: renders `<SectionGroup label="Actions" />` _after_ mapping all `flatRows` (episodes + actions), so the `"Actions"` header sits orphaned at the bottom of the screen instead of separating episodes from actions.
    - **User impact:** Destructive/unexpected side effects while filtering Library; confusing visual layout in title detail.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** Gate Library filter input behind `/` or `Ctrl+F` (same as History) and render `<SectionGroup label="Actions" />` before the first `kind === "action"` row.

13. **Download Manager `Esc` during delete confirmation closes the entire overlay, and the confirmation banner renders twice.**
    - **Evidence:** download-manager-shell.tsx:335-338 checks `if (key.escape) { onClose(); return; }` before checking `pendingDeleteJobId`, so pressing `Esc` to cancel a delete closes the whole Download Manager. Lines 553-559 and 626-633 both render the delete confirmation prompt simultaneously. _(Esc consistency partially tracked in `.plans/022-shell-interaction-coherence.md`.)_
    - **User impact:** Trying to back out of a delete confirmation kicks the user out of Downloads; duplicate warning copy crowds short terminals.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** Clear `pendingDeleteJobId` on `Esc` first, and remove the duplicate confirmation `<Box>`.

---

### 1.8 Notifications

**What works well:**

- Clean inbox architecture (NotificationEngine.ts, notifications-shell.tsx) unifying new playable episodes, queue recovery, download completion/failure, app updates, provider health, and manifest updates, with Active/Archived tabs, unread markers, queue membership indicator (`≡`), and preview rail.

**What is confusing or missing:**

- **Zero touch/mouse targets:** notifications-shell.tsx:123-131 renders raw `<ListRow>` without any `MouseTarget`, so touch/mouse users cannot select, open, dismiss, or switch tabs.
- **No OS/desktop notification delivery when Kunai is backgrounded or closed:** New-episode checks happen only while Kunai is running; there are no optional desktop (`notify-send`/osascript/toast) notifications for followed airing shows.
- **Per-title mute is hard to reverse:** There is no "Followed & Muted Titles" manager screen; once muted, a title is suppressed from `deriveNotifications` (NotificationEngine.ts:119) and must be searched again to unmute — and `/unfollow` / `/mute` aren't in Browse's `/` palette.
- **Effort:** S (mouse + unmute list) / M (OS notifications) · **Verification:** Verified (code).
- **Fix direction:** Wrap notification rows/tabs in `MouseTarget`, add a Followed/Muted management view, and expose `/unfollow`/`/mute` on Browse.

---

### 1.9 Calendar / Schedule

**What works well:**

- Dedicated schedule screen (calendar-ui.tsx, calendar-ui.model.ts) with All / Anime / Series / Tracked tabs, 7-day strip, local-date bucketing, and direct play-next launch for already-aired tracked episodes (SearchPhase.ts:1396-1405).

**What is broken or inconsistent:**

14. **Home "Airing today" nudge uses UTC date instead of local date and counts muted titles.**
    - **Evidence:** browse-idle-context.ts:99-110 computes `todayKey = new Date(nowMs).toISOString().slice(0, 10)` (UTC), directly violating the local-date invariant documented in calendar-ui.model.ts:103-116. It also counts all history titles without excluding muted titles, even though clicking the nudge opens the Tracked calendar view.
    - **User impact:** Users outside UTC see `"2 episodes airing today"` on Home, click it, and land on an empty `"Today"` tab in Calendar.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** Reuse `calendar-ui.model.ts`'s local date key helper in `browse-idle-context.ts` and filter out muted titles.

15. **Calendar tabs vanish completely at 60–79 columns, and Calendar has zero mouse/touch support.**
    - **Evidence:** calendar-ui.tsx:103 returns `null` from `CalendarTypeTabs` whenever `compact` is true (`columns < 80`), hiding All / Anime / Series / Tracked with no alternative switcher indicator. No `MouseTarget` exists on tabs, day strip, or calendar rows.
    - **User impact:** On compact terminals and phones, users cannot see which calendar filter is active or tap between days/tabs.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** Render a compact single-line active-tab pill when `compact` is true, and wrap tabs/day-strip/rows in `MouseTarget`.

---

### 1.10 Settings (`/settings`)

**What works well:**

- Well-organized tabbed settings UI (SettingsShell.tsx) with live theme swap, provider drag-reorder, per-lane audio/subtitle/quality profiles, bring-your-own TMDB/Wyzie API keys, explicit analytics consent + install-id rotation, and "Undo the last setup run".

**What is broken, stale, or missing:**

16. **Settings has no Player choice setting, omits `youtubeLanguageProfile` live dispatch, has stale Memory-panel help text, and "Undo last setup run" does not refresh live runtime state.**
    - **Evidence:**
      - **No Player setting:** `player` (`auto` / `mpv` / `vlc` / `chooser`) exists only as CLI flag `--player` (cli-args.ts), not in `KitsuneConfig` (defaults.ts) or settings/registry/playback.ts. Android users (and future VLC users) must pass `--player mpv` on every launch.
      - **`youtubeLanguageProfile` not dispatched to SessionState:** apply-settings-to-runtime.ts:67-81 dispatches `UPDATE_LANGUAGE_PROFILE` for `anime`, `series`, and `movie` — omitting `youtube`.
      - **Stale Memory panel hint:** settings/registry/privacy.ts:112 tells users `"Press m during playback for app, mpv, total, heap, and swap usage"`, contradicting keybindings.ts:488-505 and docs/users/commands-and-shortcuts.mdx:115-116 where `m` opens the Title Control Menu and Memory is `/memory`.
      - **"Undo the last setup run" bypasses runtime sync:** settings/registry/storage.ts:38-47 calls `config.update(snapshot); config.save();` instead of `applySettingsToRuntime()`, so restored theme, provider priority, mode, and language profiles do not take effect until restart.
    - **User impact:** Android users can't persist their player; undoing setup appears to fail visually; Settings misleads users about `m`.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** Persist `player` in config + Playback settings, route `restorePreSetupConfig` through `applySettingsToRuntime`, update `privacy.ts:112` copy to `/memory`, and sync `youtubeLanguageProfile`.

---

### 1.11 Sync (AniList & TMDB)

**What works well:**

- Thoughtful OAuth / TMDB request-token connect flow (tracker-connect.ts) with local credential storage, offline queue retry, and fail-closed semantics.

**What is critically broken:**

17. **Connecting AniList or TMDB sync silently syncs nothing across all 3 entry points, and `"Sync now"` never pushes TMDB.**
    - **Evidence:**
      - defaults.ts:170-174 defaults both `sync.anilist` and `sync.tmdb` to `{ enabled: false, trackWatched: false, syncList: false }`.
      - SyncService.ts:178-186, 369-380, 504-514: `checkAutomaticAdmission` returns `"disabled"` unless BOTH `enabled === true` AND `trackWatched === true` (or `syncList === true`).
      - **Entry 1 (Setup wizard):** setup-workflows.ts:301-309 sets `enabled: true` only — leaving `trackWatched: false, syncList: false`. Worse, line 304 spreads stale `...current.sync` from before `applySetupPreferences`, overwriting a simultaneous uncheck of the other tracker.
      - **Entry 2 (Settings → Accounts & Sync):** settings/registry/sync.ts:98-108, 173 connects credentials and flips **none** of `enabled`, `trackWatched`, or `syncList`, while displaying `"connected as @user"` and a green `"up to date"` badge.
      - **Entry 3 (`/sync` / `/sync-connect-*`):** shell-workflows.ts:3520-3585 likewise flips **none** of the three flags.
      - **Manual `"Sync now"` omits TMDB:** SyncService.ts:369-380 (`syncNow`) only builds episode-progress updates (`buildProgressUpdates`), skipping TMDB because TmdbAdapter.ts:32 declares `episodeProgress: false`. Meanwhile SetupScreens.tsx:402 tells users `"TMDB — Track shows and films"`.
      - _Disproof checked:_ Traced `connectTracker` in `tracker-connect.ts` to confirm it only writes tokens to the auth/vault store and never mutates `config.sync.*`.
    - **User impact:** Every user who connects AniList or TMDB believes sync is working (`"connected"` + `"up to date"`) while literally zero watch progress or watchlist updates ever sync unless they hunt down hidden sub-toggles in Settings.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** On successful connect in all 3 entry points, enable `{ enabled: true, trackWatched: adapter.capabilities.episodeProgress, syncList: true }` (reading fresh config in `setup-workflows.ts`), update `SetupScreens.tsx:402` to `"TMDB — Sync watchlist & favourites"`, and make `syncNow()` flush pending list/watchlist ops for TMDB.

---

### 1.12 Share Links (`/share`, `/share --qr`, `/watch`, `kunai --open`)

**What works well:**

- Compact, privacy-preserving catalog-anchored URLs (`https://kunai.kitsunekode.in/w/k1...` + `kunai://`) carrying catalog ID, season/episode, and optional timestamp (`t=...`), without leaking raw stream URLs (playback-target-ref.ts, resolve-share-target.ts).

**What is broken or half-finished:**

18. **`/watch` from Browse silently drops `startSeconds` AND fails to switch catalog mode for non-anime targets.**
    - **Evidence:**
      - SearchPhase.ts:1380-1386: When `routeSearchShellAction` returns `{ type: "history-entry", title, episode, startSeconds }` (the return shape of `handleWatch` at shell-workflows.ts:2418-2423), `SearchPhase.ts:1380-1386` dispatches `SELECT_TITLE` and `SELECT_EPISODE` **without** calling `primeShareBootstrapStartSeconds(routedAction.startSeconds)` — even though `--history` startup at SearchPhase.ts:425 and playback at SessionController.ts:229 DO call it.
      - shell-workflows.ts:2405-2423: `handleWatch` only switches mode when `resolved.kind === "search"` and `resolved.mode === "anime"`, ignoring `series`/`youtube` search links and never switching `stateManager` mode on catalog-resolved links when currently in the opposite lane.
    - **User impact:** Opening a timestamped share link via `/watch` while on Browse starts at `0:00` instead of the shared moment, and opening a movie link while in Anime mode can resolve against the wrong lane.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** Call `primeShareBootstrapStartSeconds(routedAction.startSeconds)` at `SearchPhase.ts:1380`, and dispatch `SET_MODE` for all lanes in `handleWatch`.

19. **Protocol handler is Linux-only, `/w/[code]` CTA fails on macOS/Windows/Android, and `share-links.mdx` promises unsupported History share + `imdb:` anchors.**
    - **Evidence:** protocol-handler.ts:63-74 supports only Linux `.desktop` registration; [apps/docs/app/w/[code]/page.tsx:103-106](apps/docs/app/w/[code]/page.tsx:103-106) renders `"Open in Kunai"` (`kunai://`) as primary CTA (owned by `.plans/065-share-page-open-fallback.md`). docs/users/share-links.mdx:38 claims History exposes Share link, but `SURFACE_ACTION_IDS.history` (title-control-actions.ts:551) omits `"share"`. `share-links.mdx:7, 82` advertises `imdb:` anchors (unimplemented; owned by `.plans/056-imdb-share-anchor.md`).
    - **User impact:** Clicking a shared link on macOS/Windows/Android does nothing; History users looking for Share link can't find it.
    - **Effort:** S (History share + doc accuracy) / M (macOS/Windows protocol handlers) · **Verification:** Verified (code).
    - **Fix direction:** Add `"share"` to `SURFACE_ACTION_IDS.history`, ship `.plans/065` fallback copy-command on `/w/`, and add macOS/Windows URL-scheme registration or clearly scope the button.

---

### 1.13 Command Palette & `/guide`

**What works well:**

- Single source of truth in command-registry.ts with fuzzy matching, aliases, and contextual filtering; `/guide` (guide-shell.tsx, guide-model.ts) gives a crisp interactive tour of core concepts.

**What is broken or missing:**

20. **Browse `/` palette hides ~20 global/reverse commands, and `"share-qr"` / `"favorites"` are missing from `PALETTE_WORKFLOW_ACTIONS`.**
    - **Evidence:** search-browse-command-ids.ts:3-40 uses a narrow hand-maintained allowlist for Browse instead of `COMMAND_CONTEXTS.browse`. Missing from Browse `/` palette: `/unfollow`, `/mute` (while `/follow` IS present — one-way door!), `/share`, `/share-qr`, `/watch`, `/playlist-add`, `/queue-season` (`.plans/057`), `/sync`, `/presence`, `/analytics`, `/about`, `/update`, `/docs`, `/export-diagnostics`, `/report-issue`, `/clear-history`, `/mark-watched`, `/mark-unwatched`, `/anime-calendar`, `/series-calendar`, `/favorites`.
    - Additionally, dispatch-palette-command.ts:52-92 (`PALETTE_WORKFLOW_ACTIONS`) omits `"share-qr"` and `"favorites"`, even though `shell-workflows.ts:917` implements `"share-qr"` and `command-registry.ts` registers both.
    - **User impact:** Users on the home/search screen cannot unfollow/mute a title, paste a `/watch` link, open `/docs`, export diagnostics, or open `/sync` from the palette.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** Drive Browse palette membership from `COMMAND_CONTEXTS.browse` (with a tiered "Quick" vs "All commands" filter when typing), and add `"share-qr"` and `"favorites"` to `PALETTE_WORKFLOW_ACTIONS`.

---

### 1.14 Onboarding & `--setup`

**What works well:**

- Friendly, well-paced setup flow with Kanna mascot, dependency check rows (`mpv`, `yt-dlp`, `ffprobe`), optional offline/sync/presence setup, pre-setup config snapshot for undo, and explicit-keystroke analytics consent (AnalyticsScreen.tsx).

**What is broken:**

21. **Onboarding mode & language preferences never apply to the first session (nor mid-session `/setup`).**
    - **Evidence:** main.ts:1041-1065 initializes `stateManager` and dispatches `SET_MODE` with the pre-setup default (`"series"`) _before_ main.ts:1452-1500 calls `maybeRunStartupSetup()`. Inside setup-workflows.ts:247-248, `runSetupWizard()` calls `config.update()` + `config.save()` directly instead of `applySettingsToRuntime()`. _Disproof checked:_ Checked SessionController.ts:102-175 — `SessionController` never re-reads `config.defaultMode` or language profiles after `maybeRunStartupSetup()`.
    - **User impact:** A new user who picks **Anime** (or **YouTube**) and non-default audio/subtitle preferences during first-run setup immediately lands in **Movies & Series** with English defaults until they quit and relaunch.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** Replace raw `config.update`/`save` in `setup-workflows.ts` with `applySettingsToRuntime({ container, next })` so mode, provider, theme, and language profiles apply immediately.

22. **Discord Presence toggle in `/setup` is a one-way door.**
    - **Evidence:** setup-workflows.ts:198: `presenceProvider: prefs.presenceDiscord ? "discord" : current.presenceProvider`. If Discord Presence was previously `"discord"` and the user unchecks it during `kunai --setup` or `/setup`, `current.presenceProvider` (`"discord"`) is written right back.
    - **User impact:** Rerunning `--setup` to disable Discord Rich Presence silently keeps it enabled.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** Change the false branch to `"off"`.

---

### 1.15 `kunai doctor`

**What works well:**

- Checks installation channel, binary path, `mpv`/`yt-dlp`/`ffprobe` discovery, protocol handler status, and provides actionable install commands (run-doctor.ts, native-installer/doctor.ts).

**What is broken or missing:**

23. **`kunai doctor` reports a false fatal `[error] mpv-missing` and exits `1` on healthy Android/Termux installs, and skips config/DB/Android checks.**
    - **Evidence:** native-installer/doctor.ts:419-425, 474-479 calls `probeCapabilities()` with default `requireMpv: true`, whereas runtime bootstrap at main.ts:974 sets `requireMpv: !isAndroidHost()`. Additionally, `doctor` does not validate `config.json` parseability, SQLite DB readability (`kunai-data.sqlite` / `kunai-cache.sqlite`), or Android handoff binaries (`am`, `termux-open-url`).
    - **User impact:** Termux users following README verification (`kunai doctor`) get a red error and exit code 1 telling them to install desktop `mpv`.
    - **Effort:** S · **Verification:** Verified (code).
    - **Fix direction:** Pass `{ requireMpv: !isAndroidHost() }` in `buildDoctorReport`, check `am`/`termux-open-url` on Android, and add non-destructive config JSON + SQLite readability checks.

---

### 1.16 Docs Site (`apps/docs`, `docs/`) & `README.md`

**What works well:**

- Polished interactive home page (home-page-shell.tsx/home-page-shell.tsx)) with live terminal preview, clear narrative ordering, codegen-backed `<CommandReference />` and `<ShortcutTable />`, and zero broken internal doc links (**Verified (run):** `bun run scripts/verify-doc-paths.ts` passed 59 docs / 2574 source files; `bun run scripts/verify-doc-coverage.ts` passed all 5 roots).

**What is stale or contradictory:**

24. **Multiple user-facing docs contradict live keybindings and active providers.**
    - **Evidence:**
      - **Wrong `r` hotkey in 3 places:** README.md:170, docs/users/feature-tour.mdx:110, and docs/users/providers.mdx:330 tell users `r` recovers the current stream during playback. Actual binding in keybindings.ts:525-531 is **`Ctrl+R`** (`r` is Replay on Post-Play, line 563).
      - **Stale provider prose (partially owned by `.plans/2026-11-24-road-to-9-5.md` W1):** docs/users/providers.mdx:21-22, 68, 92, 113-133, 157, 181, 302, docs/users/supported-and-unsupported.mdx:36-41, and docs/users/feature-tour.mdx:66 still list retired `anidb` as active 5th anime provider and stale fallback order prose; `providers.mdx` omits `vidrock` and `movy` from series default-order prose.
      - **`/docs` default points to raw GitHub repo instead of published docs site:** docs/users/commands-and-shortcuts.mdx:125 notes `/docs` opens the GitHub `docs/` tree unless `KUNAI_DOCS_URL` is set, instead of opening `https://kunai.kitsunekode.in/docs`.
    - **User impact:** New users reading `README.md` press `r` when a stream stalls and nothing happens; `/docs` dumps users into raw GitHub MDX source instead of the rendered docs site.
    - **Effort:** S · **Verification:** Verified (code) + Verified (run) for `verify-doc-paths` / `verify-doc-coverage`.
    - **Fix direction:** Fix `r` → `Ctrl+R` in `README.md`, `feature-tour.mdx`, `providers.mdx`; point default `/docs` URL to `https://kunai.kitsunekode.in/docs`; complete W1 doc generation for provider tables.

---

## 2. Consistency Across Entry Points (Question 2)

| Action                                                     | Browse                                                                                   | Command Palette (`/`)                                                         | Hotkey                                                  | Post-Play / Overlays                                                           | Divergence & Evidence                                                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Follow / Unfollow / Mute**                               | `/follow` only; Details `w` says `"follow"`                                              | Browse omits `/unfollow` & `/mute`; Playback/Post-Play include all 3          | Details `w` opens **Watchlist**, not Follow             | History/Playback menu exposes follow/mute                                      | One-way door on Browse (search-browse-command-ids.ts:3-40); wrong action on Details `w` (browse-shell.tsx:1556-1563).                                    |
| **Queue / Add to Up Next**                                 | Details footer says `+ queue`                                                            | `/playlist-add` omitted from Browse palette                                   | Details binds `q` (`+` is a no-op); History binds `q`   | Post-Play / Title Menu work                                                    | Broken advertised `+` key (details-sheet-ui.tsx:161-176 vs browse-shell.tsx:1564).                                                                       |
| **Open `/history`**                                        | Opens on **`all`** tab                                                                   | From Browse/Playback → **`all`** tab; from Root Overlays → **`watching`** tab | `H` / `Ctrl+H`                                          | Root overlays open `watching`                                                  | Same command lands on different default tabs (dispatch-palette-command.ts:126-128 vs root-overlay-shell.tsx:967-968).                                    |
| **Continue Watching**                                      | Home card requires `!completed` (drops series after ep N finishes)                       | `/history` → `watching` includes ep N+1                                       | CLI `--continue` only checks `anchors[0]`               | Post-Play offers ep N+1                                                        | Three separate algorithms give three different answers (main.ts:261-282, browse-idle-context.ts:52-54, ContinueWatchingService.ts:68-76).                |
| **Share / `/watch` timestamp**                             | `/share` & `/watch` missing from Browse palette; `/watch` drops `startSeconds` on Browse | Playback/Post-Play preserve `startSeconds`                                    | `Ctrl+Shift+S` in mpv undocumented in `keybindings.ts`  | History omits `"share"` action despite docs                                    | Timestamp dropped in SearchPhase.ts:1380-1386; History missing share at title-control-actions.ts:551.                                                    |
| **Calendar (`/anime-calendar`, `/series-calendar`)**       | Work on Browse (`SEEDED_CALENDAR_TYPE_TABS`)                                             | Missing from Browse palette; listed on Post-Play                              | —                                                       | Silently no-op on Post-Play                                                    | Dropped in post-playback-routing.ts:52-54 & run-post-playback-menu.ts:1023.                                                                              |
| **Switch Local / Online (`/play-local`, `/watch-online`)** | N/A                                                                                      | Listed in Post-Play palette                                                   | `l`/`s` in History                                      | Work in Active Playback; **no-op on Post-Play**                                | Advertised in command-registry.ts:239-240 without Post-Play handler.                                                                                     |
| **Connect Sync (AniList / TMDB)**                          | —                                                                                        | `/sync` connects vault only (all flags remain `false`)                        | Settings connects vault only (all flags remain `false`) | Setup flips `enabled: true` only (`trackWatched`/`syncList` stay `false`)      | Three entry points, zero of them actually activate syncing (setup-workflows.ts:301-309, settings/registry/sync.ts:98-108, shell-workflows.ts:3520-3585). |
| **In-player actions (`s`, `a`, `d`, `v`)**                 | —                                                                                        | —                                                                             | Terminal `?` help vs mpv window                         | Different behavior depending on which window has OS focus                      | kunai-bridge.lua:1104-1148 vs keybindings.ts:441-523.                                                                                                    |
| **Apply config changes**                                   | —                                                                                        | `/settings` applies immediately via `applySettingsToRuntime`                  | —                                                       | `--setup` / `/setup` and Settings `"Undo setup"` skip `applySettingsToRuntime` | Changes silently delayed until restart (setup-workflows.ts:247-248, storage.ts:44-45).                                                                   |

---

## 3. Both Lanes: Anime vs TMDB (Movies/Series) & YouTube (Question 3)

| Capability                                                                   | TMDB (Movies & Series)                                                                       | Anime (AniList / Providers)                                                           | YouTube                                               | Evidence & Gap                                                                                          |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Personalized Discover (`Because you watched`, `From your watch pattern`)** | Works                                                                                        | **Missing** (only generic trending)                                                   | Trending only                                         | discover-sections.ts:67-93 gates both personalized rails on TMDB/non-anime.                             |
| **Movies in Discover**                                                       | Included                                                                                     | **Excluded** (`item.type === "series"`)                                               | N/A                                                   | discover-results.ts:159-162 drops `kind: "anime", type: "movie"`.                                       |
| **Multi-season navigation (`/next-season`)**                                 | Full TMDB season graph                                                                       | **Limited / fallback-only** (AniList uses separate sequel IDs)                        | N/A                                                   | Owned by `.plans/054-anime-sequel-relations.md`; anime seasons don't chain cleanly like TMDB `S1 → S2`. |
| **Episode progress tracker sync**                                            | **Not supported** (`episodeProgress: false`, despite Setup saying `"Track shows and films"`) | Supported (AniList), though default-off bug blocks it                                 | N/A                                                   | TmdbAdapter.ts:32 vs SetupScreens.tsx:402; Trakt/Simkl missing for TMDB episode progress.               |
| **Direct ID launch CLI flag**                                                | `kunai -i <tmdbId> -t movie\|series`                                                         | **No `-i` AniList ID flag** (only `-S` search or `--open` share URL)                  | URL/search only                                       | cli-args.ts / main.ts treat `-i` as TMDB ID only.                                                       |
| **`/watch` lane switching**                                                  | Never switches `SET_MODE` on search fallback                                                 | Switches `SET_MODE` only on `resolved.kind === "search" && resolved.mode === "anime"` | Never switches                                        | shell-workflows.ts:2405-2423.                                                                           |
| **Settings live language profile dispatch**                                  | Dispatches `series` & `movie`                                                                | Dispatches `anime`                                                                    | **Omitted** (`youtubeLanguageProfile` not dispatched) | apply-settings-to-runtime.ts:67-81.                                                                     |
| **Sub/Dub audio switching**                                                  | Provider-dependent; mpv `a`/`d` restarts stream on single-track                              | First-class Sub/Dub toggle (AllManga/HiAnime/etc.)                                    | Audio tracks via yt-dlp                               | kunai-bridge.lua:1104-1148.                                                                             |

---

## 4. Phones, Termux & Small Terminals (Question 4)

### 4.1 Narrow Widths & Small Terminals

- **Hard lock-out below `60 cols × 20 rows`:** layout-policy.ts:27-35 sets `blocked: true` whenever `columns < 60 || rows < 20`. Every major shell (`Browse`, `Setup`, `Library`, `DownloadManager`, `Settings`, `RootOverlays` — e.g. setup-shell.tsx:239, 542, 719, library-shell.tsx:97, download-manager-shell.tsx:462) renders a full-screen `ResizeBlocker` and drops all keyboard input. Standard portrait Termux font sizes yield **40–55 columns** — making Kunai unusable in portrait orientation without pinching font size down to unreadable levels.
- **Degraded `60–79 cols` (`compact`) behavior:**
  - calendar-ui.tsx:103 completely hides `CalendarTypeTabs` (`return null`).
  - `DetailsSheet` (browse-shell.tsx:934, 1584) has no vertical scrolling (`lines: []`), so long synopses/seasons overflow 20–24 row terminals.
  - `DownloadManager` renders duplicate delete confirmation banners (download-manager-shell.tsx:553-559, 626-633), consuming vertical budget on short panes.

### 4.2 Touch / Mouse Support Matrix (`MouseTarget` / `SetupTarget`)

_Verified by grepping every `MouseTarget` and `SetupTarget` usage across `apps/cli/src/app-shell/` (code)._

| Surface                                         | Tap/Click Support            | Touch Failure Mode                                                                                                                                                                                                                           |
| ----------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Browse results & search box**                 | Partial (rows, search input) | Good select-then-activate; footer shortcuts & mode tabs mostly keyboard-only                                                                                                                                                                 |
| **Library shelf (`LibraryShell`)**              | Yes (tabs + title rows)      | **Traps user on tap-in:** tapping a title enters `LibraryTitleDetail`, which has **0 `MouseTarget`s** — no way to tap an episode or go Back                                                                                                  |
| **Library title detail (`LibraryTitleDetail`)** | **None**                     | Completely keyboard-only (library-title-detail.tsx)                                                                                                                                                                                          |
| **History (`HistoryShell`)**                    | **None**                     | Cannot tap tabs or resume any row (history-shell.tsx)                                                                                                                                                                                        |
| **Download Manager**                            | **None**                     | Cannot tap retry/pause/delete/back (download-manager-shell.tsx)                                                                                                                                                                              |
| **Calendar**                                    | **None**                     | Cannot tap tabs, day strip, or airing rows (calendar-ui.tsx)                                                                                                                                                                                 |
| **Notifications**                               | **None**                     | Cannot tap rows, actions, or tabs (notifications-shell.tsx)                                                                                                                                                                                  |
| **DetailsSheet (`i`)**                          | **None**                     | Cannot tap play/queue/close (details-sheet-ui.tsx)                                                                                                                                                                                           |
| **All Modal Pickers (`OverlayPanel`)**          | **None**                     | Episode picker, provider picker, title-control menu, Watchlist, Playlists are all untappable (overlay-panel.tsx)                                                                                                                             |
| **`/guide`**                                    | **None**                     | Cannot tap sections or exit (guide-shell.tsx)                                                                                                                                                                                                |
| **Setup Wizard**                                | Partial                      | `DependencyScreen` rows and `AnalyticsScreen` options have no targets; setup-shell.tsx:685-686 swallows tapping `enter` on Analytics (good for consent contract, but offers zero visual hint telling touch users to press keyboard `Enter`). |
| **Up Next (`QueueShell`) & Settings**           | Yes                          | Select-then-activate works.                                                                                                                                                                                                                  |

### 4.3 Without `mpv` / Android Handoff

- **Default `--player auto` breaks almost all subtitled playback on Android:** player-choice.ts:48-53 resolves `auto` on Android to `target: "chooser"`. handoff-player-service.ts:108-124 passes `serveExternalSubtitles: false` for `"chooser"`, so handoff-plan.ts:81-87 aborts with `external-subtitle-unsupported` whenever a stream has external subtitles (virtually every TMDB/anime stream) — without suggesting `--player mpv` or `--player vlc`, and without a Settings toggle to persist the player.
- **Offline downloads cannot play on Android:** handoff-player-service.ts:182-184 (`playLocal`) unconditionally throws `local-source-unsupported`.
- **Zero history/resume/sync/stats on Android:** `HandoffPlayerService.play()` fires an Android intent and returns `watchedSeconds: 0`, so Android users never get resume positions, Continue Watching progress, or tracker sync — nor a post-play `"Mark episode watched?"` fallback prompt to compensate.
- **`kunai doctor` fails on Android** (`requireMpv: true`, Finding #23).

---

## 5. Competitive Gaps (Question 5)

_Compared against `ani-cli`, `lobster`, Stremio, Jellyfin/Plex TUI clients, and Seanime. Excludes Pass-1 perf/distribution/provider-health items._

|   Rank | Gap / Feature                                                                                        | Competitors Doing It Well               | Why It Drives Daily Use & Retention                                                                                                                                                                                                                                                                  | User Value  | Effort | Notes / Plan Overlap                                                |
| -----: | ---------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------- |
|  **1** | **Working zero-friction tracker sync + Trakt/Simkl + 2-way Watchlist/Progress import**               | Stremio, Seanime, Jellyfin plugins      | Users switch to Kunai with years of watch history on AniList/MAL/Trakt. Fixing #1 + adding Trakt/Simkl (so TMDB series get episode progress, not just watchlist) and pulling remote "Currently Watching" into Kunai's Home screen eliminates cold-start emptiness.                                   | Very High   | M      | Fix #1 is **S**; 2-way pull + Trakt is **M**.                       |
|  **2** | **Stremio Addon Protocol support (Real-Debrid / TorBox / Torrentio / Cinemeta)**                     | Stremio                                 | Single highest retention multiplier for power users: reduces direct-scraper fragility, unlocks 4K HDR / multi-audio / cached streams, and brings Stremio's ecosystem into Kunai's keyboard TUI.                                                                                                      | Very High   | L      | Planned as **W5** in `.plans/2026-11-24-road-to-9-5.md`.            |
|  **3** | **Local media folder / Jellyfin / Plex library source (unified Library)**                            | Jellyfin, Plex, Stremio, Seanime        | Right now `/library` only plays files downloaded _by Kunai_. Pointing Kunai at an existing local folder (or Jellyfin server) turns Kunai into a single daily player for both local collections and online streams.                                                                                   | High        | M–L    | Unowned.                                                            |
|  **4** | **Batch season / episode-range download + working Offline Runway**                                   | `ani-cli -d -e 1-12`, Seanime           | `ani-cli` lets users grab `1-12` in one command for travel. Kunai blocks automatic season batch downloads (supported-and-unsupported.mdx:68) and its Offline Runway toggle is unreachable (#11). Range selection (`1-6` or "next 3 eps") + working Offline Runway makes offline genuinely practical. | High        | S–M    | Fix #11 is **S**; range picker is **S–M**.                          |
|  **5** | **VLC / IINA / External-player parity + persisted `player` setting**                                 | `ani-cli`, `lobster`, Stremio           | Many macOS users prefer IINA and Windows/Android users already have VLC installed. Persisting `player` in Settings (and landing VLC/IINA PRs) removes the #1 adoption barrier ("I don't have mpv").                                                                                                  | High        | M      | VLC PRs in flight; follow-up in `.plans/2026-11-24-road-to-9-5.md`. |
|  **6** | **Pre-play quality/dub quick-pick & CLI one-liner parity (`kunai -a -q 720p --dub "Frieren" -e 5`)** | `ani-cli`, `lobster`                    | `ani-cli` / `lobster` users love deterministic non-interactive one-liners (`-e 5`, `--dub`, `--quality 720p`, `-d -e 1-6`) for shell scripts and dmenu/rofi/raycast launchers.                                                                                                                       | High        | S–M    | Quality picker follow-up in `.plans/2026-11-24-road-to-9-5.md`.     |
|  **7** | **Zero-config built-in subtitle fallback search + in-player subtitle sync/offset**                   | Stremio (OpenSubtitles v3), Jellyfin    | Currently Wyzie requires a personal API key and manual Settings paste. Adding a keyless fallback source (or local `.srt` attach) + quick subtitle-delay hints boosts international retention.                                                                                                        | Medium–High | M      | Unowned.                                                            |
|  **8** | **Watch-together / synchronized playback rooms**                                                     | Syncplay + `ani-cli`, Jellyfin SyncPlay | Kunai already has share links with timestamps (`/share`, `/watch`). Adding optional Syncplay-compatible handoff or lightweight room sync turns share links into social sessions.                                                                                                                     | Medium      | M–L    | Unowned.                                                            |
|  **9** | **Rich cast/crew, related titles & franchise/sequel graph inside Details**                           | Stremio, Jellyfin, Seanime              | Opening `DetailsSheet` today shows synopsis + seasons, with no "More like this", no franchise/sequel chain (crucial for anime like _Fate_ / _Monogatari_ / _Attack on Titan_), and no clickable director/cast search.                                                                                | Medium      | M      | Sequel relations partially in `.plans/054`.                         |
| **10** | **Cross-device profile backup / export-import (history, watchlist, playlists, config)**              | Stremio (cloud sync), Jellyfin          | Switching laptops or setting up Termux + desktop means starting with an empty Watchlist, Playlists, and History. A `kunai export` / `kunai import` snapshot solves this without Kunai running accounts.                                                                                              | Medium      | S–M    | Unowned.                                                            |

---

## 6. First-Run Experience Walkthrough (Question 6)

Walking a brand-new user from `install.sh` / `install.ps1` (or Termux) to playing their first episode — every concrete stuck point (_Verified (code)_):

1. **Install & Verify (README.md:31, 124-128, 199):**
   - **Desktop without `mpv`:** `install.sh` installs `kunai`, not `mpv`. Running `kunai --setup && kunai -S "Dune"` shows missing `mpv` on `DependencyScreen`, but clicking Continue still proceeds into browse and blocks only at playback (`playback-dependency-gate.ts`).
   - **Termux / Android:** Following `README.md:199` (`kunai doctor`) immediately fails with `[error] mpv-missing` and exit code `1` (#23), convincing the user their install is broken before they ever launch Kunai.
2. **Narrow / Portrait Terminal (layout-policy.ts:27-35):**
   - Opening `kunai` in portrait Termux (<60 cols) or a narrow tmux/VS Code split (<20 rows) hits the full-screen `ResizeBlocker` (#7) with no way to dismiss or proceed in compact mode.
3. **First-Run Onboarding Wizard (setup-shell.tsx, setup-workflows.ts):**
   - **Touch users on Analytics consent:** Tapping options or tapping Continue does nothing (setup-shell.tsx:685-686) with no on-screen hint telling touch users to press keyboard `Enter`.
   - **Choosing Anime or YouTube + language preferences:** Wizard saves config without calling `applySettingsToRuntime()` (#2). The user immediately lands on **Movies & Series** with English defaults and thinks their setup choices were lost.
   - **Connecting AniList or TMDB during setup:** OAuth succeeds, wizard says connected, yet `trackWatched` and `syncList` remain `false` (#1). Watching the first episode syncs nothing.
4. **First Search & Inspecting a Title (browse-shell.tsx, details-sheet-ui.tsx):**
   - User opens Details (`i`): pressing `e` (`"e episodes"`) does nothing; pressing `+` (`"+ queue"`) does nothing; pressing `w` (`"w follow"`) unexpectedly opens Watchlist (#4).
5. **Starting First Playback:**
   - **Termux / Android:** Pressing `Enter` on almost any subtitled anime or TV show fails with `external-subtitle-unsupported` because default `--player auto` chooses Android chooser with `serveExternalSubtitles: false` (#3), with no hint pointing to `--player mpv` or `--player vlc`.
   - **Desktop (`mpv`):** Stream starts; if it stalls, the user tries `r` from `README.md:170` — nothing happens (actual binding is `Ctrl+R`, #24). Pressing `v` in mpv to toggle subtitles hijacks into quality picking; pressing `s` hijacks into source picking (#5).
6. **Returning for Episode 2 / Session 2:**
   - User closes mid-episode and relaunches, left-clicks directly on the `"Resume at 14:22"` card in mpv — left-click **dismisses** the prompt and restarts from `0:00` (#6).
   - User finishes Episode 1 and returns to Home — the show disappears from Home Continue Watching because `browse-idle-context.ts` only checks `!entry.completed` (#9).
   - User later finishes a movie and runs `kunai --continue` — fails with `"No unfinished or ready continuation target yet"` because `startupCandidate()` only inspected `anchors[0]` (#9).
   - User tries to unfollow a show from Browse `/` palette — `/unfollow` and `/mute` aren't there (#10).

---

## Verification Summary

- **Executed (read-only):**
  - `bun run scripts/verify-doc-paths.ts` → **PASS** (`59 docs and 2574 source files scanned, all paths resolve`).
  - `bun run scripts/verify-doc-coverage.ts` → **PASS** (`every code area under 5 roots is routed in the feature map`).
  - `bun run scripts/verify-readme-commands.ts` → skipped (no prebuilt `apps/cli/dist/bin/kunai-linux-x64` in this read-only worktree).
  - Isolated `bun apps/cli/src/main.ts --help` under `env -u XDG_CONFIG_HOME -u XDG_DATA_HOME -u XDG_CACHE_HOME -u XDG_STATE_HOME HOME=$(mktemp -d)` → could not run because `node_modules` is not installed in this clean worktree.
- **Code inspection:** All 24 findings and all cross-surface, lane, and mobile tables were verified by direct source inspection and callee tracing.
