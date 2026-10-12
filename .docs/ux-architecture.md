---
status: current
lastReviewed: "2026-10-07"
---

# Kunai — UX Architecture

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Use this doc when designing terminal interactions, keybindings, panels, command flows, and validation behavior.

## Design Goals

- keep the app fast for repeated daily use
- keep the interaction model consistent across flows
- keep important actions reachable from anywhere
- reduce avoidable user errors with structured selection and validation
- make failure paths understandable and recoverable
- add visual polish without introducing jank or blocking behavior

## Interaction Model

Kunai should behave like a terminal app shell, not a sequence of unrelated prompts.

### Core layout

- header for current context and status
- content area for the active workflow
- footer for stable core actions plus contextual hotkeys
- compact status strip for user-critical runtime state
- command bar for global actions
- overlays for secondary flows
- overlay pickers size against `OverlayLayoutProvider` inner viewport (`contentRows` / `contentColumns`), not raw terminal dimensions — see `apps/cli/src/app-shell/overlay-layout-context.tsx`
- playback surfaces should keep title, episode identity, provider, and subtitle state visible without making users infer where they are

### Fullscreen TUI consensus

- the app should read as one fullscreen TUI, not stacked floating cards on a terminal canvas
- there should be one dominant outer frame and one dominant content region
- nested bordered boxes should be treated as local sub-panels, not repeated full-width containers
- the shell should never rely on terminal scrollback for normal interaction
- if the terminal is too small for a workflow, show a resize blocker instead of half-rendering
- content should win over chrome as space gets tight:
  - primary list or active workflow
  - local context strip
  - companion preview
  - secondary helper copy
- companion panes should appear only when the viewport can support them without crowding the main task
- when a provider or result does not have real detail data, the shell should show a light preview rather than pretending there is a richer details state
- the fullscreen hierarchy should stay stable across browse, picker, overlay, and post-playback states

### Command philosophy

- `/` is the global entry point for actions
- post-playback should always expose a direct path back into a fresh search without quitting the app
- common operations should have short command aliases
- discovery commands should be explicit and safe:
  - `/recommendation` loads personalized discovery
  - `/calendar` loads releases airing today without provider resolution
  - `/random` spins a small browse tray and never starts playback by itself
- commands should be discoverable rather than hidden
- command ownership should live in one global router, not in each component independently
- `/` should stay available in every interactive state, including picker and filter flows
- command palettes should preserve the underlying filter or search text and restore focus exactly where the user left it
- command palettes should be lightweight overlays anchored under the header, not full-screen mode switches
- command palettes should open with an immediately highlighted default action and still support zero-typing keyboard browsing
- command palettes should group actions by `Global` and `Context` rather than by implementation source
- command palettes should imply the recommended action through default highlight rather than extra “recommended” noise in every row
- command palettes should also match locally-known titles (`JUMP TO`) once the input is at least two characters — titles are read from local state only (history, queue, followed, lists, playlists), never the network; commands keep precedence over title rows; the title section collapses on empty input; a title pick lands on the same title→episode flow a browse selection uses

### Hotkey philosophy

- `Ctrl+C`, `/`, `Esc`, and `?` are always-global
- hotkeys are contextual, not globally modeful
- use direct keys for high-frequency actions only
- do not hijack normal text-entry behavior
- if text input is focused, normal typing wins except for `Ctrl+C`, `/`, and `Esc`
- non-text states may expose direct hotkeys alongside `/`, but `/` is still the universal fallback
- prefer explicit leader mode over hidden timed key chords
- if an action is unavailable, show why instead of silently ignoring the input
- mode actions should be phrased by destination, like `Anime mode` or `Series mode`, instead of generic toggle wording

### Session undo (`z`)

