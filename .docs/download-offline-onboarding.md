---
status: current
lastReviewed: "2026-08-24"
---

# Kunai — Download, Offline Library, And Onboarding

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

This is the canonical design reference for future download/offline/onboarding work.

Status: in progress (`--download`, `/download`, `/downloads`, `/library`, validated
`--offline`, local poster/timing/duration metadata, local resume progress, repairable sidecar states,
best-effort cached poster artwork, editable confirmation-gated manual profiles, title-scoped offline
runway decisions, cleanup preferences, and explicit History local handoff are implemented; daemon
extraction is still pending).

## Product Shape

Downloads should be a local-first capability:

- current stream plus headers are handed to a local downloader
- status is visible in the shell
- finished files appear in an offline library
- missing dependencies are explained at point of use

The feature must not make startup slower or more fragile.

## Proposed Layers

| Layer             | Responsibility                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Onboarding wizard | First-run dependency checks, opt-in features, setup rerun                                                    |
| Feature gate      | Pure capability checks such as downloads enabled and `yt-dlp` available                                      |
| Download service  | Queue, yt-dlp process lifecycle, progress, retries, SQLite state                                             |
| Media artifacts   | Persist poster URL, cached IntroDB/AniSkip timing, duration, subtitles, and optional poster-artwork sidecars |
| Offline library   | Browse and play completed local files from stored download metadata                                          |
| Source policy     | Decide local-vs-online actions from cached local state without provider work                                 |
| Notification rail | Small queued status messages for downloads, updates, and offline prompts                                     |

Layering rule: UI asks services for capability/state; services do not render UI.

## Setup Wizard Behavior

Seven screens, in order: dependencies, mode, language, playback, downloads &
accounts, usage ping, done. Implementation is
`apps/cli/src/app-shell/setup-shell.tsx`; the write map is
`runSetupWizard` in `apps/cli/src/app-shell/workflows/setup-workflows.ts`.

- **Every control hydrates from the live config.** `wizardInitialStateFromConfig`
  reads mode, language, playback toggles, download enablement and quality,
  `sync.<tracker>.enabled`, and the presence provider. A rerun therefore shows
  what is really set, and completing it writes back exactly what the screens
  showed. Hydrated download enablement is clamped to whether `yt-dlp` is
  actually present, the same clamp `[r]` re-probe applies.
- **`s` applies this screen's recommendation and advances.** It resets only the
  current screen's decision — mode to shows, language to original/en, playback to
  all on, quality to 1080p. Standing decisions (account links, downloads
  enablement, presence) have no recommendation other than what the user already
  has, so `s` never flips one.
- **`S` accepts every remaining recommendation and finishes.** On the consent
  screen it stops instead of passing through.
- **`esc`/`q` discard.** Free from the first screen, because nothing has been
  decided; past it they ask once and a second press confirms. Any other key
  stands the prompt down and is consumed.
- **The onboarding gate moves only when the user engaged.** An abort from the
  first screen leaves `onboardingVersion` below the onboarded floor so the next
  launch offers setup again; an abort after answering records the offer and
  touches nothing else.
- **The language answer reaches all four lanes** — anime, series, movie, and
  YouTube — for both audio and subtitles. Writing three of them was what made
  screen 3 configure every lane except the one a YouTube user had just picked.
- **Analytics is keystroke-gated.** Consent is recorded when the user presses a
  key on the consent screen, never when they arrive on it. Arriving and stepping
  back leaves the value `unchanged`, which is neither an opt-in nor an opt-out.
  See [analytics-privacy-contract.md](analytics-privacy-contract.md).
- **Account links run after config commits, and only report success.**
  `sync.<tracker>.enabled` flips true only once `connect()` returns ok, so a
  standing "yes" in config always has a token behind it. An already-connected
  adapter short-circuits rather than opening a second browser round-trip, and no
  abort path connects anything.
