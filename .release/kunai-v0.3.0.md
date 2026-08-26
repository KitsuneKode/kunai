# Kunai 0.3.0

Make shared playback targets easy to open outside an existing Kunai install.

- Copy browser-safe, catalog-anchored HTTPS links from `/share` and mpv.
- Add a stateless web handoff with native install guidance and no share-page analytics.
- Accept compact checksummed share codes and render scannable HTTPS QR codes with `/share --qr`.

Persist expensive provider intermediate data across restarts.

- Add a general `ProviderCachePort` (namespace + TTL) to the provider runtime
  context, backed by a SQLite `provider_cache` table, so a provider's expensive
  but stable intermediate data survives a restart instead of dying with the
  process.
- Miruro's episode catalog now reads memory → persistent → network, so the cold
  Cloudflare-gated pipe call (~6–13s) is paid once per catalog per TTL rather
  than once per session.

- The persist TTL is derived from the catalog's own air dates: a finished show
  persists for 12h, while an airing show persists until its approximate next air
  date (clamped to 2h–1 week), so a newly-aired episode is never hidden behind a
  stale cache.
- Only a non-empty catalog is persisted; a failed or empty body is never cached.
  The cache degrades to a no-op on any store error — a broken cache slows a
  resolve, never fails it. Stream/source URLs stay in-memory and are never
  persisted.

Warm the top anime result's episode cache during search.

- After an anime search, Kunai warms the persistent episode cache for the single
  top anime result in the background, so the Cloudflare-gated catalog fetch
  (~6s) is already paid by the time you pick it. It is fire-and-forget — it never
  blocks, delays, or fails the search — deduped so a title is warmed once per
  session, and limited to one gated call per search to stay gentle on the WAF.

Keep the anime auto-skip and provider-relay paths working after upstream rotations.

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

Retire the dead Videasy seed mirror and cover every production provider in the live matrix. `api.wingsdatabase.com` is NXDOMAIN on public resolvers and could never win the seed race, so it only spent a request slot and then occupied the host penalty box after every cold resolve. The live matrix now exercises all seven registered providers, including the default anime lane, which it previously skipped.

Give the Discord presence card a play button distinct from the catalog link. For a movie, or an anime known only by an AniList id, the poster, title, state row, and single button all resolved to one identical URL, and the play target was reachable only as presence text. Presence now leads with **Play on Kunai** over the https web-share route, and links the state row only when the episode page is a different destination.

Make `kunai diagnostics recent` readable in a terminal. A new `pretty` format groups events under a date heading, prints each session id once per run, and renders context as `key=value`. It is the default only when stdout is a terminal, so a pipe or redirect still receives `jsonl`. Colour follows the terminal and respects `NO_COLOR` and `--no-color`.

Reject untrusted or downgraded HLS relay redirects before requesting them, and bound yt-dlp streaming output.

Bound GitHub and npm update-metadata requests to 15 seconds, use the injected request path for every install channel, and reject malformed registry versions.

Preserve exact provider-native anime episode identities from catalog selection through playback, caching, downloads, and offline recovery.

- Keep Kunai's episode picker 1-based while resolving AllAnime episode zero, OVA, and special labels with their exact provider values.
- Prevent cache, selection, prefetch, dead-stream, download, and offline-library state from aliasing different provider episodes at the same UI position.
- Preserve existing numeric fallback behavior for legacy downloads and selections that predate provider-native episode identity storage.

Rebuild first-run setup as seven framed slides that write what they ask for: every control starts from your current configuration, so rerunning `/setup` no longer disconnects linked AniList or TMDB accounts or rewinds preferences to factory defaults; the language choice reaches anime, shows, films, and YouTube alike; `[s]` applies the slide's recommendation instead of committing whatever the cursor sat on; leaving asks before discarding answers and re-offers setup next launch if you left on the first slide; and tracker sync is only marked enabled once the browser handoff actually succeeds. The usage-ping slide stays recommended and pre-selected, and remains impossible to enable by skipping, accepting all defaults, or stepping onto the slide and back off it.

Serialize native installer activation across the in-process updater and the Bash and PowerShell installers, preserving launcher and manifest consistency during concurrent upgrades and recovery failures.

Download verified platform archives for native self-updates, safely extract one bounded executable in-process, and preserve rollback-compatible provenance while migrating schema-1 install manifests.

Install verified compressed native release assets from Bash and PowerShell, reject unsafe or oversized archive contents, and retain a 404/410-only fallback for older raw releases.

Redact standalone opaque credential values from diagnostics even when an upstream field uses an unrecognized name.

Keep unexpected background download-queue failures inside the download
subsystem so they cannot terminate playback.

