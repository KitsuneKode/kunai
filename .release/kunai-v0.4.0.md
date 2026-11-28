# Kunai 0.4.0

A focused watching update: a two-screen first run, clearer search and
recovery, five more providers, accurate source and subtitle controls, and safer
persistence, downloads and native installation.

### Highlights

- The first run is two setup screens instead of six: what you watch, with a
  one-line check of this machine, then the usage-sharing question. Press `m`
  on the first screen, or run `/setup` or `kunai --setup`, for the full setup.
  A launch that says where to go (`-S`, `-i`, `--continue`, `--history`,
  `--offline`, `--download` or a share link) skips setup and writes nothing
  about it, so the next plain `kunai` still offers it.
- Five more providers: VidBolt and FileSuN for movies and series, and AniLight,
  Anidap and AnimeParadise for anime. Each joins the end of its fallback order.
- Keep search history, type-ahead requests and suggestions scoped to the active
  mode and provider. Cancel stale requests and submit the latest input even
  when typing and Enter arrive in the same frame.
- Preview the selected title from suggestions and command-palette title rows.
  Use YouTube artwork and video identity without mixing in anime or TMDB data.
- Make mouse and keyboard controls agree across Browse, Library, Up Next,
  Tracks, Settings and setup. Guard unavailable actions, show press feedback,
  and cancel clicks when overlays or moved targets invalidate them.
- Recover from failed playback through visible provider controls and a
  consistent Shift+F fallback action, with accurate attempt and loading states.
- Choose VLC as the desktop player with `--player vlc` or once in Settings.
  Kunai observes it like mpv: progress, resume, auto-skip, and the next episode
  in the same window. With VLC installed and no mpv, the default `auto` plays
  in VLC instead of asking you to install mpv first. Startup, setup,
  `kunai doctor` and both installers apply that one rule, so a VLC-only
  machine is no longer told that nothing can play.
- Playback counts as started only once a video frame is decoded (audio for an
  audio-only stream). A stream that
  never decodes, or sends nothing for 15 seconds, fails over to the next
  source, and a failing 4K stream first steps down to 1080p on the same source.
- A stream that dies mid-episode continues on the next source from the same
  moment, in the same window, after one reload of the same link. A source that
  fails before your resume point no longer restarts the episode from 0:00, and
  `manual` recovery mode no longer moves to another provider on its own.
- Tap and click through the shell: History, every picker, Notifications,
  Downloads, the guide, the checklist, the Schedule and a title's details. A
  click on any key hint presses that key. Portrait phone terminals get a
  single-column layout instead of a resize prompt.
- Use one inline destructive confirmation strip across History, Up Next, Library,
  Downloads, and list pickers. `y` confirms and `Esc` cancels before filters or
  overlay close; moving or refreshing rows disarms instead of transferring the
  action, and playlist removals no longer open a full-screen modal.

### Catalog and settings

- Keep series details and episodes available from the last successful TMDB lookup.
  Search can fall back to Wikidata, and the series calendar can use TVmaze through
  mapped IDs. Diagnostics shows which source answered.
- Trending and recommendations retain usable results during upstream failures.
  Shared AniList requests reduce duplicate work across anime surfaces.
- Settings groups preferences into five sections. Add or remove personal TMDB and
  Wyzie keys there. Kunai uses the OS vault when available.
- With a TMDB key, yours or the one built into a release, Kunai asks TMDB
  directly first and keeps the third-party mirrors as the fallback. Without a
  key it asks the mirrors first. Keys are never sent to a mirror.
- Turn on `discoverShowOnStartup` and a plain `kunai` opens Discover first.
  Before, the setting only printed a hint. A launch that names a destination
  still goes there.
- Set Continue's source preference to `ask` and Kunai asks, on any continue
  launch and not only from History, whether to play the downloaded copy or
  stream online when both are ready. With no terminal to answer it streams;
  with no connection it plays the download.
- A signed provider hotfix manifest delivers supported configuration updates.
  HDR and Dolby Vision selections preserve the chosen playback route.
- The details sheet shows your progress and where a title is available. Anime
  Discover gets personal rails from AniList.
