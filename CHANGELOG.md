# Changelog

## v0.4.0

[`9d94664`](https://github.com/KitsuneKode/kunai/commit/9d946648ca253965fa88c485be448e81c2a1f470) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Make shared playback targets easy to open outside an existing Kunai install.

### Features

- Copy browser-safe, catalog-anchored HTTPS links from `/share` and mpv.
- Add a stateless web handoff with native install guidance and no share-page analytics.
- Accept compact checksummed share codes and render scannable HTTPS QR codes with `/share --qr`.

[`d5f25ae`](https://github.com/KitsuneKode/kunai/commit/d5f25ae6dca966237d886ba5c006fd92dfe6a175) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Persist expensive provider intermediate data across restarts.

### Features

- Add a general `ProviderCachePort` (namespace + TTL) to the provider runtime
  context, backed by a SQLite `provider_cache` table, so a provider's expensive
  but stable intermediate data survives a restart instead of dying with the
  process.
- Miruro's episode catalog now reads memory → persistent → network, so the cold
  Cloudflare-gated pipe call (~6–13s) is paid once per catalog per TTL rather
  than once per session.

### Behavior

- The persist TTL is derived from the catalog's own air dates: a finished show
  persists for 12h, while an airing show persists until its approximate next air
  date (clamped to 2h–1 week), so a newly-aired episode is never hidden behind a
  stale cache.
- Only a non-empty catalog is persisted; a failed or empty body is never cached.
  The cache degrades to a no-op on any store error — a broken cache slows a
  resolve, never fails it. Stream/source URLs stay in-memory and are never
  persisted.

[`a53b62d`](https://github.com/KitsuneKode/kunai/commit/a53b62d8de7db4166a54d0b60a58938b4918c52f) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Warm the top anime result's episode cache during search.

### Features

- After an anime search, Kunai warms the persistent episode cache for the single
  top anime result in the background, so the Cloudflare-gated catalog fetch
  (~6s) is already paid by the time you pick it. It is fire-and-forget — it never
  blocks, delays, or fails the search — deduped so a title is warmed once per
  session, and limited to one gated call per search to stay gentle on the WAF.

[`ed39d07`](https://github.com/KitsuneKode/kunai/commit/ed39d07dcdbe5ce5572faaefaa3cd229a85004ef) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Give the Discord presence card a play button that is distinct from the catalog link.

### Fixes

- The presence card exposed four clickable surfaces resolving to at most two
  destinations, and the play target was not one of them. For a movie, or an
  anime known only by an AniList id, the poster, title, state row, and the
  single button all collapsed onto one identical URL, because neither has a
  distinct episode page for `state_url` to point at.
- `state_url` is now set only when the episode page is a different destination
  from the title page, so the title and state rows stop repeating one link.

### Behavior

- Presence now fills both button slots Discord allows: **Play on Kunai**,
  carrying the https web-share URL for the live playback target, followed by the
  catalog button. The catalog button is dropped when it would resolve to the
  play target.
- The play button uses the web-share route rather than the `kunai://` ref
  because Discord rejects any button URL that is not http(s); the web route
  hands off to `kunai://` on open. A title with no catalog ids still gets the
  play button, where it previously got no buttons at all.
- The `kunai://` ref stays in the presence state line and in `playable_ref`, so
  copy-paste is unchanged. Private-privacy playback still emits no buttons.

[`db71c33`](https://github.com/KitsuneKode/kunai/commit/db71c332a13eba5081dd877951e784b6bd44b3ed) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Preserve exact provider-native anime episode identities from catalog selection through playback, caching, downloads, and offline recovery.

### Fixes

- Keep Kunai's episode picker 1-based while resolving AllAnime episode zero, OVA, and special labels with their exact provider values.
- Prevent cache, selection, prefetch, dead-stream, download, and offline-library state from aliasing different provider episodes at the same UI position.
- Preserve existing numeric fallback behavior for legacy downloads and selections that predate provider-native episode identity storage.

[`443111a`](https://github.com/KitsuneKode/kunai/commit/443111a7fccb49b58449c9feb953f520bdcd7694) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Reject untrusted or downgraded HLS relay redirects before requesting them, and bound yt-dlp streaming output.

[`2e7f4d9`](https://github.com/KitsuneKode/kunai/commit/2e7f4d946df82285789c8ca94309240734baf3d9) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Make `kunai diagnostics recent` readable in a terminal.

### Features

- Add a `pretty` format that lays each event out as a timestamped header, its
  message, and its context as `key=value` pairs. Events group under a date
  heading and a session id heads its run rather than repeating on every line.
- `pretty` is the default only when stdout is a terminal. A pipe or redirect
  still receives `jsonl`, so `kunai diagnostics recent > report.jsonl` and
  `| jq` are unchanged. `--format` always overrides.
- Colour follows the same terminal signal and is disabled by `NO_COLOR` or
  `--no-color`; `--color` forces it on for a pipe that wants escapes. Only
  16-colour SGR is used, which terminals reporting no `COLORTERM` still render.

### Behavior

- Every context key is printed, but the ones that repeat with the same value on
  nearly every event (`status`, `severity`, `recommendedAction`, `spanFamily`)
  sort last so the fields that differ lead the line.
- Oversized values are sampled with an explicit count — one real
  `skippedReasons` array runs to 82 entries and roughly two thousand characters.
  `jsonl` and `markdown` remain lossless.

[`87408d9`](https://github.com/KitsuneKode/kunai/commit/87408d95d188fd0ea72d8f8579d67828ffba2fde) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Retire the dead Videasy seed mirror and cover every production provider in the live matrix.

### Fixes

- Remove `api.wingsdatabase.com` from the Videasy seed rotation. The name is
  NXDOMAIN on both Cloudflare and Google resolvers and the surviving apex does
  not serve `/seed`, so it could never win the seed race — it only spent a
  request slot and then occupied the five-minute host penalty box after every
  cold resolve, which read as a redundant pair while offering no redundancy.
  `api.speedracelight.com` remains the live host and is unaffected.

### Behavior

- The seed transport still races N hosts and now takes an injected host list, so
  a live mirror can be added back to `WINGS_API_BASES` without reintroducing a
  second constant. A preferred-host cache entry can no longer resurrect a host
  that is no longer configured.
- `bun run test:live:matrix` now covers all seven providers that
  `loadProductionProviderModules()` registers. It previously skipped `vidlink`
  and `anidb` — and `anidb` is the default anime lane the release signoff
  depends on, so an outage there would have reported a green matrix.

[`1ee8d09`](https://github.com/KitsuneKode/kunai/commit/1ee8d09e3e3dee98d06f89334f816587352102e1) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Rebuild first-run setup as seven framed slides that write what they ask for: every control starts from your current configuration, so rerunning `/setup` no longer disconnects linked AniList or TMDB accounts or rewinds preferences to factory defaults; the language choice reaches anime, shows, films, and YouTube alike; `[s]` applies the slide's recommendation instead of committing whatever the cursor sat on; leaving asks before discarding answers and re-offers setup next launch if you left on the first slide; and tracker sync is only marked enabled once the browser handoff actually succeeds. The usage-ping slide stays recommended and pre-selected, and remains impossible to enable by skipping, accepting all defaults, or stepping onto the slide and back off it.

[`1523ec7`](https://github.com/KitsuneKode/kunai/commit/1523ec7b77dff4657abee917f962f625b17b3c62) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Bound GitHub and npm update-metadata requests to 15 seconds, use the injected
request path for every install channel, and reject malformed registry versions.

[`91cca8a`](https://github.com/KitsuneKode/kunai/commit/91cca8adface511dc5b5033fabd3e1b9aa78af6e) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Serialize native installer activation across the in-process updater and the Bash and PowerShell installers, preserving launcher and manifest consistency during concurrent upgrades and recovery failures.

[`a20020b`](https://github.com/KitsuneKode/kunai/commit/a20020b1f8469b21aa55798623b31dbf55baad85) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Download verified platform archives for native self-updates, safely extract one bounded executable in-process, and preserve rollback-compatible provenance while migrating schema-1 install manifests.

[`3b9207d`](https://github.com/KitsuneKode/kunai/commit/3b9207d7ad16f26ba9114d7eb28bf453eb1c5521) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Install verified compressed native release assets from Bash and PowerShell, reject unsafe or oversized archive contents, and retain a 404/410-only fallback for older raw releases.

[`501f83f`](https://github.com/KitsuneKode/kunai/commit/501f83f28852c0f62c4341554baaa742271a222d) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Redact standalone opaque credential values from diagnostics even when an upstream field uses an unrecognized name.

[`e90b663`](https://github.com/KitsuneKode/kunai/commit/e90b663b26d7cbc210fcb5dd50f6f63188342dd9) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Stop a malformed language tag from crashing playback, and clear the encoded ref out of the Discord state row.

### Fixes

- **A language label could take down a resolve.** The playback source inventory
  formatted language names with `Intl.DisplayNames.of()` and no guard, and that
  call throws `RangeError: argument is not a language id` for anything that is
  not a well-formed BCP-47 tag. Several values reaching it are not: YouTube's
  `a.en` auto-caption codes, `live_chat`, and `none` — which Kunai ships itself
  as the default series subtitle preference. The result was an unhandled
  rejection as a stream was being resolved. Labels are now derived from
  progressively less specific candidates, so a valid tag keeps its precise name
  (`en-US` stays "American English"), `a.en` resolves to "English", and anything
  unmappable degrades to the raw value instead of throwing. YouTube subtitle
  filtering now also recognizes dotted auto-caption tags and drops its
  `live_chat` metadata track before it can reach the picker.
- **The Discord state row no longer carries the encoded `kunai://` ref.** It was
  appended there from when the ref could not be a button. Discord truncates that
  row, so a long ref cut off mid-query and crowded out the progress beside it.
  The ref now has its own button and remains in `playable_ref`, so the visible
  text stays readable.

[`5dbd508`](https://github.com/KitsuneKode/kunai/commit/5dbd50898f1cfb83321cf16827eb35f492754ba4) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Keep unexpected background download-queue failures inside the download
subsystem so they cannot terminate playback.

## v0.3.0

Security, honesty, and platform fixes from a full codebase review.

Provider source reliability and lower cold-start waiting.

- **AniDB:** source inventory now comes from exact per-episode `jpn`/`eng`
  evidence. The requested audio mode resolves first; optional alternate audio is
  skipped in fast mode and bounded in balanced/quality-first modes, so a slow or
  missing alternate cannot hold a playable requested stream or appear as a
  selectable source.
- **AllAnime:** the mkissa build-140 crypto rotation is locked with independent
  known-answer vectors and exact bootstrap-header tests. Cold episode-catalog
  and crypto preparation now overlap, and baseline source adapters share a 1.5
  second inventory window so a dead mirror cannot hold already-playable peers.
  The production cold smoke kept four candidates while dropping from 12.257 to
  2.573 seconds; request retries and their individual deadlines are unchanged.
- **Relay diagnostics:** `bun run test:relay` reads the user's existing relay
  config without modifying it, preflights `/health` through Bun itself, then
  runs the AllAnime smoke in an isolated profile. It reports only the relay
  origin, token presence, provider count, and bounded failure code; full URLs,
  URL queries, fragments, embedded credentials, and tokens are not logged.
- **Provider ordering:** the default remains `animeProviderPriority: ["anidb"]`.
  The field is documented as ordering rather than an allowlist; registered
  AllAnime and Miruro providers remain available behind AniDB.

- **Downloads:** provider stream URLs and headers are guarded before reaching
  yt-dlp (scheme check, leading-dash rejection, `--` terminator, CRLF-stripped
  headers), closing an argv option-injection path the mpv lane already blocked.
- **Storage:** the data and cache SQLite files (plus `-wal`/`-shm`) are chmod'd
  to owner-only on every open, matching config and token handling.
- **Windows:** every install path now installs real mpv instead of mpv.net.
  mpv.net ships `mpvnet.exe`, but Kunai probes for `mpv` and drives playback
  over mpv's IPC socket and Lua bridge, so a "successful" dependency install
  could still leave playback reporting mpv as missing.
- **CLI:** `--jump` help says what the flag does (auto-pick the n-th search
  result) and warns on invalid values; headless download failures and rejected
  `--handoff-url` values exit nonzero.
- **Playback:** one-shot mpv launches attach the full collected subtitle
  inventory and report the real track count; prefetched and back-navigation
  streams are re-resolved when blocked or older than five minutes instead of
  replaying a possibly expired URL.
- **AniSkip:** the TMDB to MAL fallback is refused beyond season 1, so
  split-cour anime no longer risk wrong auto-skip windows.
- **Docs:** the command-honesty gate counts the browse palette; user docs stop
  promising `/sync`, `/random`, and `/surprise` as typed commands; the
  keybindings doc's post-playback table matches the code; provider descriptions
  state adapter roles instead of speed or "recommended" claims.

New in this release: `kunai completion <shell>` prints a completion script for
bash, zsh, fish, and PowerShell, covering every flag and maintenance
subcommand. `/docs` now opens the published documentation site at
https://kunai.kitsunekode.in instead of the GitHub tree.

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

Late 0.3.0 fixes, from a review pass over the release train.

- **YouTube plays at the quality you chose**, on the persistent player path. The
  format selector was set on mpv's `ytdl` option, which is a yes/no flag — mpv
  dropped it, so the ceiling silently never applied while the spawn path honoured
  it. Both player paths now agree.
- **Tracker credentials are private on Windows, and survive a power cut
  everywhere.** The owner-only permission sat behind a POSIX-only branch, so on
  Windows `sync-tokens.json` and `config.json` kept whatever `%APPDATA%`
  inherited; they now get an inheritance-free, user-only ACL. Neither file was
  flushed either, so a power loss could leave a correctly named, empty config.
- **A malformed Discord IPC frame can no longer end your session.** Rich Presence
  is optional; a bad frame could take playback down with it. Presence now
  degrades to no presence.
- **`-i/--id` no longer leaves a placeholder in your history**, and a partial
  write can no longer erase external ids that were already resolved.
- **Choosing a title shows the loader while it resolves**, instead of a still
  screen that looked like nothing had happened.

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
