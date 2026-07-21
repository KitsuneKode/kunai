# Changelog

## v0.3.0

Show posters on every terminal, including Windows.

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

Playback reliability, calendar navigation, and shell responsiveness.

- Startup source failover walks the ordered source list before hopping providers, so a dead stream retries the next source instead of looping the same one.
- Resolve cancellation is honest end to end: abort reasons ride on the signal, late feedback from a cancelled resolve is dropped, and a stream that arrives after cancellation is never handed to mpv.
- Every exit routes through one phased shutdown coordinator with conventional exit codes (130/143/129), quiescing services and preserving playback, config, queue, and download state before disposal.
- Calendar navigation scrolls minimally instead of re-anchoring on every keypress, fixing the sliding rows and laggy arrows.
- The title-control menu (`m`) opens during playback instead of rendering underneath it, and cancel stays live across the whole bootstrap and failure window.
- The episode picker no longer collapses to a single entry when a provider listing fails or when continuing from history.
- Miruro resolves against the working mirrors only; Videasy reorders its first-phase servers and segment-probes HLS before attesting reachability.
- Search shows a query-aware loading skeleton, post-play artwork retries after a transient fetch failure, and quitting no longer pauses autoplay.
- Provider fallback moves to a deliberate `Shift+F` chord so a stray keypress cannot switch providers mid-session.

Harden installers and release asset completion checks.

- `install.sh` / `install.ps1` `--dry-run` / `-DryRun` compute paths without creating directories.
- Empty or incomplete release assets fail with specific messages and npm / Bun / source / pinned-version recovery guidance.
- GitHub Releases require all eight binaries plus `SHA256SUMS` (`fail_on_unmatched_files`, post-upload contract assertion).

Ship the npm postinstall registration hook in the published tarball and verify a clean global install, update check, and package-manager uninstall.

## v0.2.6

### Highlights

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

### Before you upgrade

- YouTube playback needs `yt-dlp` on your `PATH`.
- Age-restricted YouTube content needs cookies you supply yourself.
- The provider relay stays user-owned — Kunai ships no shared public relay.

## v0.2.5

A large reliability + experience pass: continuous play, offline parity, smarter
anime classification, a rebuilt calendar, downloads that don't eat your RAM, and
a long tail of UX fixes.

### Highlights

- **Continuous play (Up Next).** Auto-continue into the next episode → your queue
  → a recommendation when caught up (cancelable countdown). `/queue` opens the Up
  Next panel; reorder queued items (move up/down); save the queue as a playlist;
  import/export.
- **Offline parity.** Downloaded episodes now play through the _same_ path as
  online — full resume **offer** (not a forced seek), auto-skip, OSD, track
  control, autoplay into the next downloaded episode, and history.
- **Smarter anime.** Deterministic TMDB anime classifier (research-validated)
  tags results as _Anime_; it is authoritative for the persisted content kind, so
  an anime watched via a series provider is still classified as anime. Fix a wrong
  label any time with `/mark-anime` · `/mark-series`.
- **Rebuilt calendar.** Rolling ±7-day schedule (past week + upcoming), type tabs
  (All/Anime/Series/Movies/Tracked), per-day navigation, `/anime-calendar` and
  `/series-calendar` shortcuts, boxed day chips with a distinct _today_ highlight,
  and aligned columns that no longer shift on long titles.
- **Share links.** `/share` copies a catalog-anchored `kunai://` URL for the current title;
  `/watch` opens a `kunai://` link from your clipboard. Use `kunai --open` for trusted terminal launch.

### Features

- Up Next: auto-continue (episode → queue → recommendation), queue reorder,
  `/queue` panel, active-playback "up next" hint.
- Offline: persistent-play pipeline, autoplay into next downloaded, partial-download
  badges (`↓ n/total`), availability index, pause-on-quit + auto-resume on return.
- Downloads: parallel N-worker pool (`maxConcurrentDownloads`, default 3, 1–5).
- Anime: TMDB classifier + "Anime" label, `/mark-anime` / `/mark-series` override,
  Miruro server labels.
- Calendar: 7-day past archive (+ prune), `/anime-calendar` / `/series-calendar`,
  `useCalendarState` hook.
- OSD: resume prompt anchored top-right; dismiss (Esc / left-click) and resume
  (Enter / middle-click).
- Tracks: `/audio` + `/subtitles` deep-links, favorite sources (auto-select prefers
  them), two-pane tracks panel.
- Settings: persist-on-change (no Ctrl+S), red destructive rows.
- CLI: `--help` / `--version`.

### Fixes

- **Config:** an explicit `vidking` provider choice now persists (was reverted every
  load).
- **Progress:** episode progress and series progress are now separate — finishing
  one episode no longer mislabels a whole series "Completed"; `unknown` release
  state → Continue, not falsely Completed.
- **Downloads:** runaway RAM + orphaned `yt-dlp` fixed (bounded fragment buffering,
  SIGKILL children on exit, socket timeout).
- **Calendar:** chronological day strip, no phantom "Nothing on schedule" days,
  enter-at-today navigation, no layout shift on long titles, ±7-day clamp.
- **Classification:** content-derived kind on the write path (drama-on-anime-provider
  no longer labeled anime).
- **Presence:** Discord shows a real progress bar only when duration is known.
- **Library:** offline episodes ordered by season/episode, not download time.
- **Playback:** failed-to-start stream no longer pauses autoplay; single-season
  episode-list escape no longer loops.
- **AllManga:** correct thumbnail CDN; ak-only fallback capped at 4s; next-episode
  prefetch no longer voided by a `startupPriority` mismatch.

### Performance

- App-shell list passes combined; independent cleanup + recommendation profiling
  parallelized; duplicate history fetch removed; O(n) offline-status grouping;
  trimmed preview/calendar model work.
