# Changelog

## v0.3.0

Give Kunai a mascot, and one of her rather than two.

Kanna is a rose kitsune. A **kanna** (鉋) is a Japanese hand plane — you run it
over rough wood and the roughness leaves in one curl. Kunai is the blade; she is
who holds it.

- **She appears where waiting happens, and nowhere else.** Setup, the setup
  summary, the goodbye screen, and — as one short line of text — every empty and
  error state. That text tier is the one that matters: the illustrated fox needs
  a graphics protocol and reaches four terminals, while copy reaches all of them.
  She is silent on `loading`, `info` and `success`, which already say what is
  happening.
- **`KUNAI_PET=off` retires her entirely**, text included; `glyph` pins the
  portable 🦊; non-TTY output gets neither, instead of a stray emoji in a pipe.
- **Quitting is no longer slower for people who never see her.** The exit
  animation budget had tripled as a constant, so every user paid 440ms on every
  quit for a still that most terminals would never paint. It is now derived from
  whether the still will actually render.

Kunai had been shipping two mascots. A pixel-grid generator called itself the
source of truth and fed the README hero, both social cards, the GitHub preview
and the Discord icon, so everything a person met _before_ installing was a
different animal from the one inside the program. There is now a single traced
vector source, and every one of those surfaces renders from it.

She appears in the terminal where the session is actually waiting: while
providers are being raced, on the beat where a stream is handed to mpv, and when
a resolve fails. One rule keeps that from becoming clutter — she never competes
with content artwork, so where a poster renders she does not. Failure is the one
exception, because a surface explaining what went wrong outranks a picture.

Every surface reports what the session is _doing_ and a single host decides what
to draw. That is what retires the three poses which were embedded in the binary
with no way to reach them, and it is enforced: one test fails if an embedded pose
becomes undrawable, another if a moment has no reporter.

On the docs site she roams, and she is an animal with attention rather than a
cursor mirror. She has to notice a movement (small ones are ignored), take a beat
to decide, walk over, and settle _beside_ you rather than on you — anything that
lands under the pointer reads as cursor decoration. Changing direction mid-walk
costs her a moment of speed instead of snapping. At rest she watches you, gets
bored, and only then curls up. She is goofier there than in the terminal on
purpose — the CLI is her at work, where a chatty line in someone's shell is a bug.

The browser tab is hers too: the favicon is Kanna rather than the blade mark,
which stays as the insignia on badges and the cards.

Fixes found while building it, all pre-existing:

- **Ctrl-K search on the docs site returned nothing for every term.** The route
  declared `dynamic = "force-static"` while exporting a `GET` that answers one
  `?query=` per request, so Next prerendered it once with no query and served
  that forever. The built payload was two bytes.
- **A failed clipboard write still reported success.** The copy button did not
  await `writeText`, so a rejected write — insecure context, denied permission,
  no clipboard API — still said "Copied" and still fired the event the fox
  reacts to.
- **Discord presence printed its status twice** on the shell boot line, both
  settings actions, and the diagnostics reason: "unavailable · unavailable ·
  Could not connect to…". Four surfaces composed that line by hand and all four
  repeated a status the detail already carried.
- **The social card drew its type row on top of the mascot.** The layout was
  written for a corner peek on a dark square with empty space beside it; the art
  changed to a centred bust and the layout did not follow.
- **The installer Docker matrix was failing every scenario on both libc
  variants** with `release companion not found` — the build job uploaded raw
  executables while the fixture installs from the archive.

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

Google Cast playback.

- **Cast to devices on the local network.** Discover receivers through mDNS,
  DIAL/SSDP, and supported native resolvers, then choose local playback or a
  receiver from Kunai's playback-device picker.
- **Play full video and audio with remote controls.** Cast-compatible media uses
  Google's Default Media Receiver, with pause, resume, relative seek, direct
  timeline seek, stop, and playback progress shared with Kunai.
- **Deliver protected media and subtitles safely.** Header-protected streams and
  converted WebVTT subtitles use tokenized, session-scoped LAN gateways that
  close when playback ends.
- **Try experimental audio-only Cast.** `--cast-audio` keeps muted video in local
  mpv while sending ffmpeg-extracted audio to a registered Kunai Custom Receiver,
  with coupled controls and receiver-clock drift correction. Regular `--cast`
  remains on the existing full audio and video receiver path.