- **One restore point per setup run.** Before a completing run writes, the
  current config is copied to `config.json.pre-setup.bak` — but only when the
  patch actually changes a field the user would miss (`RESTORABLE_SETUP_FIELDS`
  in `apps/cli/src/services/persistence/pre-setup-snapshot.ts`). Onboarding
  bookkeeping and analytics consent are deliberately not among them. The write is
  best effort and never blocks setup; `/settings` → General → _Undo the last
  setup run_ restores it.

## Desired Download Behavior

- Downloads use **`yt-dlp`**; **`ffprobe`** on `PATH` is optional for validating completed artifacts.
- Offline artwork uses cached poster assets when available; local video thumbnail generation is not part of the release path.
- Downloads are opt-in and blocked at enqueue time when feature gates are not usable.
- Manual download-only actions show the effective audio/subtitle/quality/artwork/location profile
  before enqueue. The confirmation can cycle subtitle/quality, toggle artwork, choose the configured
  or default destination, set bounded runway intent, and choose watched-cleanup suggestions. Set a
  new destination path in Settings. Provider stream resolution begins only after final confirmation;
  anime title selection does not scrape provider episode lists merely to render the confirmation path.
- Manual confirmation can enroll a series title in bounded `Keep watching offline`; that policy
  applies only to downloaded playback continuity and never turns streamed playback into hidden downloads.
- One-off series downloads still store the selected title cleanup/profile intent for local management,
  but do not schedule offline runway work unless `Keep watching offline` was selected and do not
  revoke an existing title enrollment.
- HLS size is reported honestly as unknown when content length cannot be known.
- Temporary files use a `.tmp.*` suffix, validate after a clean exit, and are renamed only
  after that validation. An invalid candidate never replaces an existing playable output.
- Queue ownership is a SQLite compare-and-set from `queued` to `running`. Heartbeats form a
  bounded lease across Kunai processes; recovery never touches a freshly heartbeating owner.
- Blocking download intent is unique in SQLite by canonical title and exact nullable
  season/episode coordinates plus exact provider-native episode identity. Concurrent surfaces or
  Kunai processes therefore admit one matching job; the loser receives the ordinary
  duplicate-intent result instead of sharing an output path.
- Provider-catalog episode jobs persist the selected opaque provider episode identity alongside
  the 1-based UI position. Delayed processing, retry, and restart recovery re-resolve that exact
  provider row. Completed-asset admission, the offline manifest, download badges, and local
  playback use the same identity, so catalog churn at one UI position neither blocks the new row
  nor serves the old artifact. Legacy jobs and assets without an identity retain the numeric
  fallback when the current request also has no provider-catalog identity.
- Once an interrupted lease expires, recovery validates any already-published output. A valid
  artifact is adopted without another network request; an invalid regular file is removed before
  bounded retry. This closes the unavoidable filesystem-rename/SQLite-commit crash window.
- Abort terminates active download processes (`yt-dlp`), deletes temporary files, and persists an aborted job state.
- App shutdown pauses active downloads, cleans temporary workers, and leaves jobs retryable.
- Failed jobs retry with bounded backoff and then surface as failed when retry limits are exhausted.
- Background queue triggers enter through one supervised seam. An unexpected
  reconciliation, repository, filesystem, or worker failure records a redacted
  download diagnostic and cannot terminate playback or the CLI.
- Explicitly awaited queue processing and drain calls still reject on unexpected
  failures so download-only mode, shutdown, tests, and operators receive honest
  failure semantics.
- Quit with active downloads asks whether to keep, wait, or cancel; Ctrl+C and signals use the same cleanup path.
- Progress is parsed from yt-dlp newline output and persisted for shell diagnostics/UI.
- Download-only mode resolves a playable stream without launching mpv.
- Selected poster URL and IntroDB/AniSkip timing are persisted at enqueue time when available.
- Completed downloads persist local file size and, when `ffprobe` is available, playable duration after artifact validation. The optional probe has a 30-second deadline, then graceful termination and bounded force-kill cleanup; a probe timeout fails validation without publishing its temporary artifact or deleting a previously published file as corrupt.
- Offline artwork caching is best-effort and post-completion; artwork failure must never fail or delay a completed download.
- Thumbnail sidecars are written through a temporary file and renamed only after a non-empty image exists.
- External subtitle/artwork sidecars are repairable metadata, not proof the video failed. If the video artifact validates but an expected sidecar is missing, the job becomes `repairable` and `/downloads` can retry just the sidecar path without re-running `yt-dlp`.
- If the stream is hard-subbed or no external subtitle URL exists, subtitle sidecar work is marked not-applicable/expected-missing as appropriate; it should not be reported as a full download failure.