- `z` is contextual the way lazygit's is: it exists only while an undo strip is live, and the strip itself is what advertises the key (`added to queue · z undo`). There is no standing `z` footer entry — the footer rule (show only currently usable actions) is kept by not claiming one.
- the strip lives in the single transient row at shell root, so it renders identically across browse, post-play, playback, and overlays. It expires after ~8s and never steals focus.
- undo is in-session and local-only: it restores the local SQLite state the action changed — queue rows (ids + positions), list membership, followed-title preference, history rows — to exactly the pre-mutation state. Side effects that already escaped (flushed tracker sync, queued downloads, mpv progress writes) are out of scope; the strip never claims to undo them.
- only actions with a clean inverse are journaled. A fake undo is worse than none — ops like queue-session restore across sessions are deliberately not undoable.
- `z` loses to every text-input owner: while a filter field, the command palette, or a picker list owns printable input, `z` types. On non-typing surfaces it pops the newest live journal entry; with nothing live it is a silent no-op.
- if the entity changed elsewhere after the action (a row was played, re-followed, re-queued), undo does not overwrite the newer state — it pops the entry and says why (`can't undo queue add — queue changed since then`).
- the confirmation line (`undid queue add`) is itself not undoable — undo is never journaled.

### Contextual tips

Shortcut coaching is earned, not ambient. A tip fires only after the user did
the thing the long way — picked a command out of the `/` palette that a plain
keypress would have reached — and only on a surface where that key is actually
live. The contract:

- **once-ever.** Each tip id shows at most once, then never again. The seen
  set lives in `config.json` (`seenTips`, next to `tipsEnabled`), persisted
  before the line renders so a crash can only cost a tip, never repeat one.
- **dismissible.** The Settings → "Shortcut tips" boolean turns the feature
  off entirely without burning the seen set; "Every shortcut tip" lists the
  whole catalog, marks what already showed, and lets a shown tip be re-armed
  deliberately.
- **lowest priority.** Tips render on the same transient row as alerts,
  toasts, streaks, and digest — last in line, so a coaching line can never
  displace feedback about something that just happened.
- **never under focus.** A tip does not fire while an overlay or picker owns
  the screen. Root-owned overlays therefore do not wire the trigger at all.
- **honest.** Copy resolves the real chord from the keybinding registry at
  render time (`bindingId → glyph`), so a rebound key can never drift the
  text. A candidate tip whose key is not bound on that surface — or whose
  command is not in that surface's palette — is not a tip and does not ship.

Map: `apps/cli/src/domain/session/contextual-tips.ts`; copy, arming, and
catalog: `apps/cli/src/app-shell/contextual-tips.ts`.

## Selection Over Freeform Input

If the app already knows the valid options, the UI should present those options instead of asking the user to type raw values.

This applies especially to:

- providers
- seasons
- episodes
- subtitle tracks
- settings choices

Search query and command input remain valid uses of text fields.

Settings secret and URL fields use a dedicated `inputMode` buffer in
`apps/cli/src/app-shell/settings/` — never the shared picker `filterQuery`.
Enter on a text row opens edit mode; a second Enter commits; Esc cancels.
Rows overridden by env vars show an `(env)` badge and cannot be edited in-app.

## Panels And Overlays

Preferred overlay or panel flows:

- settings
- history
- diagnostics
- provider switcher
- season picker
- episode picker
- subtitle picker

These should feel like parts of the same application, not separate tools launched from the side.

Browse should prefer shell-hosted panels for lightweight secondary flows such as:

- provider switch
- settings
- help
- about
- history snapshot
- diagnostics snapshot
- selected-title details and overview

This keeps the user anchored in the current query and result list while they inspect or adjust nearby state.

Title details should be honest about data quality:

- show overview, poster availability, rating, episode count, and provider facts when the source returned them
- promote local progress, offline availability, and broken local artifact state near the title summary when known
- show calendar entries as release facts, not playable guarantees
- show cached offline-ready History continuation as an explicit local action only when a durable
  downloaded job is addressable; Enter may launch that local file, while ordinary History actions
  retain their online intent
- show explicit unavailable placeholders when a provider-native result does not expose those fields
- keep actual Kitty/Ghostty image rendering outside the Ink render tree until the image-pane service owns layout, clearing, and flicker control
- never require image support for selection, playback, or episode navigation

External link labels are sanitized for terminal rendering. Their targets stay
opaque through the details model and `l` shortcut: display sanitization must not
rewrite the URL being opened. The shared desktop opener rejects raw control
characters and permits only its explicit URL schemes on every platform.