- Connecting a tracker turns its sync on and disconnecting turns it off.
  Trackers' `Retry-After` is honoured across batches.

### Playback and providers

- Preserve exact YouTube format IDs through quality selection and the options
  passed to yt-dlp. Quality changes retain the active client; client changes
  retain a compatible format; Auto returns to automatic selection. Deduplicate
  equivalent quality rows and hide redundant provider choices.
- Reuse already attached subtitle tracks when changing language. Reconcile
  native mpv selection and visibility, explicit Off, preferred-language late
  discovery and replacement files without multiplying tracks or overwriting
  an acknowledged preference with a stale observation.
- Keep every YouTube caption language in the subtitle inventory. Tracks that
  differ only by URL query merge only when their language agrees, so `?lang=en`
  and `?lang=fr` stay separate, while re-signed copies of one file still merge.
  The preferred language is selected and download sidecars are labeled
  correctly.
- Expand supported HLS variants and manifest audio/subtitle renditions while
  preserving source identity and request headers. Present adaptive DASH as an
  honest Auto choice when independent representations are not selectable.
- Update provider extraction, failure classification, cancellation and endpoint
  health handling. Probe candidate media before reporting resolve success;
  rejected streams are not offered as playable quality choices. Empty provider
  replies become no-source results rather than internal errors.
- New profiles use VidLink for movies/series and HiAnime for anime. The remaining
  movie/series order is Movy, Rivestream, VidRock, Videasy, VidBolt, FileSuN;
  the anime order is KickAssAnime, AnimeGG, Miruro, AniLight, Anidap,
  AnimeParadise, AllManga. Profiles that kept the previous defaults move to this order; a
  reordered list is left alone. On the 2026-11-26 live runs Rivestream timed
  out, VidRock's streams answered 502, Videasy and Miruro resolved nothing and
  AllManga stopped at a CAPTCHA, so they sit behind the providers that played;
  see Known issues. Availability remains dependent on
  each upstream service and the user's network.
- The five new providers each played a checked video frame on 2026-11-27 and
  start at the end of their order. VidBolt (movies/series) offers several
  servers, up to 1080p, with multiple audio and subtitle languages, but is slow:
  resolves took 10 to 22 seconds and one of four test titles timed out. FileSuN
  (movies/series) has one server and reached 720p. AniLight and Anidap (anime)
  serve sub and dub; some Anidap servers share a backend with HiAnime or
  KickAssAnime, so they are not all extra capacity. AnimeParadise (anime) is
  sub only, at 1080p.
- The provider picker (`/provider`, and the one shown after a playback error)
  states where each provider stands: `healthy`, `degraded` or `down` with the
  failure count and how long ago, quarantined endpoints,
  `failing on this title`, a dated `known issue`, or `not checked yet`. One
  footer carries the keys and the highlighted provider's state. The order is
  still your configured order and a provider marked down can still be chosen.
  VidLink and VidRock no longer both answer to "P-Stream".
- Changing episode, source or provider keeps your saved position on VLC and
  one-shot mpv. They cannot show mpv's Resume / Start over prompt and used to
  restart the episode. A restart you asked for, or a share-link timestamp,
  still wins.
- `--quality`, `--audio` and `--sub` now apply to YouTube for the session.
  Editing one YouTube language setting no longer saves the other launch-flag
  values to `config.json`.
- Hardware decoding is a setting: **Settings › Playback**, `mpvHwdec`, or
  `--mpv-hwdec` for one run. The default `mpv-default` passes nothing, so your
  mpv.conf and mpv's own default decide. `auto` checks once, cached for seven
  days, that mpv can decode on the GPU, then passes `--hwdec=auto-safe`;
  `auto-safe`, `auto-copy`, `off` and a named decoder go to mpv as given. A
  failed or missing check never blocks playback, and `kunai doctor` reports the
  mode and the value it will pass. The setting applies when an mpv process
  starts.
- When audio and video drift more than about 0.3 seconds apart and stay there,
  Kunai seeks to the current position to bring them back, at most twice per
  episode. It leaves pauses, seeks, buffering, reconnects and live streams
  alone, and applies to the persistent mpv window only. Turn it off with
  `mpvAvsyncRecovery: false` or `--mpv-avsync-recovery off`.
