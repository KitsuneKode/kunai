# Kunai 0.3.0

[`15cac9e`](https://github.com/KitsuneKode/kunai/commit/15cac9e0c1dbc91c957d0b2133a515b7585803e6) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Keep the anime auto-skip and provider-relay paths working after upstream rotations.

- AniSkip now resolves a MAL id for AniDB titles, so opening and ending skips work on the default anime provider instead of silently never firing. The lookup shares the provider package's Cloudflare-aware transport and overlaps stream resolution, so it adds no serial request to playback start.
- AllAnime tracks the upstream `mkissa` rotation to build 119 and 7-day epochs; the previous constants failed every stream request with `AA_CRYPTO_MISSING_BUILD`.
- A relay no longer strips the provider-auth headers (`x-build-id`, `x-aa-boot`, `x-obfuscated`, `x-session-token`) that AllAnime bootstrap and Miruro decoding depend on, which previously made every bootstrap through a relay fail with `invalid_boot_token`.
- A Miruro request blocked by Cloudflare now names the user-owned relay workaround rather than reporting an unexplained failure.

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

The 0.2.6 development cycle was versioned but never published, so its work reaches users for the first time in 0.3.0:

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

[`135517c`](https://github.com/KitsuneKode/kunai/commit/135517c2e1fe8225c501f4246fec41884233ce43) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - AllAnime now reports a captcha-gated stream request as a blocked, non-retryable failure naming the relay workaround, instead of silently returning no streams next to a full episode list. It is also demoted out of the automatic anime fallback lane while staying manually selectable.

[`4186bf2`](https://github.com/KitsuneKode/kunai/commit/4186bf2d85a6b3e70cba03ad404b62a9b588af2f) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Keep anime films in the anime profile while preserving their movie structure through history, downloads, and offline playback. Unknown one-shot anime formats now stay episodic until their episode count is known, and HTML cleanup cannot turn encoded markup back into tags.

[`0fc67a3`](https://github.com/KitsuneKode/kunai/commit/0fc67a37bdb1536039e80e68df8b884e9038bf6e) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Repair the default AniDB anime route across current browse parsing, provider-native identity, season and absolute-episode routing, and production-derived release signoff.

[`0c3c735`](https://github.com/KitsuneKode/kunai/commit/0c3c7357d85b640f4c962035a2f04bff544f940b) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Report `curl` in `kunai doctor` and setup. AniDB is the default anime provider and needs a curl (plain or curl-impersonate) to get past Cloudflare, so its absence could previously make anime search return nothing with no diagnostic anywhere.

[`0f20cf4`](https://github.com/KitsuneKode/kunai/commit/0f20cf463940aac27821da836d3a11b3358da336) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Present movie, series, anime, and video positions consistently; persist movie downloads as title-level jobs; and keep download and calendar surfaces responsive through width, poster, loading, retry, and cancellation changes.

[`4186bf2`](https://github.com/KitsuneKode/kunai/commit/4186bf2d85a6b3e70cba03ad404b62a9b588af2f) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Make anonymous usage analytics explicit opt-in. Setup now defaults to off, Settings can enable or disable collection, and disabling removes the local install identifier.

### Privacy

- Do not send analytics before consent, without an interactive terminal, or when DNT or CI blocks it.
- Leave the production endpoint disabled until an operator configures and verifies one.

[`35aa301`](https://github.com/KitsuneKode/kunai/commit/35aa301b78b79eca17c16c697d139756f0394da1) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Recover active playback from transient buffer, stall, and seek states while rejecting stale mpv cycle events and presence updates.

[`3bf6d33`](https://github.com/KitsuneKode/kunai/commit/3bf6d33054d72cd0fe2b19875099dc2cc746b64f) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Make Miruro resolution evidence truthful: stream reachability is attested only from an explicit probe, AniList identity is parsed once and strictly, the server try order has a single authority, every pipe decode stage raises its own redacted failure code, and subtitle format is inferred from evidence instead of defaulting to SRT.

[`099e040`](https://github.com/KitsuneKode/kunai/commit/099e0409281363bd3cce3e2a347cfc38664fa537) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Route every poster through one bounded Bun-native preparation seam, add iTerm2/VS Code inline images, and remove the chafa and ImageMagick runtime requirements. Posters now need nothing installed on any supported terminal.

[`05e97ee`](https://github.com/KitsuneKode/kunai/commit/05e97eed95991172b2ef33bfe6a9cf8f3e85dc20) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Recognize Bun connection failures as offline, keep confirmed offline state until a successful request, and return failed searches with visible retry and offline-library guidance instead of silently replaying them.

[`68b0a5f`](https://github.com/KitsuneKode/kunai/commit/68b0a5f45ebf349a342c3b7cd4643e98c48ef6f8) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Keep verified offline downloads on their trusted local media and subtitle paths, without provider recovery or remote playback metadata requests, and harden cancellation and reconnect handling around the mpv handoff.

[`6a952d8`](https://github.com/KitsuneKode/kunai/commit/6a952d8044288f5ff58bebf269d3e609369f1506) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Make the shell's own surfaces reachable and readable at the terminal sizes people actually use.

- `/analytics` and `/presence` answered "no matching commands" from the resume and starting-point pickers while the footer still advertised `[/] commands`. Both govern data leaving the machine, so being told they do not exist was the wrong answer. Picker command sets now come from one registry context instead of three hand-written arrays that had drifted apart.
- The Settings section tabs were unreadable at 80 columns: twelve names were squeezed into two-character stumps that wrapped onto a second line, hiding which sections exist. The strip now scrolls around the active section, which is always shown in full, with `‹`/`›` marking what is off-screen.

[`4186bf2`](https://github.com/KitsuneKode/kunai/commit/4186bf2d85a6b3e70cba03ad404b62a9b588af2f) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Rebuild tracker sync on a generation-safe SQLite outbox with typed tracker
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

[`8a07e00`](https://github.com/KitsuneKode/kunai/commit/8a07e00812b3ecf073f87b38d2eb9759db028025) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Harden Videasy's active path: TMDB identity must be a complete positive decimal, the selected-route cache policy has a single owner instead of being silently rebuilt, and Wings seed transport state is bounded. Cancelling a playback no longer marks both Wings hosts unhealthy for five minutes.

Harden installers and release asset completion checks.

- `install.sh` / `install.ps1` `--dry-run` / `-DryRun` compute paths without creating directories.
- Empty or incomplete release assets fail with specific messages and npm / Bun / source / pinned-version recovery guidance.
- GitHub Releases require all eight binaries plus `SHA256SUMS` (`fail_on_unmatched_files`, post-upload contract assertion).

Ship the npm postinstall registration hook in the published tarball and verify a clean global install, update check, and package-manager uninstall.

Ship the npm package as a minimal Node launcher with exact-version optional
platform binaries, and preserve the correct npm or Bun managed-install
ownership in the compiled CLI.