YouTube plays at the quality you chose on the persistent player path. The format selector was set on mpv's `ytdl` option, which is a yes/no flag — mpv answered `unsupported format for accessing property` and dropped it, so the ceiling silently never applied while the spawn path honoured it. The two player paths now agree.

Tracker credentials are private on Windows and survive a power cut everywhere. The owner-only permission was applied under a POSIX-only branch, so on Windows `sync-tokens.json` and `config.json` kept whatever `%APPDATA%` inherited; they now get an inheritance-free, user-only ACL. Neither file was ever flushed either, so an atomic rename could reach the journal while the data sat in the page cache — a power loss left a correctly named, empty config. Both are now flushed before the rename and the directory entry after it.

`-i/--id` no longer leaves a placeholder title in your history, and a partial write can no longer erase external ids that were already resolved. Continue-watching rows keep the identity they were saved with.

A malformed Discord IPC frame can no longer end your session. Rich Presence is optional, but a bad frame from the socket could terminate playback or grow memory without a bound; the frame reader is now contained and bounded, and a presence failure degrades to no presence instead of taking the player with it.

Choosing a title shows the loader while it resolves, instead of a still screen that looked like nothing had happened.

AllAnime now reports a captcha-gated stream request as a blocked, non-retryable failure naming the relay workaround, instead of silently returning no streams next to a full episode list. It is also demoted out of the automatic anime fallback lane while staying manually selectable.

Keep anime films in the anime profile while preserving their movie structure through history, downloads, and offline playback. Unknown one-shot anime formats now stay episodic until their episode count is known, and HTML cleanup cannot turn encoded markup back into tags.

Repair the default AniDB anime route across current browse parsing, provider-native identity, season and absolute-episode routing, and production-derived release signoff.

Report `curl` in `kunai doctor` and setup. AniDB is the default anime provider and needs a curl (plain or curl-impersonate) to get past Cloudflare, so its absence could previously make anime search return nothing with no diagnostic anywhere.

Present movie, series, anime, and video positions consistently; persist movie downloads as title-level jobs; and keep download and calendar surfaces responsive through width, poster, loading, retry, and cancellation changes.

Make anonymous usage analytics explicit opt-in. Setup now defaults to off, Settings can enable or disable collection, and disabling removes the local install identifier.

### Privacy

- Do not send analytics before consent, without an interactive terminal, or when DNT or CI blocks it.
- Leave the production endpoint disabled until an operator configures and verifies one.

Recover active playback from transient buffer, stall, and seek states while rejecting stale mpv cycle events and presence updates.

Make Miruro resolution evidence truthful: stream reachability is attested only from an explicit probe, AniList identity is parsed once and strictly, the server try order has a single authority, every pipe decode stage raises its own redacted failure code, and subtitle format is inferred from evidence instead of defaulting to SRT.

Route every poster through one bounded Bun-native preparation seam, add iTerm2/VS Code inline images, and remove the chafa and ImageMagick runtime requirements. Posters now need nothing installed on any supported terminal.

Recognize Bun connection failures as offline, keep confirmed offline state until a successful request, and return failed searches with visible retry and offline-library guidance instead of silently replaying them.

Keep verified offline downloads on their trusted local media and subtitle paths, without provider recovery or remote playback metadata requests, and harden cancellation and reconnect handling around the mpv handoff.

Make the shell's own surfaces reachable and readable at the terminal sizes people actually use.

- `/analytics` and `/presence` answered "no matching commands" from the resume and starting-point pickers while the footer still advertised `[/] commands`. Both govern data leaving the machine, so being told they do not exist was the wrong answer. Picker command sets now come from one registry context instead of three hand-written arrays that had drifted apart.
- The Settings section tabs were unreadable at 80 columns: twelve names were squeezed into two-character stumps that wrapped onto a second line, hiding which sections exist. The strip now scrolls around the active section, which is always shown in full, with `‹`/`›` marking what is off-screen.

Rebuild tracker sync on a generation-safe SQLite outbox with typed tracker
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

Harden Videasy's active path: TMDB identity must be a complete positive decimal, the selected-route cache policy has a single owner instead of being silently rebuilt, and Wings seed transport state is bounded. Cancelling a playback no longer marks both Wings hosts unhealthy for five minutes.

Harden installers and release asset completion checks.

- `install.sh` / `install.ps1` `--dry-run` / `-DryRun` compute paths without creating directories.
- Empty or incomplete release assets fail with specific messages and npm / Bun / source / pinned-version recovery guidance.
- GitHub Releases require all eight binaries plus `SHA256SUMS` (`fail_on_unmatched_files`, post-upload contract assertion).

Ship the npm postinstall registration hook in the published tarball and verify a clean global install, update check, and package-manager uninstall.

Ship the npm package as a minimal Node launcher with exact-version optional
platform binaries, and preserve the correct npm or Bun managed-install
ownership in the compiled CLI.