Post-playback should use the same rule for lightweight panels so provider changes, history, diagnostics, help, and about do not break the user out of the current title context.
Settings should follow that same in-shell rule for browse and post-playback shells, even while deeper season, episode, and subtitle flows still finish their overlay migration.

Overlay behavior should stay disciplined:

- one primary overlay at a time
- one child picker or confirmation above it when needed
- `Esc` closes only the top overlay
- unrelated deep overlay chains are a smell
- `Esc` must never act like confirm or implicit playback start
- pickers should preserve their local filter, selection, and scroll state when command overlays open and close above them
- overlays and pickers should be windowed to the viewport, not allowed to push content into terminal scrollback

### Routed surfaces mount before they load

A surface that owns a route must exist before its I/O starts. The calendar is the reference
implementation:

- `SearchPhase` does not await a schedule bundle. It increments a monotonic
  `calendarRequestKey`, clears the ordinary query/result state for the route, and opens the
  browse shell immediately with that request.
- `useCalendarRoute` (`apps/cli/src/app-shell/hooks/use-calendar-route.ts`) owns the five states
  the surface can be in: `loading`, `retrying`, `success`, `empty`, `error`. Route identity comes
  from the request, never from whether the loaded rows happen to look like calendar rows.
- Loading and retrying render the existing Sakura loader under the existing reduced-motion policy
  (`KUNAI_REDUCED_MOTION` / `NO_MOTION`); there is no calendar-specific motion setting.
- Zero rows are an `empty` calendar, not a fallback to generic browse idle copy. The route keeps
  its chrome and its keyboard.
- Failure keeps calendar chrome, shows one bounded sentence (source URLs and tokens stay in
  structured diagnostics), and offers `r` to retry. Retry reloads in place — the surface does not
  remount.
- Every attempt owns one `AbortController` plus a latest-request gate. A superseded, cancelled, or
  unmounted attempt can never call the acceptance callback, so it can never write results,
  diagnostics, the route subtitle, or the calendar visit stamp. Esc aborts the in-flight request.
- Cancellation outranks source outcomes underneath: `loadCalendarResults` settles only the source
  operations that actually exist, re-checks the signal after `allSettled`, keeps partial success
  usable, and raises a bounded `AggregateError` when every real source failed.
  `ResultEnrichmentService.enrichResults()` takes the same signal and refuses to seed its cache
  from an abandoned attempt.
- Leaving the schedule for other content (Esc, search, trending, recommendations) releases the
  route as well as the calendar UI state, so a settled route can never keep rendering ordinary
  results through calendar chrome.

### Search type-ahead suggestion band

The browse shell owns a Spotlight-style suggestion band anchored between the query field and the
divider (`app-shell/suggestion-band-ui.tsx`). Streaming-app search feel: it answers after ~2
typed characters, before Enter.

Sources and async contract:

- Two layers merge into one ranked band — pure logic in
  `domain/search/suggestion-engine.ts`: prefix match > word-boundary > subsequence, recency as
  the tiebreak, catalog rows deduped against shown local titles.
