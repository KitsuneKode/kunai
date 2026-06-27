# Changelog

## v0.2.6

0.2.6 — 2583ec8: Ship the post-0.2.5 Kunai release train.

This release includes the YouTube provider lane with Invidious/Piped/ytsearch metadata, yt-dlp playback gating, playlist/channel selection, live/upcoming handling, SponsorBlock/cookie settings, metadata cache, diagnostics probes, download/playback parity, video watch-history stats, and an opt-in live YouTube smoke.

It also rolls up the unreleased CLI work since 0.2.5: persistent playback and mpv lifecycle hardening, provider fallback and endpoint-health diagnostics, share links and `kunai://` round trips, offline/download library improvements, watch-ledger stats and continuation identity reconciliation, queue/playlist/notification/calendar/detail surfaces, settings-shell polish, storage migrations, native installer/update/release-note infrastructure, docs truth-sync, and package/build reliability gates.

Release notes should call out that YouTube playback requires `yt-dlp`, YouTube age-restricted content requires user-supplied cookies, provider relay remains user-owned, live provider smokes are opt-in, and the release gate now includes deterministic checks plus targeted provider reality checks.

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