Launch flags, discovery, and the queue.

- **`-S <query>` shows its results.** The search ran, but the view and the shell
  were both chosen from a state snapshot taken before it finished — and that
  snapshot is empty by construction — so a successful search landed on the empty
  search surface and looked like the query had merely been typed for you.
- **A search on launch now shows a loader.** The idle surface rendered the
  welcome screen regardless of search state, so the header said "searching" over
  a screen with no sign of work in flight.
- **`-i/--id` says when it is ignored.** An id without a usable `-t`, or under
  `-a`, was dropped with a debug-only warning, so the run looked normal and the
  flag silently did nothing.
- **`/random` and `/surprise` honour your Discover tray size** and are on the
  browse palette next to `/trending`. The tray was clamped to five picks while
  the setting's smallest option is twelve, so no configured value could ever
  take effect; a uniform shuffle also discarded the stratification that keeps
  one source from filling the tray.
- **`/up-next` opens during playback.** The queue was reachable everywhere
  except the one activity that consumes it.
- **`--dry-run` prints the plan instead of starting a session.** The flag was
  documented as a general launch flag and read in exactly two places
  (`--install-protocol-handler` and `rollback`), so `kunai -S "Dune" --dry-run`
  parsed it, discarded it, and mounted the full interactive shell — starting the
  session it had just promised not to. It now prints the resolved mode, surface,
  query or title, auto-pick, and any flag it will ignore, and exits before
  anything is created: no version lock, no version pruning, no database, no
  terminal probe.
- **`--zen` no longer plays a title you did not pick.** Zen is documented as a
  bare layout, but it set `--quick`, which is not a layout flag at all — it means
  "auto-pick result #1". `kunai -S "Dune" --zen` skipped the result list and
  started playing the top hit. Zen now changes chrome only; use `--zen --quick`
  for the old behaviour.
- **Finishing a title no longer triggers a search you did not ask for.**
  Launching with both a query and a direct target (`-S "Dune" --history`, a
  share link, `-i` with `-t`) left the query armed after the chosen title
  played, so the session bounced into a stale search when playback ended — and
  with the auto-pick index still set, under `--quick` that search immediately
  played its first hit, writing a history row and a tracker sync for a title
  nobody selected.
- **The library footer stops advertising a key that did nothing.** `m` was
  registered for a title-control menu and shown as available; no handler read
  it, so the keystroke was typed into the filter box instead.

Privacy hardening, and a consent bug in the installer.

- **Diagnostics no longer leak signed-CDN tokens or your IP address.**
  Redaction judged only the parameter _name_, so anything the CDN keyed
  differently — `?q=<token>`, `?md5=<hash>`, `?ip=`, `?client_ip=` — passed
  through intact into the debug log, the diagnostics store, and the support
  bundle people paste into GitHub issues. Values are now judged too: an
  unbroken high-entropy blob is redacted, while readable values like `?q=Dune`
  survive so traces stay useful.
- **Analytics sends a hash, never your install id.** The ping now carries
  `sha256(installId)`; the id itself never leaves your machine. The payload is
  still exactly five keys. Because the hash input changed, installs from before
  this release are counted once more.
- **You can rotate your install id** from Settings while staying opted in. The
  new id is freshly random, so earlier pings cannot be linked to it. Disabling
  analytics still clears the id entirely.
- **The installer no longer treats "no terminal" as a yes.** `curl … | bash` in
  CI, a container, or a sandbox would auto-answer the optional-dependency
  prompts and run `sudo apt-get/pacman/dnf install` unattended, because
  `-r /dev/tty` tests permission bits rather than a controlling terminal and a
  failed read fell through to the default. `--yes` is now the only thing that
  accepts on your behalf; a skipped step says so.
- **`kunai` works in the next terminal you open.** The installer printed a PATH
  line and stopped, which changes nothing in your shell — so on macOS and
  Alpine, where `~/.local/bin` is not already on PATH, the install "succeeded"
  and the command was not found. It now writes your shell profile (opt out with
  `--skip-path-update`) and prints one `source` line for the current shell.
- **Apple Silicon binaries run.** Release binaries are cross-compiled on Linux
  and therefore arrive unsigned, which arm64 macOS refuses to execute — the
  shell reports only `killed: 9`. The installer now ad-hoc signs on your Mac.