- Local layer is synchronous and free: past submitted searches, watched titles, followed titles,
  and list/playlist rows (`app/search/search-suggestions.ts` materializes them as
  `SearchSuggestion<SearchResult>` — every row's `value` is a real SearchResult).
- Remote layer is ONE call into the fast registry catalog for the lane — `services/search/
suggest-titles.ts` resolves `getForProvider(provider)` first (AniList for anime providers,
  same as `searchTitles`), then the registry default (TMDB). It never runs the provider-lane
  search walk, never enriches, never resolves a provider or probes a stream. YouTube mode has
  no registry catalog, so the band shows local rows only — provider-native search is too heavy
  per keystroke.
- `app-shell/hooks/use-search-suggestions.ts` debounces ~300ms, aborts the superseded request,
  and gates commits by request id — a stale response can never overwrite a newer draft's rows.
  Local rows paint in the same frame as the keystroke; while the catalog call is in flight the
  catalog section shows dim `░` skeleton rows.
- Zero remote hits leave local rows plus a `keep typing · ↵ search anyway` hint; a catalog
  failure settles silently to local-only. The band is an enhancement, never an error surface.

Keyboard contract:

- The band never steals focus — it is not a focus zone. Typing always edits the draft; the
  query field keeps its cursor.
- `↓` from the query highlights the first suggestion; `↑`/`↓` move inside it. `↓` past the last
  row exits the band and continues the normal path (results → list, empty → idle rows / query
  history). `↑` above the first row drops back to plain typing.
- `Enter` on a highlighted suggestion commits it through the exact pipeline a results-list row
  uses — `onSubmit(value)` for title rows (session routing, episode flow unchanged) or a real
  `runSearch(commitQuery)` for history/query rows. Plain `Enter` with nothing highlighted still
  runs the submitted search. `Ctrl+O`/`Shift+Enter` open the details sheet for the highlighted
  suggestion, same as a list row.
- `Esc` dismisses the band for the current draft first; the next `Esc` resumes the existing
  ladder (narrow filter → chips → clear query → cancel). The next keystroke reopens it.
- A dim ghost completion trails the cursor at end-of-line from the top suggestion; `→` or `Tab`
  accepts it. Mid-text `→`/`Tab` behave exactly as before.

Suppression — the band simply does not exist:

- command mode, calendar view, any open overlay, loading/searching states, and playback or
  post-play surfaces (the band lives inside browse only).
- blocked/ultra-compact terminals — same `<60 cols / <20 rows` threshold as `viewport.ultraCompact`.
- a draft below 2 chars, a draft equal to the submitted query (bootstrap `-S` results and
  preserved-search remounts land here — the band stays quiet until the user edits).

Mode and lifecycle seams:

- Series and anime both use the fast registry contract; the provider's catalog identity picks
  TMDB vs AniList, and a picked suggestion's `resolvedLane` stamps the same way committed
  results do, so a watched anime row picked in series mode still replays in anime mode.
- `/search` resolves through command mode first — the band is suppressed while the palette is
  open and resumes on the resolved query's next edit.
- `KUNAI_REDUCED_MOTION` / `NO_MOTION`: the band renders in the keystroke's frame and the
  catalog debounce drops to zero — no staged animation exists and none is simulated; the
  request gate still coalesces superseded drafts.
- No 1-9 quick-pick: the band only exists while the draft is non-empty, so digits are query
  characters, not shortcuts. The existing 1-9 chip-clear (which fires on the empty query) is
  untouched by construction.

### Title control is the one action policy

`app-shell/title-control/title-control-actions.ts` is the single source of
truth for which actions a surface offers. Surfaces are `browse`, `library`,
`loading`, `playing`, `post-play`, and `history`. The per-surface lists are
**allow-lists**: an action omitted from a surface is filtered out before its
`when()` predicate runs, so adding an action to a surface means adding it to
that surface's list.

A capability switched off in config removes its actions outright rather than
disabling them — a permanently greyed row with an unchangeable reason is noise
on every menu. `downloadsEnabled` is the first of these, and it now applies on
every surface rather than only where a second policy happened to check it.

`domain/media/media-action-policy.ts` holds only the `MediaActionId`
vocabulary shared with `MediaActionRouter`. It does not decide what a surface
offers; a second policy that did was removed after it was found to have no
callers.

History is a special case worth knowing about. The shell's action handlers
resolve the session's current title, which over a history row is whatever sits
highlighted in the list behind the overlay. So the history overlay _picks_ from
the menu without running it (`pickTitleControlShellAction`) and re-dispatches
row-scoped actions through `MediaActionRouter` with that row's media item. The
`history` allow-list is therefore deliberately narrow: it carries only actions
that can be aimed at a row.

### Enter on a rested title plays; menus stay one key away

Plain Enter on a browse result is the play key, not the menu key. The contract
lives in `apps/cli/src/app-shell/title-control/smart-auto-launch.ts` and is
resolved once per entry in `PlaybackPhase`:

- a live resume position plays in place — no second prompt;
- a finished last episode plays the next unwatched episode when one is known,
  resolved through the same loader the starting menu would have run;
- a partially-watched movie resumes the same way;
- everything ambiguous — first watch, no saved position, a failed provider, an
  explicit `m` — opens the starting-point menu. `m` always opens it: that is
  the documented way out of auto-entry, carried on the title as
  `forceStartingMenu` so a plain Enter one key later still auto-plays.

Dwell prefetch (`app-shell/hooks/use-dwell-prefetch.ts` →
`app/search/prefetch-browse-entry.ts`) exists to keep that Enter cheap: ~500ms
after a result row stops moving it warms the exact chain select+playback pays —
provider-native mapping, identity enrich, title detail, and the episode catalog
(provider `listEpisodes` for anime, `fetchSeriesData` for TMDB series). It is
latest-wins (a moved cursor aborts the in-flight warm), silent on every
failure, session-deduped per result, a hard no-op while offline or on YouTube
rows, and it never fires mid-navigation. It writes no session state — it only
fills caches the real path already reads.

### The browse home return loop

An empty query is the home screen, and `browse-idle-context.ts` +
`browse-idle-actions.ts` own its strip of local shortcut rows. "New since you
left" leads it — above Continue Watching — when the attention system's
`release_progress_cache` holds provider-confirmed releases newer than
`lastCalendarVisitAt` (the same anchor the calendar's own newness marker uses,
so a first-ever visit claims nothing). Muted titles never count. It is one `●`
row — `3 new episodes since Tuesday` — Enter opens the schedule already on the
Tracked tab, and the row is absent entirely when nothing qualifies: never an
empty strip. Every row in the strip renders instantly; high-frequency paths
get no decorative animation.

## Picker Filtering

- filterable pickers are the default for season, episode, provider, subtitle, history, and settings flows
- picker filtering should keep terminal-style editing semantics where practical
- if a picker filter is non-empty, the first `Esc` clears the filter and the second `Esc` closes the picker
- picker states should keep a compact local title strip with:
  - task title, like `Choose episode`
  - one short context line, like `Season 2 · 12 episodes`
- picker rows should stay dense and single-line by default
- selected-item detail should live in a companion or selection panel, not by expanding every row
- when a picker is active, the picker owns interaction but should keep a lighter selection or companion panel visible when space allows

## Validation And Reliability

- UI actions should dispatch validated commands
- async work should surface clear status changes
- disabled states should be explicit
- recoverable failures should offer direct next steps
- diagnostics should be accessible to users, not hidden behind debug-only knowledge
- first-run dependency issues should surface inside the shell before escalating to a dedicated setup overlay

Playback command vocabulary is intentionally narrow:

- `restart` / `replay` is local playback control. It starts the same episode from the beginning and should not force provider refetch by default.
- `recover` is repair. It treats the current stream as suspect, refetches the same playback intent, and resumes near the last trusted position before trying fallback.
- `refresh source` is an advanced diagnostics action. It may try a fresh provider resolve, but it must preserve the current playable cached stream when no better source is found.
- `fallback` changes the provider after recovery fails or when the user explicitly asks for another provider. It is session-scoped — the durable per-title preference path is the `/provider` picker. Same-provider source failover is a separate mechanic and should stay visibly distinct in copy.

Short-lived playback feedback should use mpv OSD plus shell status text for non-blocking outcomes such as `No fresher source found. Continuing current stream.` Full loading or error screens are for broken playback, not healthy-playback refresh misses.

## Settings Behavior

- settings apply immediately after a row interaction commits
- `Esc` cancels active text input, backs out of submenus, or closes the
  settings shelf; it does not roll back values already applied to config
- label settings by effect timing:
  - immediate
  - next playback
  - requires re-resolve
- avoid restart-required settings unless there is no safer option
- recovery behavior should be configurable through explicit user-facing patterns rather than buried in hardcoded fallback logic

Recommended recovery-pattern values:

- `guided`
- `fallback-first`
- `manual`

## Status Density

Show compact always-visible state for:

- provider
- mode
- current title and episode
- subtitle state
- resolve state
- memory RSS

Keep deeper detail in a diagnostics overlay:

- cache / prefetch / fresh scrape / API path
- source refresh / recover / fallback decisions
- subtitle source and selected track
- language switch path, especially whether the request was an mpv soft-subtitle switch, cached stream reload, or provider lookup
- scrape timing
- retry and fallback history
- capability state for `mpv`, Playwright, and image backends
- offline runway, storage-reserve pauses, and maintenance waiting reasons; expose bounded
  decision summaries only, never local paths, stream URLs, request headers, or subtitle URLs

Autoplay and next/previous actions should follow real episode availability from provider or metadata catalogs, not guessed episode numbers.

## Setup Guardrails

- auto-detect missing dependencies
- never silently install system dependencies
- prefer an inline blocker card first
- open a setup overlay only when the user asks for detail or installation
- support `Install`, `Skip`, and `Don’t ask again`

## Visual And Motion Rules

- polish should support comprehension, not distract from it
- use subtle transitions for overlays, loaders, and status changes
- keep motion interruptible and cheap
- treat Kitty/Ghostty graphics as an enhancement, not an assumption
- do not auto-fallback to terminal block-art poster renderers; show a clear unsupported state instead
- load posters lazily and never block interaction for them
- preserve a strong plain-text fallback path
- footers should avoid long horizontal action sentences
- default footer layout should be two lines:
  - line 1: current task, optionally with one short context suffix
  - line 2: 3-4 live shortcuts plus `/ commands`
- minimal footer mode should keep line 1 and collapse line 2 into a smaller shortcut strip
- footer density should be configurable between `detailed` and `minimal`
- the footer should show only actions that are usable right now
- disabled actions belong in the command palette and help overlay, not the persistent footer
- the command palette should temporarily replace footer content with palette-specific guidance while open
- quit should use a brief exit treatment, not a long goodbye screen
- preferred exit treatment:
  - soft shell dim
  - footer drops away first
  - optional tiny mascot reaction
  - one short closing line
  - total runtime under roughly `180–220ms`
- `Ctrl+C` should remain near-instant and should not wait on decorative exit motion
- reduced or minimal modes should simplify or skip exit motion entirely
- high-frequency shell actions like picker navigation, command palette open, and search focus should avoid decorative animation
- fullscreen transitions should favor instant layout stability over flourish
- the shell should feel denser and calmer over long sessions, especially during episode browsing and repeated picker use

## Shell To Phase-Loop Intents

The Ink shell hands playback intents to the app phase loop through a **promise
bridge**: `waitForRootQueueSelection()` / `resolveRootQueueSelection()` in
`apps/cli/src/app-shell/root-queue-bridge.ts`, the same shape in
`root-history-bridge.ts`, and `waitForNotificationSelection()` /
`resolveNotificationSelection()` / `hasPendingNotificationSelection()` in
`root-overlay-bridge.ts`. The route awaits the bridge and returns a result the
phase loop plays.

**Use the promise bridge for any new intent. Do not add a staged module
global.** A staged global is read by exactly one route, but overlays open from
more than one place — the notifications inbox is opened both by
`openNotificationsOverlay()` and by a direct `OPEN_OVERLAY` dispatch in
`root-overlay-shell.tsx`. Under the old staged global, the route that never
read the value made "play now" silently do nothing, and the stranded intent
later fired against an unrelated session.

Notifications cover both directions now. On the awaited route the row
resolves the bridge and the opener returns a `history-entry` result. On the
direct route there is no awaiter, so the row executor self-delivers through
`notification-playback-delivery.ts`: a retained browse or post-play session
settles with `launch-playback`, and live or resolving playback receives a
stop-backed `switch-title` intent that the phase loop consumes after the
stop/resolve abort. Nothing to deliver to reports feedback instead of
dropping the intent. Whatever the mechanism, an intent has to work on every
path that can open the surface.

## Anti-Patterns

- mixing multiple interaction models in the same primary flow
- hidden timed key windows
- blocking setup wizards for common adjustments
- asking for raw values when structured data already exists
- decorative animation that delays interaction

## Playback command input ownership

`LoadingShell` mounts its playback input reader inside `ShellFrame`, below the
command-mode context provider. While the palette is open, letters and Escape
belong to it; closing the palette restores playback shortcuts. On a cancellable
resolve, the first Escape closes the palette and a subsequent Escape cancels
the resolve. The regression suite delivers Ink's pending-Escape callback
explicitly instead of waiting for its timer.