- The provider order and platform support tables in the docs are generated
  from the shipped code, so they no longer list a provider that is not
  registered.
- AllManga stays registered and moves to the end of the default anime order.
  On 2026-11-28 its pinned build-193 crypto still bootstrapped, and a Solo
  Leveling catalog still loaded in sub and dub, but the one stream resolve
  stopped at a CAPTCHA before any URL or decoded frame. Profiles that still
  have the previous default anime order pick up the new one; a custom order
  is left alone.
- Retire AniDB from the production roster. Migrate retired selections and remove
  its priority/pin entries without deleting history, offline files or unrelated
  provider preferences. Keep Videasy and AllAnime registered.
- Startup failover skips dead sources, wraps around and stops A→B→A loops. In
  guided and fallback-first modes a provider that is down is tried last and the
  provider that last worked for a title starts first. HLS variants are ranked by
  measured resolution, not advertised bandwidth.
- Provider site lookups use DNS-over-HTTPS (Cloudflare, `1.1.1.1`) so networks
  that block providers by DNS still reach them, falling back to system DNS.
  Video hosts and local addresses keep system DNS. Turn it off in
  **Settings › Sources › DNS-over-HTTPS** or with `KUNAI_DOH_DISABLE=1`.
- A backward seek is no longer mistaken for a stall. Share links, queue rows,
  `/watch` and Calendar continuations each play the episode they name.
- Preserve trusted resume positions on quit. Automatic completion requires
  natural EOF and observed progress; duration-only or near-end events do not
  silently mark an unfinished episode watched.
- Improve provider-native season/episode identity, dub selection and validated
  offline playback, including titles with more than 100 downloaded assets.
- Stremio addons are experimental and off by default. Review and accept the
  playback risk in **Settings > Sources > Experimental: Stremio addons** or
  with `kunai addons enable`. In scripts or with redirected streams, opt in
  explicitly with `kunai addons enable --accept-risk`. Add movie and series sources with
  `kunai addons add <manifest-url>` (or `--stdin` to keep it out of argv).
  `kunai addons disable` stops addon use at the next resolve and keeps the
  installed list. Only direct video files are supported; downloads and
  Android handoff do not use addons. Full addon URLs are never shown or logged.

### Search and terminal interaction

- Show Kitty poster previews inside tmux 3.3+ when passthrough is enabled and
  the outer terminal supports Unicode placeholders.
- Show native Sixel previews when tmux 3.4+ reports Sixel support.
- Reduce banding in Sixel posters and use more colours on terminals that report
  a larger palette.
- Fit graphics posters to measured terminal cell sizes and refresh them on
  resize.
- Display Kitty posters in WezTerm with Kitty graphics enabled.

- Add direct title launches from the command palette, notification episode
  launches and bounded detail prefetching. Keep command matching and title
  matching distinct, and prevent palette typing from firing playback hotkeys.
- Add session undo for supported reversible library actions, contextual tips
  with a disable control, and clearer download, queue and empty-state feedback.
- Measure terminal display cells and complete grapheme clusters when wrapping
  or truncating titles. Improve selected-row contrast, compact layouts,
  reduced-motion behavior and settled-work status reporting.
- Sanitize untrusted terminal text, including OSC sequences terminated by the
  string terminator, without damaging normal Unicode titles.
- Plain and screen-reader mode, light and high-contrast themes, and `NO_COLOR`
  support.
- Browse takes typing as soon as it opens, while its first picks load, and
  picks that arrive later do not take focus from the search field. With
  nothing cached it offers `/trending`, `/calendar` and `/random`. An empty
  search names the lane it searched and the key that switches lanes.
- When the results list has the keyboard, the search field says
  `results own keys · Esc search` instead of silently ignoring what you type.
- A failed playback shows one `Next` line between the cause and the evidence:
  the key to press, or the install command for this machine.

### State safety and privacy

- `KUNAI_CONFIG_DIR` now selects a whole profile. Config, both databases, the
  cache, scratch files, credentials and the installed binary all live under
  that one directory, in `config`, `data`, `cache`, `tmp` and `bin`. Before,
  the installers read the variable and the running app did not, so a run meant
  for a separate profile could still open your real history.