- **The public usage page works.** `/analytics` on the docs site showed
  "not published yet" permanently while the ingest was serving real data.
- **AllAnime survives a bad response** instead of failing the provider, and the
  relay's private-host guard covers IPv4-mapped IPv6 such as
  `::ffff:169.254.169.254`.
- **Discord Rich Presence can no longer end your session.** A malformed frame
  from Discord reached `JSON.parse` inside the socket callback, and a throw
  there is an uncaught exception rather than a rejected promise — which Kunai
  escalates to a fatal shutdown. A cosmetic, optional integration was able to
  print a stack trace over the UI and stop playback. Unreadable frames are now
  dropped, and a frame claiming an implausible size drops the connection instead
  of buffering toward it.
- **An unplugged drive no longer kills the session or strands the download.**
  When the download folder became unwritable or disappeared mid-session,
  preparing the output directory threw past the point where the job was claimed:
  the job stayed claimed for the rest of the run — displayed as queued, never
  startable again — and the error surfaced as an unhandled rejection, which is
  also a fatal shutdown. The job is now paused with a readable reason and picked
  up on a later attempt.
- **Reordering Up Next is all-or-nothing.** Positions were written one row at a
  time outside a transaction, so an interruption part-way left the queue with
  duplicate positions rather than a stale-but-valid order.
- **Anime playback stops stalling the interface between segments.** The relay
  decoded every video segment into a JavaScript string twice — once to find a
  status trailer, once to check whether the bytes were a playlist — which for a
  6 MiB segment cost about 50 ms of blocked main thread and 60 MiB of garbage,
  on the same thread that reads your keystrokes. Both checks now work on bytes.
- **The relay's CDN allowlist is a domain check again.** The patterns matched
  any hostname _containing_ the allowed name, so a crafted stream URL could
  point the local relay at an attacker's host.
- **The mpv control socket lives in a private directory.** It sat in the shared
  temp directory; on systems with a group-writable umask that left mpv's
  command interface reachable by another process running as the same group.
  It now uses `$XDG_RUNTIME_DIR/kunai`, falling back to an owner-only temp
  subdirectory (macOS sets no runtime dir). Windows is unaffected — it uses a
  named pipe.
- **Links open only if they are links.** External URLs went straight to
  `xdg-open`/`open`/`explorer.exe` whatever their scheme, and a value beginning
  with `-` was read by the opener as a flag. Only `http`, `https`, and `kunai`
  URLs are opened now; anything else is still shown and copyable.

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
  promising `/sync` as a typed command; the
  keybindings doc's post-playback table matches the code; provider descriptions
  state adapter roles instead of speed or "recommended" claims.

New in this release: `kunai completion <shell>` prints a completion script for
bash, zsh, fish, and PowerShell, covering every flag and maintenance
subcommand. `/docs` now opens the published documentation site at
https://kunai.kitsunekode.in instead of the GitHub tree.

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

A last review pass over the release train, from real sessions:

- **A malformed language tag can no longer take down a resolve.** `Intl.DisplayNames.of()`
  throws on anything that is not a well-formed BCP-47 tag, and several values reaching it are
  not — YouTube's `a.en` auto-caption codes, `live_chat`, and `none`, which Kunai ships as its
  own default subtitle preference. Labels now degrade instead of throwing, YouTube's dotted
  auto-caption tags resolve to the real language, and the `live_chat` metadata track is dropped
  before it can reach the picker.
- **Setup keeps a language per media type.** Shows, Movies, Anime, and YouTube each hydrate from
  and write back to their own profile, so rerunning `/setup` no longer flattens choices made in
  Settings. `Tab`/`Shift+Tab` cycle the lane, `←`/`→` switch audio and subtitles, and `a` copies
  the active profile to all four lanes. Playback toggles start off until the recommendation is
  chosen. Accepting remaining defaults now lands on the final review screen before saving.
- **YouTube results identify what will open.** Videos, Shorts, playlists, and channels retain
  their shape through search, filters, and the details panel. `type:short` narrows YouTube search,
  preferring backends that provide an explicit Shorts signal, while live/upcoming/post-live
  status remains a separate badge so a collection or live entry is not mistaken for a regular
  video. Backends that omit a signal remain labelled conservatively.
