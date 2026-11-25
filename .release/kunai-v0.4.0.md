# Kunai 0.4.0

A focused watching update: clearer search and recovery, accurate source and
subtitle controls, and safer persistence, downloads and native installation.

### Highlights

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

### Catalog and settings

- Keep series details and episodes available from the last successful TMDB lookup.
  Search can fall back to Wikidata, and the series calendar can use TVmaze through
  mapped IDs. Diagnostics shows which source answered.
- Trending and recommendations retain usable results during upstream failures.
  Shared AniList requests reduce duplicate work across anime surfaces.
- Settings groups preferences into five sections. Add or remove personal TMDB and
  Wyzie keys there. Kunai uses the OS vault when available.
- A signed provider hotfix manifest delivers supported configuration updates.
  HDR and Dolby Vision selections preserve the chosen playback route.

### Playback and providers

- Preserve exact YouTube format IDs through quality selection and the options
  passed to yt-dlp. Quality changes retain the active client; client changes
  retain a compatible format; Auto returns to automatic selection. Deduplicate
  equivalent quality rows and hide redundant provider choices.
- Reuse already attached subtitle tracks when changing language. Reconcile
  native mpv selection and visibility, explicit Off, preferred-language late
  discovery and replacement files without multiplying tracks or overwriting
  an acknowledged preference with a stale observation.
- Expand supported HLS variants and manifest audio/subtitle renditions while
  preserving source identity and request headers. Present adaptive DASH as an
  honest Auto choice when independent representations are not selectable.
- Update provider extraction, failure classification, cancellation and endpoint
  health handling. Probe candidate media before reporting resolve success;
  rejected streams are not offered as playable quality choices. Empty provider
  replies become no-source results rather than internal errors.
- New profiles use VidLink for movies/series and HiAnime for anime. The remaining
  movie/series order is Rivestream, VidRock, Movy, Videasy; the anime order is
  KickAssAnime, AnimeGG, AllAnime, Miruro. Availability remains dependent on each
  upstream service and the user's network.
- Retire AniDB from the production roster. Migrate retired selections and remove
  its priority/pin entries without deleting history, offline files or unrelated
  provider preferences. Keep Videasy and AllAnime registered.
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

### State safety and privacy

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
- Preserve analytics opt-out and identity rotation across pending responses and
  concurrent saves. Setup requires an explicit consent action. Tests, installer
  fixtures and debug sandboxes isolate storage and suppress analytics; the
  dedicated analytics smoke only accepts an explicit numeric-loopback endpoint.

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
- Add experimental Android Termux targets and guarded external-player handoff.
  This is not a supported full mobile application; accepted OS handoff does not
  prove decoded playback, progress, completion or autoplay.
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