- A profile directory must be an absolute path used for nothing else. An empty
  or relative value is an error, not a fallback to the defaults. Kunai
  refuses the filesystem root, your home directory or a parent of it, and
  anything that overlaps its default directories. It claims a new or empty
  directory by writing a `.kunai-profile` marker and never adopts a nonempty
  directory without one. A refused profile exits with status 2 and says why.
  Uninstall's purge removes only `config`, `data`, `cache`, `tmp` and the
  launcher; the directory, its marker and anything else in it stay.
- A profile install puts a launcher in `<root>/bin` (`kunai`, or `kunai.cmd`
  on Windows) that uses its own profile with no variable set. Profile installs
  are binary-only, never change PATH or shell startup files, and do not
  register the `kunai://` handler. Credentials stay in a file inside the
  profile, not the OS vault. Android ignores the variable.
- **If you already set `KUNAI_CONFIG_DIR`:** the app now honours it. Nothing is
  copied or moved, so a launch with the variable set uses that directory, not
  your existing history and settings, and is refused if the directory is
  nonempty and unmarked. Unset the variable to keep using your existing
  profile, which is unchanged. For a separate profile, point it at a new or
  empty directory and reinstall there with `kunai install` or the installer
  script. Do not copy the old `install.json`; it records absolute paths.
- AniList sync marks a title Completed only when its last episode is finished.
  Finishing a middle episode records progress, re-watching an early episode no
  longer demotes a completed title, and progress never moves backward.
- Serialize configuration changes and preserve concurrent profile, credential
  and preference updates. Refuse an unlocked save after contention rather than
  overwriting another instance's changes.
- Preserve healthy SQLite databases on contention and permission failures.
  Fence queue and download work by ownership and generation; cancelled or
  superseded workers cannot launch or complete a successor's operation.
- Make download removal and retained-file results truthful. Validate ownership
  before recovery, preserve uncertain files, and keep job and asset updates
  consistent when removal fails.
- Keep tracker credentials in the native vault when available, retain unrelated
  credentials during scoped changes, and avoid exposing media credentials in
  command-line arguments and diagnostics.
- Validate provider fetch targets and pin guarded connections to the checked
  address across redirects. Bound materialization and archive handling, use
  private temporary directories, and keep credentials scoped to their origin.
- Desktop VLC applies the same checks as mpv: HTTP(S) provider targets only,
  the addon direct-media preflight, and no shell secrets in its environment.
  Provider DNS-over-HTTPS refuses redirects off the web and never pins curl to
  a private address. Signed provider hotfixes follow GitHub's download
  redirect, and `kunai providers update` uses the pinned channel by default.
- Preserve analytics opt-out and identity rotation across pending responses and
  concurrent saves. Setup requires an explicit consent action. Tests, installer
  fixtures and debug sandboxes isolate storage and suppress analytics; the
  dedicated analytics smoke only accepts an explicit numeric-loopback endpoint.
- Opt-in usage pings now carry an id that changes every calendar month (an
  HMAC of the local id, which never leaves the machine), the month you opted in
  and the day, and no timestamp. Android reports `android`. Setup's consent
  screen pre-selects neither answer. `kunai analytics log` shows every ping
  exactly as sent, and `kunai analytics preview` the next one; neither sends
  anything.
- Releases carry `install.marker` and `update.marker`. With usage analytics on,
  the installers and the native updater fetch one once after a successful
  install or update, so GitHub can count them; Kunai receives nothing. With
  analytics off nothing is fetched, and `DO_NOT_TRACK`, `CI` and
  `KUNAI_NO_MARKER` skip it either way.

### Performance and distribution

- Install through the project’s Homebrew tap or Scoop bucket. Signed releases
  include a checksum-pinned Arch PKGBUILD. The native updater and branded
  installers authenticate both checksum manifests when built with the release key.
- Native bytecode builds reduce startup work on supported targets.
- Refresh the Bun 1.4.5, TypeScript 7 and Ink 8 toolchain with compatible package
  updates. Reduce redundant provider/watchlist work, batch playlist imports,
  bound poster-cache recovery and buffer mpv IPC writes without leaking expired
  commands or stalled queues.