- **YouTube live streams play.** mpv's ytdl hook turns each `ytdl-raw-options` entry into a bare
  `--flag` when its value is empty, so Kunai's `live-from-start=no` reached yt-dlp as
  `--live-from-start no` and `no` was read as a second URL. Live playback now joins at the live
  edge, holds a short demuxer buffer to stay there — at spawn and on every in-session
  replacement alike — and suppresses every seek that assumes a fixed position: the start
  argument, the loadfile offset, the watch-later resume prompt, and the seek that used to fire
  after an in-process reconnect.

- **YouTube quality is no longer capped at 360p, and a PO token is actually used.** The default
  player clients now lead with `visionos`, matching yt-dlp's own default: it is the one client
  with no Proof-of-Origin requirement, and yt-dlp skips rather than attempts formats whose token
  is missing, so a token-gated client in front spent a whole failover lane on formats that were
  never going to be offered. A configured PO token now survives a restart, reaches downloads as
  well as playback, and is written in the single-prefix form yt-dlp can actually parse — before,
  it was dropped by config normalization, omitted by downloads, and malformed on the wire.
- **A YouTube premiere says it has not started.** Opening one reports that instead of handing
  mpv a stream that cannot play yet, and rows carry view counts, humanized upload times, and
  live state.
- **Post-play keeps its escape hatches visible.** `/analytics`, `/sync`, and diagnostics are
  available from the command palette after playback, so a stopped session can inspect telemetry,
  tracker state, or recovery details without returning to browse.
- **A tracker sign-in can be cancelled.** Linking now runs in its own screen with visible
  progress, `esc` to cancel, and `r` to retry a failure. It previously passed a signal from a
  controller nobody held, so cancelling was impossible and the wizard waited on an unresponsive
  screen until the tracker's own deadline expired.
- **Stopping early shows where you stopped.** The post-play bar read season progress — "3 / 10"
  after 23 seconds of an episode — and films got no bar at all. It now reads elapsed position
  over runtime for both, without a misleading percentage or a season fallback when runtime is
  unavailable.
- **Discord presence clears when Kunai exits.** A single Discord IPC frame was allowed ten
  seconds while shutdown force-exits after four, and the clear also queued behind any update
  already in flight, so the card outlived the session. It now runs first and within the
  shutdown budget.
- **A withdrawn release says so.** Marking one withdrawn now lists it as withdrawn on the docs
  site with the rollback command and withholds its install commands, rather than dropping it
  from the page while its detail view still offered them.
- **AniDB understands a show's final season without guessing.** A standalone `Final Season`
  routes after the highest exact numbered sibling, while movies, split parts, spin-offs, and
  ambiguous story arcs remain excluded instead of becoming false season evidence.
- **Advertised queue and sync commands are reachable.** `/playlist-add` and `/queue-season`
  now appear during playback and post-play, where the current title is trustworthy; `/sync`
  opens the public sync surface, and failed setup links point back to Settings → Sync rather
  than a deliberately hidden nested command.
- **Windows install guidance names the real mpv package.** The README, npm package page, and
  platform guide use `mpv-player.mpv-CI.MSVC`, which provides the `mpv.exe` Kunai probes and
  controls, instead of the ambiguous package name that can leave only `mpvnet.exe` available.
- **History consolidation keeps the furthest watch state.** When an opaque row and its catalog
  row resolve to the same episode, the newer identity still wins while progress, completion,
  duration, and first-watched time keep the most useful evidence from both rows.
- **Legacy YouTube history keeps its poster while migrating.** Rekeying an older video row no
  longer drops its thumbnail from Library and Continue Watching.
- **Installer recovery refuses unsafe staging paths.** Bash now matches the TypeScript
  installer: abandoned transactions cannot escape the cache through traversal, prefix-sharing
  siblings, or a staging-directory symlink before cleanup.
- **Silent persistence and fallback failures are closed.** Shutdown waits for an in-flight
  settings save; failed discovery fetches are not cached as empty; absolute-numbered anime works
  in retention, cleanup, and crash resume; analytics rejects insecure overrides; relay sub-paths
  are preserved; Windows paths are measured before tightening; AniSkip survives an untimed
  IntroDB segment; unreadable config is not overwritten; and sandbox paths resolve only when used.

Also new since 0.2.5, the last release you could install:

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
- Send only to the Kunai-owned HTTPS endpoint after explicit consent; reject insecure overrides
  without falling back to the default.

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
