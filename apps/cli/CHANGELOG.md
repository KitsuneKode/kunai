# @kitsunekode/kunai

## 0.3.1

### Patch Changes

- [#71](https://github.com/KitsuneKode/kunai/pull/71) [`6065233`](https://github.com/KitsuneKode/kunai/commit/606523359ca5436c8ca286a478e56ad32eefa10a) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Security and honesty fixes from a full codebase review.

  - **Downloads:** provider stream URLs and headers are now guarded before
    reaching yt-dlp (scheme check, leading-dash rejection, `--` terminator,
    CRLF-stripped headers), closing an argv option-injection path the mpv lane
    already blocked.
  - **Storage:** the data and cache SQLite files (plus `-wal`/`-shm`) are
    chmod'd to owner-only on every open, matching config and token handling.
  - **CLI:** `--jump` help now says what the flag does (auto-pick the n-th
    search result) and warns on invalid values; headless download failures and
    rejected `--handoff-url` values exit nonzero.
  - **Playback:** one-shot mpv launches attach the full collected subtitle
    inventory and report the real track count; prefetched and back-navigation
    streams are re-resolved when blocked or older than five minutes instead of
    replaying a possibly expired URL.
  - **AniSkip:** the TMDB→MAL fallback is refused beyond season 1 so
    split-cour anime no longer risk wrong auto-skip windows.
  - **Docs/palette:** the command-honesty gate now counts the browse palette;
    user docs stop promising `/sync`, `/random`, and `/surprise` as typed
    commands; the keybindings doc's post-playback table matches the code.

## 0.3.0

### Minor Changes

- [#59](https://github.com/KitsuneKode/kunai/pull/59) [`15cac9e`](https://github.com/KitsuneKode/kunai/commit/15cac9e0c1dbc91c957d0b2133a515b7585803e6) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Keep the anime auto-skip and provider-relay paths working after upstream rotations.

  - AniSkip now resolves a MAL id for AniDB titles, so opening and ending skips work on the default anime provider instead of silently never firing. The lookup shares the provider package's Cloudflare-aware transport and overlaps stream resolution, so it adds no serial request to playback start.
  - AllAnime tracks the upstream `mkissa` rotation to build 119 and 7-day epochs; the previous constants failed every stream request with `AA_CRYPTO_MISSING_BUILD`.
  - A relay no longer strips the provider-auth headers (`x-build-id`, `x-aa-boot`, `x-obfuscated`, `x-session-token`) that AllAnime bootstrap and Miruro decoding depend on, which previously made every bootstrap through a relay fail with `invalid_boot_token`.
  - A Miruro request blocked by Cloudflare now names the user-owned relay workaround rather than reporting an unexplained failure.

- [`e9e7134`](https://github.com/KitsuneKode/kunai/commit/e9e7134) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Show posters on every terminal, including Windows.

  - New half-block renderer decodes JPEG/PNG in process and paints two pixels per
    cell with truecolour SGR, so posters no longer require `chafa` — which is
    effectively never installed on Windows, where posters previously never
    appeared at all.
  - Windows Terminal no longer auto-selects sixel: support only landed in 1.22 and
    the environment reports no version, so an older build rendered raw escape
    bytes. `KUNAI_IMAGE_PROTOCOL=sixel` still forces it.
  - Poster cache moved onto the shared OS cache root (`getKunaiPaths`) instead of a
    hand-rolled `$HOME/.cache`, which is not a location Windows has.
  - `KUNAI_IMAGE_PROTOCOL=half-block` forces the new renderer anywhere.

- [`4524360`](https://github.com/KitsuneKode/kunai/commit/4524360) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Playback reliability, calendar navigation, and shell responsiveness.

  - Startup source failover walks the ordered source list before hopping providers, so a dead stream retries the next source instead of looping the same one.
  - Resolve cancellation is honest end to end: abort reasons ride on the signal, late feedback from a cancelled resolve is dropped, and a stream that arrives after cancellation is never handed to mpv.
  - Every exit routes through one phased shutdown coordinator with conventional exit codes (130/143/129), quiescing services and preserving playback, config, queue, and download state before disposal.
  - Calendar navigation scrolls minimally instead of re-anchoring on every keypress, fixing the sliding rows and laggy arrows.
  - The title-control menu (`m`) opens during playback instead of rendering underneath it, and cancel stays live across the whole bootstrap and failure window.
  - The episode picker no longer collapses to a single entry when a provider listing fails or when continuing from history.
  - Miruro resolves against the working mirrors only; Videasy reorders its first-phase servers and segment-probes HLS before attesting reachability.
  - Search shows a query-aware loading skeleton, post-play artwork retries after a transient fetch failure, and quitting no longer pauses autoplay.
  - Provider fallback moves to a deliberate `Shift+F` chord so a stray keypress cannot switch providers mid-session.

- The 0.2.6 development cycle was versioned but never published, so its work reaches users for the first time in 0.3.0:

  - **YouTube lane.** Search, playlists and channels play through the same shell as
    everything else, with live/upcoming handling, SponsorBlock and cookie settings,
    and video watch history counted in your stats.
  - **Playback that recovers.** Persistent mpv sessions, provider fallback with
    endpoint-health diagnostics, and honest cancellation — a dead source retries
    the next one instead of looping.
  - **Share links.** `kunai://` round trips, so a title (and timestamp) can be
    handed to someone else or reopened later.
  - **Offline and downloads.** Downloaded episodes play through the same path as
    streamed ones, so resume, subtitles and history behave identically.
  - **New surfaces.** Up Next queue, playlists, notifications, release calendar and
    a details sheet, plus a reworked settings shell.
  - **Native installer.** Self-contained binaries with a versioned layout and
    channel-aware `kunai upgrade` / `kunai uninstall`.

### Patch Changes

- [#40](https://github.com/KitsuneKode/kunai/pull/40) [`135517c`](https://github.com/KitsuneKode/kunai/commit/135517c2e1fe8225c501f4246fec41884233ce43) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - AllAnime now reports a captcha-gated stream request as a blocked, non-retryable failure naming the relay workaround, instead of silently returning no streams next to a full episode list. It is also demoted out of the automatic anime fallback lane while staying manually selectable.

- [#58](https://github.com/KitsuneKode/kunai/pull/58) [`4186bf2`](https://github.com/KitsuneKode/kunai/commit/4186bf2d85a6b3e70cba03ad404b62a9b588af2f) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Keep anime films in the anime profile while preserving their movie structure through history, downloads, and offline playback. Unknown one-shot anime formats now stay episodic until their episode count is known, and HTML cleanup cannot turn encoded markup back into tags.

- [#26](https://github.com/KitsuneKode/kunai/pull/26) [`0fc67a3`](https://github.com/KitsuneKode/kunai/commit/0fc67a37bdb1536039e80e68df8b884e9038bf6e) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Repair the default AniDB anime route across current browse parsing, provider-native identity, season and absolute-episode routing, and production-derived release signoff.

- [#33](https://github.com/KitsuneKode/kunai/pull/33) [`0c3c735`](https://github.com/KitsuneKode/kunai/commit/0c3c7357d85b640f4c962035a2f04bff544f940b) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Report `curl` in `kunai doctor` and setup. AniDB is the default anime provider and needs a curl (plain or curl-impersonate) to get past Cloudflare, so its absence could previously make anime search return nothing with no diagnostic anywhere.

- [#28](https://github.com/KitsuneKode/kunai/pull/28) [`0f20cf4`](https://github.com/KitsuneKode/kunai/commit/0f20cf463940aac27821da836d3a11b3358da336) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Present movie, series, anime, and video positions consistently; persist movie downloads as title-level jobs; and keep download and calendar surfaces responsive through width, poster, loading, retry, and cancellation changes.

- [#58](https://github.com/KitsuneKode/kunai/pull/58) [`4186bf2`](https://github.com/KitsuneKode/kunai/commit/4186bf2d85a6b3e70cba03ad404b62a9b588af2f) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Make anonymous usage analytics explicit opt-in. Setup now defaults to off, Settings can enable or disable collection, and disabling removes the local install identifier.

  ### Privacy
  - Do not send analytics before consent, without an interactive terminal, or when DNT or CI blocks it.
  - Leave the production endpoint disabled until an operator configures and verifies one.

- [#27](https://github.com/KitsuneKode/kunai/pull/27) [`35aa301`](https://github.com/KitsuneKode/kunai/commit/35aa301b78b79eca17c16c697d139756f0394da1) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Recover active playback from transient buffer, stall, and seek states while rejecting stale mpv cycle events and presence updates.

- [#38](https://github.com/KitsuneKode/kunai/pull/38) [`3bf6d33`](https://github.com/KitsuneKode/kunai/commit/3bf6d33054d72cd0fe2b19875099dc2cc746b64f) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Make Miruro resolution evidence truthful: stream reachability is attested only from an explicit probe, AniList identity is parsed once and strictly, the server try order has a single authority, every pipe decode stage raises its own redacted failure code, and subtitle format is inferred from evidence instead of defaulting to SRT.

- [#35](https://github.com/KitsuneKode/kunai/pull/35) [`099e040`](https://github.com/KitsuneKode/kunai/commit/099e0409281363bd3cce3e2a347cfc38664fa537) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Route every poster through one bounded Bun-native preparation seam, add iTerm2/VS Code inline images, and remove the chafa and ImageMagick runtime requirements. Posters now need nothing installed on any supported terminal.

- [#42](https://github.com/KitsuneKode/kunai/pull/42) [`05e97ee`](https://github.com/KitsuneKode/kunai/commit/05e97eed95991172b2ef33bfe6a9cf8f3e85dc20) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Recognize Bun connection failures as offline, keep confirmed offline state until a successful request, and return failed searches with visible retry and offline-library guidance instead of silently replaying them.

- [#41](https://github.com/KitsuneKode/kunai/pull/41) [`68b0a5f`](https://github.com/KitsuneKode/kunai/commit/68b0a5f45ebf349a342c3b7cd4643e98c48ef6f8) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Keep verified offline downloads on their trusted local media and subtitle paths, without provider recovery or remote playback metadata requests, and harden cancellation and reconnect handling around the mpv handoff.

- [#62](https://github.com/KitsuneKode/kunai/pull/62) [`6a952d8`](https://github.com/KitsuneKode/kunai/commit/6a952d8044288f5ff58bebf269d3e609369f1506) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Make the shell's own surfaces reachable and readable at the terminal sizes people actually use.

  - `/analytics` and `/presence` answered "no matching commands" from the resume and starting-point pickers while the footer still advertised `[/] commands`. Both govern data leaving the machine, so being told they do not exist was the wrong answer. Picker command sets now come from one registry context instead of three hand-written arrays that had drifted apart.
  - The Settings section tabs were unreadable at 80 columns: twelve names were squeezed into two-character stumps that wrapped onto a second line, hiding which sections exist. The strip now scrolls around the active section, which is always shown in full, with `‹`/`›` marking what is off-screen.

- [#58](https://github.com/KitsuneKode/kunai/pull/58) [`4186bf2`](https://github.com/KitsuneKode/kunai/commit/4186bf2d85a6b3e70cba03ad404b62a9b588af2f) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Rebuild tracker sync on a generation-safe SQLite outbox with typed tracker
  identities and idempotent desired-state writes, so a redelivery converges
  instead of toggling and a late completion cannot overwrite newer intent.

  AniList now connects with no configuration at all: the implicit grant needs no
  client secret, so Kunai ships an application id and nothing else. Delivery is
  paced against AniList's published rate-limit headers, and a `429` defers the
  whole batch for that tracker using the server's own wait rather than retrying
  into it. Sync can be paused for a while — distinct from turning a tracker off —
  with work still queueing while paused.

  Favourites and watchlist now reach the right tracker. A list change carries the
  title's catalogue ids instead of dropping them, and AniList is resolved from an
  explicit id rather than from the lane a row arrived through — anime almost always
  arrives as a TMDB-typed `series`, so the old lane check rejected the very titles
  it existed to route while TMDB accepted them. Favouriting an anime wrote to TMDB
  and never to AniList; more often it queued nothing at all and still reported
  success. A title no tracker can address now says so instead of looking identical
  to one that synced, and AniList takes precedence over TMDB when both resolve, so
  one keypress files one title in one account.

  Every TMDB write was rejected as unauthenticated: the adapter sent the v3 API key
  as a bearer token and invented an `X-Session-Id` header, then addressed the
  account by username. Auth moves to the query string TMDB v3 documents, the
  numeric account id addresses the account, and an identity stored under the old
  shape is repaired on next start rather than needing a reconnect.

  Fixes several silent failures: removing a title from a watchlist reported
  success when the lookup had actually been rejected; `ToggleFavourite` could fire
  after an unreadable lookup, turning a redelivery into a flip-flop; TMDB's
  "push watched" removed titles from the watchlist; validation errors retried
  forever instead of dead-lettering; and an offline start silently unlinked a
  connected AniList account. Permanently undeliverable changes are now reported on
  the sync page, which previously read "up to date" while they sat there.

  List membership is a set again: `(list_id, title_id)` is unique, so adding a
  title twice keeps one row instead of two invisible ones, and the membership check
  gets a covering index. Existing duplicates collapse onto the earliest row.

  In the shell, the favourite mark moves to its own accent-tinted column on the
  right — prefixed into the title it took the title's colour and pushed every
  favourited row a glyph out of alignment — and a toggle now reports which way it
  went, and where it synced, instead of "Updated favourites" for both directions.
  Favourites reach the screens where you actually spend time: `l` toggles during
  loading and playback, and the playing rail and post-play panel both show the
  mark. The details panel gained a Favourite line beside Watchlist, which had
  been describing one half of a pair.

  Connecting TMDB no longer hangs when the API is unreachable. Artwork and
  metadata try a mirror before going direct, so they can work on a network where
  account linking cannot — linking must be direct, because a request token and
  session id are account credentials. That now fails in seconds with an
  explanation instead of stalling forever with no output.

  Sync gains a settings page — the first reachable Connect surface — with a status
  badge in the root crumb. It is marked experimental: the delivery path is covered
  by tests but has not yet been verified against a live tracker account.

- [#39](https://github.com/KitsuneKode/kunai/pull/39) [`8a07e00`](https://github.com/KitsuneKode/kunai/commit/8a07e00812b3ecf073f87b38d2eb9759db028025) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Harden Videasy's active path: TMDB identity must be a complete positive decimal, the selected-route cache policy has a single owner instead of being silently rebuilt, and Wings seed transport state is bounded. Cancelling a playback no longer marks both Wings hosts unhealthy for five minutes.

- [`4cd84c9`](https://github.com/KitsuneKode/kunai/commit/4cd84c9) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Harden installers and release asset completion checks.

  - `install.sh` / `install.ps1` `--dry-run` / `-DryRun` compute paths without creating directories.
  - Empty or incomplete release assets fail with specific messages and npm / Bun / source / pinned-version recovery guidance.
  - GitHub Releases require all eight binaries plus `SHA256SUMS` (`fail_on_unmatched_files`, post-upload contract assertion).

- [`545477f`](https://github.com/KitsuneKode/kunai/commit/545477f) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Ship the npm postinstall registration hook in the published tarball and verify a clean global install, update check, and package-manager uninstall.

- Ship the npm package as a minimal Node launcher with exact-version optional
  platform binaries, and preserve the correct npm or Bun managed-install
  ownership in the compiled CLI.

## 0.2.5

### Patch Changes

- Continuous play (Up Next), offline parity, smarter anime classification, a rebuilt calendar, and a long tail of UX fixes.
  - **Continuous play (Up Next).** Auto-continue into the next episode → your queue → a recommendation when caught up (cancelable countdown). `/queue` opens the Up Next panel; reorder queued items (move up/down); save the queue as a playlist; import/export.
  - **Offline parity.** Downloaded episodes now play through the _same_ path as online — full resume **offer** (not a forced seek), auto-skip, OSD, track control, autoplay into the next downloaded episode, and history.
  - **Smarter anime.** Deterministic TMDB anime classifier (research-validated) tags results as _Anime_; it is authoritative for the persisted content kind, so an anime watched via a series provider is still classified as anime. Fix a wrong label any time with `/mark-anime` · `/mark-series`.
  - **Rebuilt calendar.** Rolling ±7-day schedule (past week + upcoming), type tabs (All/Anime/Series/Movies/Tracked), per-day navigation, `/anime-calendar` and `/series-calendar` shortcuts, boxed day chips with a distinct _today_ highlight, and aligned columns that no longer shift on long titles.
  - **Share links.** `/share` copies a catalog-anchored `kunai://` URL for the current title; `/watch` opens a `kunai://` link from your clipboard.
  - **CLI surface.** `--help` / `--version` are first-class; Up Next panel, two-pane tracks panel, and `/audio` + `/subtitles` deep-links; settings persist on change (no Ctrl+S); destructive rows are red.
  - **Downloads.** Parallel N-worker pool (`maxConcurrentDownloads`, default 3, 1–5); runaway RAM and orphaned `yt-dlp` are fixed (bounded fragment buffering, SIGKILL children on exit, socket timeout); partial-download badges (`↓ n/total`); pause-on-quit + auto-resume on return.
  - **Calendar polish.** Chronological day strip, no phantom "Nothing on schedule" days, enter-at-today navigation, no layout shift on long titles, ±7-day clamp.
  - **Classification fix.** Content-derived kind on the write path (drama-on-anime-provider no longer labeled anime).
  - **Progress fix.** Episode progress and series progress are now separate — finishing one episode no longer mislabels a whole series "Completed"; `unknown` release state → Continue, not falsely Completed.
  - **Library fix.** Offline episodes ordered by season/episode, not download time.
  - **Playback fix.** Failed-to-start stream no longer pauses autoplay; single-season episode-list escape no longer loops.
  - **Presence fix.** Discord shows a real progress bar only when duration is known.
  - **Config fix.** An explicit `vidking` provider choice now persists (was reverted every load).
  - **AllManga fix.** Correct thumbnail CDN; ak-only fallback capped at 4s; next-episode prefetch no longer voided by a `startupPriority` mismatch.
  - **Performance.** App-shell list passes combined; independent cleanup + recommendation profiling parallelized; duplicate history fetch removed; O(n) offline-status grouping; trimmed preview/calendar model work.

## 0.2.4

### Patch Changes

- Shell UX overhaul: honest history buckets, smarter downloads, faceted filters, and a disciplined semantic color pass across every surface.
  - History now classifies every title through a single source of truth into honest **Continue / Completed / New** buckets, so a half-watched show no longer hides under "new" and a finished one no longer nags you to continue.
  - Downloads gained a quality ceiling so you can cap resolution, HLS retries are more resilient to flaky segment fetches, and the download sheet reads more clearly about what is being fetched and why.
  - `/filters` now uses website-style faceted category chips, making it obvious which facets are active and how to clear them.
  - The source/server picker labels each server row with the audio language behind a flag, matching the web-style Servers tab so dub/sub choices read at a glance.
  - Applied a consistent semantic tone pass: shared 3-role footer color hierarchy, de-noised headers, browse rows tinted by content kind (anime / series / movie), split info vs. warning tones on the loading/dependency screen, and unified tone colors across overlays, history, and details.
  - Rebuilt the details overlay around a compact model with an inline renderer, replacing the previous sparse, spam-prone layout, and added a terminal-portable `Ctrl+O` details shortcut while dropping the advertised-but-broken `Shift+Enter`.
  - Fixed autoplay correctness: switching provider, source, or quality — and recovery — no longer pauses an autoplay chain.
  - Polished mpv resume OSD (real newline events instead of overflow, a smaller card, rose brand accent) and tightened the palette by dropping empty scroll-placeholder lines and dead top margin.
  - Fixed the calendar: the left column shows real clock time while the countdown stays in the status column, and structured-item view detection restores the day strip, type tabs, and per-kind colors.

## 0.2.3

### Patch Changes

- Unify the release calendar across content kinds and refresh the design tokens.
  - `/calendar` now loads anime, series, and movies into one content-kind–aware window instead of only the active mode, with a new TMDB movie-release source. Rows carry a single structured `CalendarItem` (content kind, release precision, release status, provider-confirmed, and an explicit reason a row is shown), so the renderer no longer reconstructs meaning by parsing display strings. Honest release semantics are preserved: a date-only release dated today stays upcoming until the day is strictly past, and an unknown date never renders as confirmed. Anime, series, and movie rows now read at a glance via per-kind color.
  - Redesigned the CLI color tokens ("Ember Dusk"): a near-neutral warm-ink surface ramp with visible elevation, rose reserved for brand/focus/selection, dedicated amber `warn` and cool `info` tokens, and a distinct content triad (anime orchid, series teal, movie gold) so every signal is its own hue.
  - Fixed a command-palette correctness bug: pressing Enter now always runs the highlighted row instead of an exact-alias shortcut that could diverge from the visible selection.

## 0.2.2

### Patch Changes

- Harden direct-provider playback by restoring Miruro in the active anime route, improving VidKing/Videasy session handling, and making loading/post-play controls expose autoplay, autoskip, and source controls consistently.

## 0.2.1

### Patch Changes

- [`f4a19bd`](https://github.com/KitsuneKode/kunai/commit/f4a19bd52f7ca655fe320204d1c988ca1ad7a213) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Polish post-playback action rows so shortcut hints render as stable bracketed key labels instead of loose trailing letters, and make the stopped-early replay action match the actual available control.

## 0.2.0

### Minor Changes

- [`21b89ec`](https://github.com/KitsuneKode/kunai/commit/21b89ec21235b8934253296e1fbce9e66a3ec81e) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Kunai 0.2.0 is the beta-shell release. It bundles the large runtime, playback, provider, offline, diagnostics, and docs work landed since 0.1.4, with release notes written from the current codebase instead of plan shorthand.

  **Playback, recovery, and mpv**

  - Added the persistent mpv runtime path with IPC-backed controls, Lua bridge wiring, episode navigation from the player window, in-process reconnects, subtitle/audio/source updates, and clearer teardown so autoplay chains do not repeatedly respawn mpv.
  - Added typed playback phases and user-facing playback problem state: preparing provider, waiting for player, active playback, did-not-start, failed, post-playback, recovery, replay, fallback, and stop-after-current now flow through explicit state instead of scattered copy.
  - Added dead-stream and preflight safeguards: stalled/dead playback is detected separately from slow-but-healthy playback, suspected dead cached URLs are invalidated, retry/fallback decisions are bounded, and local/offline failures no longer poison provider health.
  - Added `/recover`, `/recompute`, `/fallback`, `/tracks`, `/source`, `/quality`, `/next`, `/previous`, autoplay/autoskip toggles, and stop-after-current into the stable active-playback and post-playback command surfaces with availability reasons instead of dead commands.
  - Added a unified tracks panel and capability model for source, quality, audio, hardsub, and subtitles. Single-option sections render as facts, switchable alternatives stay selectable, and failed/current tracks are shown without enabling dead choices.
  - Added source/quality picker routing from already-resolved provider inventory, preserving provider source intent across cache, prefetch, retry, provider switching, and download enqueue.
  - Added next-episode prefetch and startup policy plumbing so playback can prepare useful post-play actions without delaying the visible shell. Next/auto-next no longer stalls on a stale loading overlay.
  - Fixed movie playback identity: movies no longer accidentally render as series, no longer carry season/episode state, use movie language profiles, and offer resume/restart instead of always starting at 0.
  - Added playable-ref and content-kind domain helpers so title type wins over shell mode for playback, status crumbs, episode labels, and handoff behavior.
  - Improved autoskip/timing wiring with provider-native timing metadata, IntroDB/AniSkip context, startup diagnostics, and clearer skip/autoplay state in the live playback surface.

  **Provider engine and stream inventory**

  - Added the provider-cycle engine and provider-cycle contracts in shared packages, with bounded retries, cancellation handling, network-offline classification, retryable/non-retryable failure taxonomy, and fallback decisions.
  - Added provider metadata v2 across types, schemas, providers, app adapters, and history so native ids, release metadata, artwork, audio/subtitle language evidence, source labels, and seek-thumbnail evidence survive provider-to-UI boundaries.
  - Added normalized source inventory helpers, provider inventory facade, startup selection helpers, and variant tree utilities so VidKing, Rivestream, Miruro, and AllManga expose comparable source/stream/subtitle/quality facts.
  - Hardened VidKing with source flavors, source ids, evidence fixtures, lazy source probing, direct payload filtering, fallback source cycling, blocked-host fixtures, and deterministic phase-A/phase-B flavor ordering.
  - Hardened Rivestream and Miruro with provider service caching, ready-order startup selection, source inventory normalization, seek-thumbnail evidence, parse/network failure fixtures, and fallback behavior for discovery failures.
  - Hardened AllManga with ani-cli parity-focused API behavior, Ak fallback handling, source-family separation, startup priority handling, deferred Ak DASH materialization, language evidence, and result-cache keys that include startup priority.
  - Added provider attempt timelines, title-provider health, provider-health evidence, source-inventory cache invalidation, resolve work ledgers, and cache decision reporting so diagnostics can explain why a provider was selected, skipped, retried, or marked down.
  - Added live provider matrix smoke coverage and richer fixture suites for direct providers, negative cases, language normalization, source presentation, startup selection, and m3u8 variant extraction.

  **Shell, Sakura design system, and shortcuts**

  - Migrated the CLI shell to the Sakura semantic palette and primitive kit: selection rows, tab/segmented controls, switches, progress bars, heatmaps, context cards, preview rails, action lists, state blocks, headers, and responsive layout helpers are now shared instead of duplicated.
  - Rebuilt the launch, loading, active playback, post-playback, browse idle, search/details, discover, calendar, history, library, downloads, setup, diagnostics, settings, help, and picker surfaces around calmer hierarchy and fewer bordered/card-heavy layouts.
  - Added a keybinding registry as the source of truth for help and stable footer hints. Help no longer drifts from runtime shortcuts, browse hotkeys no longer hijack the search input, command palette rows are width-aware, and footer keys use consistent glyph/label treatment.
  - Added zen mode and `--zen` support with single-column behavior across browse, library, downloads, and offline shelves.
  - Added viewport policy and resize blocking for terminals that are too narrow, plus more stable medium/wide/narrow layout snapshots for the shell surfaces.
  - Improved browse and discover with focus zones, filter chips, per-section discovery rails, rerollable discovery sections, typed empty states, preview rails, artwork, and safer command-palette overlay behavior.
  - Improved calendar with day strip navigation, type tabs, release-state copy, cached schedule rows, airing-vs-available separation, and row widths that avoid overlap.
  - Improved post-playback with four-state post-play modeling, queue-aware Up Next, clean replay/episode/search/fallback actions, title detail artwork, next-episode stills, and caught-up recommendation behavior.
  - Improved history and continue watching with grouped rows, progress bars, poster fallback blocks, continue/restart actions, new-episode labels, mark-as-watched, and stable row selection.

  **Lists, queue, sync, attention, and stats**

  - Added list, watchlist, favorites, playlist, queue, stats, and sync service/repository foundations with command-palette workflows and shell panels.
  - Added durable queue recovery and queue restore behavior that explicitly moves pending items without autoplaying them.
  - Added queue planning, queueable post-playback recommendations, playlist import/export, playlist projection, and safe media identity contracts that avoid storing raw stream URLs in durable exports.
  - Added local stats and streak UI, watch-kind filters, heatmaps, share-card formatting, status crumb badges, weekly digest/sync health indicators, and streak milestone/at-risk surfaces.
  - Added notification/attention foundations: notification inbox, action router, actionable release/download/queue notices, followed-title and refresh-budget services, and release availability rules that do not equate aired with playable.
  - Added sync service seams for AniList/TMDB, sync token storage via atomic secret JSON, protocol handoff registration, and safe handoff URL parsing for local actions.

  **Continuation, history, release calendar, and catalog data**

  - Added canonical HistoryProgress usage through offline shelves, resume-from-history, episode pickers, cleanup, runway planning, and continuation services; retired lossy/dead JSON history/cache implementations where the SQLite path is now authoritative.
  - Added continuation read models and Netflix-style anchoring: caught-up/continue decisions anchor on the most-recent episode, finished older episodes do not make ongoing series look complete, and movies are handled separately from episodic chains.
  - Added release reconciliation and schedule progress caching: AniList sequel/cross-cour detection, TMDB later-season detection, new-season signals, release progress cache, date-only release boundaries, and background reconciliation services.
  - Added title detail services for season/episode summaries, episode thumbnails, poster/still sizing, provider-native release badges, and non-blocking warm-cache peeks.
  - Added browse result enrichment for watched/downloaded/local/next-release/provider metadata without unnecessary provider calls.

  **Offline downloads and local library**

  - Added durable download queue behavior with storage admission, per-job destination overrides, media-server friendly output paths, progress parsing, retries, pause/abort semantics, repair sweeps, and startup recovery.
  - Added download artifact states that distinguish completed video from expected/optional sidecar problems. Subtitle/artwork sidecars can be repaired without redownloading a valid video.
  - Added offline asset manifests, offline title policies, offline maintenance jobs, runway planning, capacity bounds, and local-only continuation behavior so offline mode does not silently fall back to provider calls.
  - Added hardsub/subtitle language preservation, selected source/stream/quality metadata on enqueue, fresh stream re-resolution before download processing, and provider source intent preservation across downloads.
  - Removed `ffmpeg` from the active runtime dependency path for this release. Kunai no longer spawns `ffmpeg` for local video thumbnails; offline artwork uses cached poster assets when available, and `ffprobe` remains optional for post-download validation.
  - Updated installer, setup copy, root README, package README, user docs, and release docs so `mpv` is the required playback dependency, `yt-dlp` gates downloads, `ffprobe` is optional validation, and `ffmpeg` is not presented as needed for normal Kunai use.

  **Diagnostics, support bundles, and runtime feedback**

  - Added correlated diagnostic events, operation taxonomy, background task diagnostics, runtime health summaries, memory trend reporting, resolve work evidence, provider selection decisions, playback startup timelines, and redacted support bundle fields.
  - Added `--debug-session`, safer `/export-diagnostics` and `/report-issue` flows, redaction boundary tests, and diagnostics panels that group state into scannable verdict sections.
  - Added runtime memory and mpv child-process feedback where the platform exposes it, plus docs explaining what is measured and when values can be unavailable.
  - Added redaction scope documentation and support-bundle privacy handling so provider/cache/source evidence is useful without leaking stream URLs or local secrets.

  **Docs, package, and CI/release readiness**

  - Added the docs app, public user/developer docs, docs home page, docs search route, install/update docs, command/shortcut docs, playback/offline/diagnostics/runtime feedback docs, and docs maintenance guidance.
  - Fixed the docs CI build by narrowing Fumadocs to the public `docs/users` and `docs/developer` trees. Internal `docs/superpowers` plans/specs remain repository context, not public MDX pages requiring published frontmatter.
  - Added CI coverage for docs build and package check, release dry-run installer guidance, package README updates, and a generated 0.2.0 changeset path.
  - Updated release verification around `bun run ci`, `bun run build`, `bun run build:docs`, `bun run pkg:check`, and `bun run release:dry-run`.
  - Added and expanded tests across app-shell snapshots, playback services, provider contracts, storage repositories, download/offline behavior, diagnostics, catalog/release reconciliation, sync/list/queue/stats services, and docs rendering.

## 0.1.4

### Patch Changes

- Ship the production-readiness playback and diagnostics pass.

  Highlights:

  - Route playback recovery through a shared policy so guided, manual, and fallback-first modes behave predictably.
  - Detect slow-but-still-healthy playback separately from dead streams, avoiding premature provider cycling while keeping refresh/fallback actions available.
  - Make provider fallback smarter by filtering incompatible media kinds, skipping known-down providers automatically, and allowing explicit provider selections to try once.
  - Improve cache safety with shorter stale windows, stale health validation, abortable health checks, provider validation for prefetched streams, and better prefetch handoff.
  - Add network-aware offline suggestions that avoid blaming providers for local connectivity problems.
  - Add recovery mode settings, redacted diagnostics export/report issue drafts, and `--debug-session` for developer repro traces and breakpoint workflows.
  - Cache downloaded poster artwork locally with deduped in-flight work so offline library previews preserve the online feel without hidden network work.
  - Add deterministic provider/player harness coverage and document opt-in live provider smoke checks.
  - Polish command/browse picker behavior, fuzzy ranking, aliases, command highlight styling, and responsive poster previews.

## 0.1.3

### Patch Changes

- [`a88659d`](https://github.com/KitsuneKode/kunai/commit/a88659d843251c6fe2a87cffb213dc0670dd6d7f) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Improve the terminal UX around discovery, offline watching, playback recovery, diagnostics, and minimal startup flows.

  Discovery now preserves artwork on release-calendar entries, expands anime `/calendar` into a cached 7-day AniList airing window with day headers, time columns, episode badges, popularity/score metadata, and provider-backed playback mapping, exposes discover/offline/download/filter commands from browse, adds `--discover`, and makes `/random` / `/surprise` use a cached randomized catalog pool instead of only reshuffling trending picks. Search also has guided filter chips, including local/downloaded/watched/release/provider chips, so richer queries can be built without blocking result browsing.

  Offline mode now behaves more like a local library: rows are grouped by title, show clearer shelf metadata, include local availability in search context, expose queue/online handoff actions, support title-level integrity/repair/delete/protect actions, persist poster and IntroDB/AniSkip timing metadata for downloads, cache best-effort poster artwork for local previews, and work with the new `--zen --offline` minimal shelf flow.

  Local and online playback now share a clearer source-selection boundary: offline rows never trigger provider resolution implicitly, cached local browse filters can narrow already-loaded results by downloaded/watched/release/provider facts without extra provider calls, `--continue` and history launches record exact ready local matches without hijacking the online flow, broken local artifacts surface repair guidance, and downloaded playback follows the same autoskip settings as streamed playback.

  Playback and diagnostics are clearer: provider fallback attempts are recorded as a bounded timeline, active playback now shows the exact provider identity, recover is described as a stream refresh/resume action, replay/restart is kept as a true start-from-beginning action, suspected dead-stream EOFs invalidate cached URLs and refresh the source instead of looping on stale cache, anime caught-up screens fall back to discover recommendations instead of TMDB-only title recommendations, long picker selections are clamped and highlighted consistently after result changes, next-episode prefetch now starts near known credits timing when available, command palette rows are width-aware, details panels use cleaner selection/local/details/synopsis/availability sections, diagnostics/report exports are pruned, smoke-test recipes are available from Diagnostics, and loading status copy no longer presents healthy subtitle attachment or provider retry progress as an error.

  Release documentation now includes a feature tour, expanded onboarding/playback/offline guidance, and VHS demo scripts for onboarding, discovery, offline, diagnostics, and launch-story capture.

## 0.1.2

### Patch Changes

- [`2347594`](https://github.com/KitsuneKode/kunai/commit/234759479d579ceb18f3b7454af61412c53f4a91) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Stabilize Discord Rich Presence on Bun by routing RPC over a lightweight Node IPC bridge, and improve settings UX with explicit status plus connect/reconnect behavior.