- Strengthen native update, rollback and activation locking on Linux, macOS and
  Windows. Verify archive contents, size bounds and both transport/payload
  checksums before activation; malformed or failed downloads leave the active
  installation intact. An upgrade that finishes after a newer version was
  installed no longer rolls it back; pinned installs and rollback can still
  select an older version.
- Keep the npm launcher separate from native platform payloads. Synchronize all
  ten optional platform-package versions and preserve exact candidate bytes,
  checksum manifests and attestations through the protected release workflow.
- Improve Windows helper discovery and verified provisioning, exact winget
  guidance, Flatpak mpv discovery and installer wording.
- The installers run the new binary once before calling the install done. If it
  cannot start, they keep your previous version active and print the fix for
  your system, such as `apk add libstdc++ libgcc` on Alpine, which the musl
  binary needs. `install.sh` no longer needs `awk`, works with the bash 3.2
  that ships with macOS, and checks that npm, Bun and source installs land on
  your PATH, including an npm global folder it cannot write to.
  `kunai uninstall --purge` names your downloaded videos before deleting them,
  and a plain uninstall on Windows keeps your data.
- Add experimental Android Termux targets and guarded external-player handoff.
  This is not a supported full mobile application; accepted OS handoff does not
  prove decoded playback, progress, completion or autoplay. The launcher gets
  the Android runtime environment `app_process` needs, a launch is bounded to
  ten seconds and cancellable, and `kunai doctor` on Termux checks for an
  intent launcher instead of desktop mpv.
- Harden CI against zero-task and cache-replay false passes, retain gate
  evidence, and exercise installer and lifecycle contracts across platforms.

### Reliability fixes

- Handle OAuth callback bind failures, resolve relative HLS segments against the
  final redirect URL, and cancel abandoned provider requests and prefetches.
- Bound relay response reads. Concurrent catalog lookups can cancel independently,
  and an abandoned request can no longer overwrite a successful retry.
- Preserve healthy cache entries after malformed responses. Mark AniList titles
  completed at their final episode, and handle hardware next/previous media keys.
- Send macOS Keychain writes through stdin. Check that the Windows vault can
  store, retrieve and delete a probe before using it. Report a file fallback.

### Known issues

- AllManga stops at a CAPTCHA before returning a stream on the networks
  tested, as of 2026-11-28 ([#724](https://github.com/KitsuneKode/kunai/issues/724)).
  Its catalog still loads and its stream authorization is current, so it stays
  registered at the end of the anime order, and Kunai moves on to the next
  provider when it fails.
- VidRock's streams answer HTTP 502 and Videasy's resolves time out on the
  networks tested, as of 2026-11-27. Both stay in the movie/series order
  behind the providers that played, and the provider picker marks each
  `known issue` until it resolves once on your device.
- Windows: an install that sets `KUNAI_DATA_DIR` to a folder named `data`
  without using `KUNAI_CONFIG_DIR` (for example `C:\tools\kunai\data`) is
  mistaken for a profile and refuses to start with
  `has no valid .kunai-profile ownership marker`
  ([#864](https://github.com/KitsuneKode/kunai/issues/864)). Give the data
  folder another name. Default installs are not affected.

### Scope and qualification

- This release prioritizes the existing watching experience. Chromecast, the
  manga/comic reader, live TV/sports and torrent/debrid are outside its scope.
  Expanded YouTube channel browsing and recommendation features remain follow-up
  work; current source/quality improvements do not imply those features exist.
- Provider recovery does not guarantee every title is available. Live default
  route signoff, exact candidate installation/provenance checks and protected
  publication remain release gates. Local tests alone are not live playback or
  physical mobile-device qualification.
- Website footer, Kanna pause/resume and discovery metadata improvements ship
  through the website deployment. A merged source change does not establish
  that a hosted deployment has completed.

### Contributors

Thanks [@KitsuneKode](https://github.com/KitsuneKode) for the implementation.
The [full change history](https://github.com/KitsuneKode/kunai/compare/v0.3.0...v0.4.0)
retains the individual changes and their attribution.