## Canonical Media Presentation

`apps/cli/src/domain/media/media-presentation.ts` is the single authority for how a piece of
media names itself. It is pure: callers pass what they stored, it answers what the user should
see. Queue rows, the offline shelf, notifications, the mpv display title, the download
confirmation, and filesystem naming all consume it instead of re-deriving "is this a movie?".

- Movies are **title-level** downloads. `DownloadIntentService` and `DownloadService` persist a
  movie (and a video) as one title-level job; only series and anime fall back to an episode slot.
  A movie displays `Movie` and never a synthetic `S01E01`.
- Series display `SxxExx`.
- Anime display episode-only `Exx` unless the season is provably meaningful (a real multi-season
  identity, not a defaulted slot).
- Videos keep their own identity rather than borrowing series labels.
- Legacy movie rows persisted with a placeholder season 1 / episode 1 remain supported and are
  re-labelled on read. There is no destructive migration.
- `download-path-naming.ts` consumes `CanonicalMediaPosition` **before** sanitization: it adds
  path-safe encoding only and never reinterprets content kind.

## Download And Library Layout Ownership

- Inside a root-owned overlay, `OverlayLayoutProvider.contentColumns` is the authoritative width
  budget. Reading raw terminal columns is what let download rows overflow their frame.
- Narrow downloads stay full-width and actionable with no companion rail. A wide overlay adds one
  constrained selected-job rail; the rail is driven by the **settled** selection
  (`useSettledValue`), so a held arrow key moves the cursor immediately and never spawns a poster
  render per row.
- Rails that can be on screen together name different Kitty placement slots
  (`download-manager-preview`, `browse-preview`, `overlay-picker`, …); sharing a slot evicts the
  other rail's live placement.
- The download confirmation's poster identity is **title-level** and draft-independent: editing
  audio, subtitle, quality, artwork, destination, runway, or cleanup never re-requests artwork or
  replaces the placement.

## Offline Title Identity

One title reaches the offline layer under several id forms — a provider-native handle, a raw
catalog id, or a canonical `tmdb:`/AniList id — depending on how enriched the title was at the
moment. Writes and reads used to canonicalise independently, so an asset stored under `1339713`
was looked up as `tmdb:1339713` and a healthy file reported "Downloaded file unavailable".

- **`OfflineTitleIdentityService` is the only answer** to which id an asset is filed under.
  `resolveForJob` decides where a completed download is stored; `resolveForTitle` decides what
  every read asks for. Neither side canonicalises on its own, and no read may ask under two ids.
- **`download_jobs.external_ids_json` is the download's own record** of the ids the title arrived
  with. Nothing may re-derive external ids from a title id — the derivation that did turned a
  MAL-only anime into `{ anilistId: <malId> }`.
- **Aliases are registered at enqueue** (`downloadTitleAliases`) as well as on every history
  upsert, so a title that was only ever downloaded still participates in
  `history_title_aliases`.
- **Stale filing is repaired, not tolerated.** When resolution moves a title off the id it
  arrived with, assets still filed under the old id are relocated (once per id per session).
  `runOfflineAssetIdentityBackfill` covers the other trigger — rows whose canonical id the alias
  index already knows but which nothing has browsed — and runs on **every** bootstrap, because an
  asset only becomes relocatable once something teaches the index the title's ids, and that
  learning has no deadline.

## Desired Offline Behavior

- No aggressive startup network probe.
- Offline prompt appears only after a real network failure.
- Runtime network status is **offline** (connect/DNS/unreachable — including Bun's
  "Unable to connect" fetch string) or **limited** (timeouts). Confirmed offline is
  sticky until a later success: a TMDB/proxy fallback that only times out must not
  reclassify the session as flaky. Limited still counts as online for retries.
  A failed search keeps its query editable, marks search state as failed, and
  returns to browse with visible retry and `/offline` guidance instead of
  remounting into a silent automatic-retry loop.
- `--offline` and `/library` list completed `download_jobs` and validate artifact readability.
- Local files should validate before playback; corrupt or missing files should offer re-download, not crash.
- Offline episode rows may show resume percentage or watched state from local history. This is derived from local
  SQLite history and download metadata only; opening the library must not call providers.
- Offline playback uses the shared source-selection policy as a local-only entrypoint:
  ready files play locally, broken files surface repair actions, and no provider resolve is
  triggered merely because the user opened or selected an offline row.
- Normal online search keeps provider playback online-first by default even when a downloaded
  copy exists; downloaded state is a badge/action, not a silent hijack.
- Continue-style flows may prefer a ready local file before provider resolution, but online
  continuation must remain an explicit action when local episodes are exhausted or broken.
- History/Continue rows may promote a cached downloaded next episode and show cached `N new`.
  When durable local identity exists, Enter explicitly plays that downloaded episode through the
  validated offline path. Otherwise the row directs the user to `/library`; ordinary online history
  playback is never silently replaced.
- Offline title actions may choose to keep the latest watched local episode or apply a configured
  grace window to cleanup suggestions. The global cleanup setting remains the master gate and these
  controls do not delete files as a side effect of selection.
- Local playback uses the same persisted/session autoskip policy as online playback so intro,
  recap, preview, and credits behavior does not unexpectedly change between streamed and
  downloaded files.
- `--offline` is a transient runtime override: it sets offline connectivity before startup
  workers begin, skips download processing, update checks, analytics, and sync identity work,
  and opens the local library without provider resolution.
- An offline-library launch keeps its explicit local-only origin through episode selection and
  playback. The validated local source is handed to the local mpv path, including local subtitle
  sidecars, rather than being represented as a remote stream URL.
- The full player-options path preserves that verified origin by exact media/sidecar path match, so
  resume, autoplay, timing, track preferences, and cancellation remain available without weakening
  mpv URL safety. A local launch failure is a local player problem: it never invalidates provider
  caches or enters source/provider failover.
- Offline playback does not start remote subtitle or timing-metadata lookup, provider prefetch, or
  recommendation warming. Local next-episode readiness, cached timing, and local subtitle sidecars
  remain available.
- Offline asset lookup uses the same canonical title identity as download enqueue. This covers
  provider-native anime ids, canonical AniList/TMDB ids, and YouTube ids across download, library,
  and normal playback surfaces.
- A `repairable` sidecar status does not make the video unplayable. The library validates the
  primary video independently and keeps a valid local artifact available while exposing sidecar
  repair actions.
- Offline shelf rows are grouped by title and may render the best local preview image:
  cached poster artwork first, then persisted poster URL, then text-only fallback.
- Offline title rows should surface local facts that are already in SQLite or on disk:
  playable count, repair count, cached subtitles, timing metadata, artwork
  availability, duration, size, watch progress, and the first few local episode rows. Opening the library must
  not call providers.
- Opening `/offline` must not fetch remote metadata. Stored poster URLs are only fetched by the
  terminal image renderer when the selected row needs a preview.
- Deleting a downloaded artifact removes the media file, subtitle sidecar, recorded artwork sidecar,
  and deterministic derived artwork path to avoid orphaned local preview files.

## Config Fields (current + planned)

Keep config flat unless the config model is deliberately refactored:

- Current:
  - `onboardingVersion`
  - `downloadsEnabled`
  - `downloadPath`
  - `downloadOnboardingDismissed`
- Planned follow-up fields:
  - `suppressOfflinePrompt` (or keep `downloadOnboardingDismissed` as the canonical equivalent)
  - `autoSkip`

Current offline follow-up is indexed in [the roadmap](../.plans/roadmap.md). Do
not reopen the archived onboarding plan to infer current behavior.
