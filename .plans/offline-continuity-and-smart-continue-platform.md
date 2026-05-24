# Offline Continuity And Smart Continue Platform

Status: approved design, implementation pending

Date: 2026-05-24

## Purpose

Turn Kunai's existing download and offline foundation into a first-class local
continuation experience:

- a downloaded title can deliberately remain ready ahead of the user's local
  viewing progress
- Continue Watching becomes a smart action surface without losing History's
  factual role
- newly aired episode state remains catalog-derived and honest
- provider traffic, filesystem validation, and maintenance work remain bounded,
  deduped, and explainable

This design extends, rather than replaces, the already implemented foundations:

- [background-release-reconciliation.md](./background-release-reconciliation.md)
  owns catalog-only `N new` projections.
- [binge-playback-handoff-provider-health.md](./binge-playback-handoff-provider-health.md)
  owns online playback prefetch, exact-match next handoff, provider health, and
  boundary-only fallback suggestions.
- [download-offline-onboarding.md](./download-offline-onboarding.md) and
  [../.docs/download-offline-onboarding.md](../.docs/download-offline-onboarding.md)
  own the current implemented queue, library, repair, and setup foundation.
- A later metadata/proxy dossier audit, including `https://db.videasy.net/3`,
  remains a separate catalog/provider-hardening track and must not be used to
  imply playable stream availability.

## Product Promise

Kunai supports two explicit experiences:

1. **Online viewing**: play streams and optionally perform one-off downloads
   through an explicit confirmation flow.
2. **Offline continuation**: when the user explicitly enrolls a downloaded
   anime or series title, Kunai keeps an approved, storage-safe local runway
   ahead of local playback progress.

Offline continuation is not general background downloading. Online streamed
playback does not silently generate download work. A release badge does not
silently generate download work. A browse or history row does not silently
generate provider work.

## Locked Decisions

- Provider resolution for download occurs only after explicit manual download
  confirmation or an already-approved offline title policy authorizes runway
  replenishment.
- Manual downloads remain one-off by default.
- Offline continuation is an explicit per-title enrollment for anime or series.
- Runway `N` means up to `N` ready next-unwatched local episodes when capacity
  permits, never a promise to fill storage.
- Movies may be downloaded and managed offline but do not have an episodic
  runway.
- Cleanup is safe-by-default and may be automated only by an explicit
  per-title policy.
- Offline playback uses the same shell interaction model and visual language as
  normal Kunai, with online-only behavior clearly unavailable when offline.
- `Zen` is a presentation mode. `Power Saver` is a compute/network policy.
- Continue Watching is action-ranked; History remains chronological and
  filterable.
- Smart Continue state is owned by an application read model, not duplicated in
  UI components.
- Release reconciliation is catalog-only, attention-weighted, deduped, and
  coalesced through one prioritized lane.
- Download attempt state and durable playable offline asset state are separate
  storage concerns.
- Existing completed or repairable download records adopt lazily into the new
  offline asset model without file moves or automatic redownload.

## Non-Negotiable Guardrails

- Do not resolve providers from Browse, Continue, History, Calendar, Queue,
  Library, settings, row selection, rendering, or keyboard navigation.
- Do not use release/catalog state as proof that a stream is playable.
- Do not scrape providers to detect newly aired episodes.
- Do not silently substitute a downloaded item for an explicit online playback
  choice, or vice versa.
- Manual `Next` remains next episode; it is not permission for autonext or
  download automation to take control.
- Do not mutate global provider preference because fallback worked for one
  title or one download attempt.
- Do not mix ephemeral online next-episode prefetch bundles with durable
  offline downloads.
- Do not scan or validate large offline libraries during ordinary list render
  or key movement.
- Do not delete local media merely to maintain a runway unless the title's
  explicit cleanup policy permits deletion and all protection rules pass.
- Do not describe ordinary slow or stale work as `degraded`; reserve that
  language for evidence-backed repeated provider/player/system failure.
- Never expose stream URLs, headers, cookies, tokens, or private local paths in
  exported/shareable diagnostics.

## Current Foundation And Immediate Corrections

The current implementation already provides durable `download_jobs`, retry and
shutdown recovery, optional artifact validation, repairable subtitle/artwork
states, `/downloads`, `/library`, cache-derived `N new`, and playback/provider
health hardening. The platform should build on those seams.

Before adding more prominent download entrypoints, fix the following cost and
authority hazards:

1. Check download eligibility before anime episode listing or any other
   provider work in download-only flows.
2. Replace repeated per-episode scans of active/completed job arrays with
   indexed repository lookup and atomic deduped admission.
3. Stop browse-result enrichment from validating hundreds of local artifacts;
   use stored manifest/read-model state and validate at lifecycle boundaries.
4. Remove immediate one-key auto-download cycling from Library; offline
   continuation enrollment and expansion must pass through staged settings or
   confirmation.
5. Make download processing resource-bounded; online playback never activates
   runway, and local playback runway processing remains conservative and
   capacity-aware.

## Architecture

### 1. Download Job Service

Responsibility: attempts and executable work.

It owns:

- user-authorized enqueue
- stream resolution at processing time
- progress, retry/backoff, pause, abort, and shutdown behavior
- attempt-level provider selection and diagnostics evidence
- promotion of a successfully validated video into the offline asset model

It does not own:

- what the user considers their local library
- per-title retention policy
- Continue Watching ranking
- release freshness

`download_jobs` remains a ledger of work and provenance.

### 2. Offline Asset Manifest

Responsibility: durable local playable truth.

It owns:

- local video artifact identity and readiness
- subtitle tracks and sidecar readiness
- thumbnail/poster cached artifact state
- persisted timing metadata used by local playback
- duration, file size, quality/audio/subtitle profile facts
- integrity state and repair state
- linkage to the attempt that produced or repaired it

A locally valid video remains playable when optional subtitle, artwork, or
timing assets are missing or repairable.

### 3. Offline Title Policy

Responsibility: explicit user intent per title.

It owns:

- offline continuation enrollment
- target runway count
- preferred audio/dub, subtitle tracks, and quality target
- artwork behavior
- cleanup/retention policy
- protection/pinning state

It is created only by deliberate user action. A one-off manual download must
not silently enroll the title.

### 4. Offline Runway Service

Responsibility: locally watched enrolled titles remain ready ahead of progress.

It owns:

- determining the next unwatched eligible episode identities
- comparing ready assets and active jobs against the target runway
- requesting missing approved download intents
- respecting airing truth, capacity, policy, Power Saver, and dedupe
- surfacing runway status for read models and diagnostics

It runs only for offline-enrolled anime/series consumed through local playback
or an explicit management action. It does not run because an online stream was
played.

### 5. Storage Budget Policy

Responsibility: storage admission and deletion safety.

It owns:

- required free-space reserve
- optional total offline-library budget
- admission estimates for queued work
- execution-time free-space recheck
- candidate cleanup evaluation
- low-space paused/blocking reason

Policy may be configured conservatively, but no per-title setting may defeat a
hard safety floor.

### 6. Continuation Projection Service

Responsibility: the single smart, local read model for user-facing attention.

It combines in bounded bulk reads:

- factual watch history
- cached release-progress projections
- offline asset readiness
- offline title policy and runway state
- pending/blocked/repair maintenance work
- current Zen/Power Saver policy

It produces stable rows and actions for Continue Watching and shared detail
surfaces. It never performs provider resolution or render-time catalog calls.

### 7. Prioritized Release Reconciliation Lane

Responsibility: determine newly aired/upcoming state from catalogs only.

It extends the existing release reconciliation path with attention priority:

1. explicit selected-title refresh and stale picker/detail context
2. active offline-enrolled title near runway need or airing window
3. recently watched Continue title
4. visible History or Calendar stale rows
5. dormant history under infrequent idle budget only

Requests for the same title coalesce. One in-flight catalog operation per
title is allowed. Failures preserve the last good projection and apply
backoff. No provider resolution is allowed in this lane.

## Proposed Storage Model

The following tables are additive to existing data storage. Names may be
adjusted to match repository conventions, but the ownership separation is
required.

### `offline_assets`

One row per playable local episode/movie artifact.

Representative fields:

```text
id
title_id
media_kind
season
episode
video_path
integrity_status             ready | missing | invalid-file | checking
duration_ms
file_size
quality_label
audio_profile
producing_download_job_id
last_validated_at
created_at
updated_at
```

Required indexes/constraints:

- unique local asset identity over title/media identity and canonical path
- indexed title/season/episode lookup
- indexed readiness and validation-due lookups

### `offline_asset_tracks`

One row per desired or stored subtitle/audio-related sidecar fact.

Representative fields:

```text
id
asset_id
kind                         subtitle
language
local_path
source_kind                  bundled | known-url | resolve-required | none
status                       ready | missing | repairable-known-url | needs-resolve | not-requested
last_error
updated_at
```

Multiple subtitle tracks may belong to the same playable video without
creating duplicate video downloads.

### `offline_asset_artwork`

Artwork and locally generated preview facts.

Representative fields:

```text
asset_id
thumbnail_path
poster_path
poster_url
policy_state                 full | cached-only | disabled
status                       ready-local | regeneratable | fetchable-known-url | unavailable | disabled
last_validated_at
updated_at
```

### `offline_title_policies`

One row per enrolled or overridden title.

Representative fields:

```text
title_id
media_kind
enabled
runway_target
audio_preference
subtitle_preferences_json
quality_preference
artwork_policy               full | cached-only | off
cleanup_policy_json
protected
created_at
updated_at
```

### `offline_maintenance_jobs`

Deduped non-video work.

Representative fields:

```text
id
asset_id
operation                    adopt | validate | subtitle-repair | artwork-generate | artwork-fetch
status                       queued | running | paused | completed | failed
authority                    local-safe | title-policy | explicit-user
attempt
next_retry_at
last_error
created_at
updated_at
```

Constraints:

- one queued/running operation of a given kind per asset
- maintenance jobs may not silently become video/media replacement jobs

## Migration And Adoption

Existing `download_jobs` remain valid history and continue to be readable
during migration.

Adoption behavior:

- A completed or repairable job is adopted when its title is opened in
  Library, its file is selected for playback, or a bounded maintenance sweep
  reaches it.
- Adoption is idempotent.
- Adoption never moves media files.
- Adoption never downloads, resolves providers, or fetches metadata merely to
  populate a new table.
- Existing subtitles, timing metadata, poster/thumbnail facts, duration, size,
  language hints, and selected quality are imported when present.
- Missing or corrupt files become manifest integrity states and stay
  diagnosable.
- Several historical attempts that reference the same playable file map to one
  asset while remaining as attempt records.
- Watch progress continues to join through title/episode identity and is not
  reset by adoption.

No blocking startup migration is permitted.

## Download Authority And Confirmation

### Manual Downloads

Manual download begins with a compact confirmation profile. It starts from
existing title/global settings or current playback selection, but the user can
change the offline intent before queueing.

The confirmation includes:

- title and episode scope
- audio/dub preference
- external subtitle preference, including none or known language choices
- quality target
- artwork behavior
- destination
- known/unknown size information
- current storage reserve outcome
- optional unchecked `Keep watching offline` enrollment for anime/series

A manual download that is not enrolled remains a one-off artifact.

### Offline Continuation Downloads

For an enrolled title, approved future jobs inherit the saved title profile.
If a profile can no longer be met, replenishment pauses with visible state
rather than silently downloading another language/source/quality variant.

### Forbidden Authority

The following must never trigger download provider resolution:

- opening or navigating Browse, Continue, History, Calendar, Queue, or Library
- showing `N new`
- selecting a row for detail preview
- artwork rendering
- Zen or Power Saver mode changes
- catalog reconciliation

## Runway And Storage Budget

### Runway Rules

- Runway is evaluated only for enabled anime/series title policies.
- It is driven by local playback progress and explicit management actions.
- It targets the next unwatched aired episodes.
- Ready assets and eligible queued/running jobs count toward the runway.
- An unaired episode is never admitted.
- A catalog-aired episode is not claimed playable before provider processing
  succeeds.
- Streamed online playback cannot automatically replenish the runway.

### Storage Admission

Admission uses:

- available bytes on the download volume
- configured hard free-space reserve
- optional offline-library budget
- existing assets
- already admitted queued/running work
- conservative estimate or unknown-size handling

The worker rechecks free space immediately before video transfer begins. If
capacity is no longer safe, the work transitions to a stable blocked/paused
state such as `blocked-low-space` rather than producing a retry loop.

### Cleanup

Global default: keep watched downloads.

Per-title permitted policies:

```text
Keep
Remove watched after X days
Keep last N watched episodes
```

Automatic cleanup must never remove:

- the currently playing asset
- unwatched runway assets
- the immediately required next local continuation asset
- protected or pinned assets
- assets under repair
- media whose policy does not explicitly authorize auto-removal

Low-space state should offer cleanup candidates first. If an explicitly
authorized auto-cleanup occurs, it records evidence and updates the manifest
atomically.

## Asset Repair And Recovery

### Automatic Under Safe Authority

The platform may automatically:

- validate an asset at playback or bounded maintenance boundaries
- regenerate a thumbnail from existing local video
- adopt existing local sidecars
- repair a known sidecar URL when enabled by the title profile and allowed by
  Power Saver/network policy
- update manifest state after those operations

### Requires Explicit Or Offline-Policy Authority

The platform may not automatically:

- freshly resolve a provider to repair missing video
- replace the video quality, audio version, or source
- choose a different subtitle/audio profile because the stored profile failed
- turn an asset repair into a new media download outside an enrolled runway

These require manual confirmation or a previously approved offline title
policy whose stored profile authorizes the intended episode download.

### State Semantics

Suggested manifest state families:

```text
video:    ready | missing | invalid-file | replacement-needed
subtitle: ready | repairable-known-url | needs-resolve | not-requested | optional-missing
artwork:  ready-local | regeneratable | fetchable-known-url | disabled | unavailable
timing:   cached | missing | stale | not-applicable
runway:   healthy | filling | paused-low-space | profile-unavailable | repair-needed
```

Optional material never invalidates an otherwise ready local video.

## Continue Watching And History

### Continue Watching

Continue is a smart action-ranked surface, powered by
`ContinuationProjectionService`.

Default attention ordering:

1. partially watched item with direct resume action
2. offline-enrolled title with locally ready next episode
3. title with newly aired episodes since the user's watched anchor
4. enrolled title whose runway is filling, blocked, or repairable
5. recently completed title with a known upcoming release
6. older active titles

Example row text:

```text
Resume E04 · 13:12 remaining
Offline ready · E05 available locally
3 new episodes · watched through E04
Runway filling · 2 of 3 ready
Paused · free space below reserve
Caught up · next episode Sunday
```

### History

History remains chronological by playback activity and continues to be the
trustworthy record of watched behavior.

Useful filters:

```text
Watching
New episodes
Offline ready
Completed
Needs attention
```

History rows reuse the same projection vocabulary but do not become a
recommendation-ranked feed by default.

### Shared Projection Contract

Representative read-model output:

```ts
type ContinuationRow = {
  titleId: string;
  actionKind: "resume-local" | "resume-online" | "new-aired" | "offline-ready" | "upcoming";
  attentionRank: number;
  lastWatched: EpisodeCursor;
  nextActionEpisode?: EpisodeCursor;
  newEpisodeCount?: number;
  offlineReadyCount?: number;
  runwayState?: "healthy" | "filling" | "paused-low-space" | "repair-needed";
  nextReleaseAt?: string;
  badges: readonly ContinuationBadge[];
  availableActions: readonly ContinuationAction[];
  freshness: "fresh" | "stale" | "unknown";
};
```

The exact types should follow existing domain conventions, but ranking,
wording inputs, action availability, and freshness decisions belong in the
read model rather than each UI surface.

## Offline Shell Experience

Offline is the same Kunai shell with a local-only capability map, not a
reduced fallback application.

It should retain:

- title details and local artwork when permitted and available
- local episode picker and resume progress
- stored IntroDB/AniSkip timing behavior and autoskip settings
- stored subtitle selection and track status
- queue, repair, cleanup, and policy management
- the same keyboard vocabulary and status language as normal shell flows

Online-only actions are explicitly disabled or replaced with a safe local
alternative. Selecting an offline row never silently resolves online.

### Distinct Surfaces

Keep the concepts distinct:

- `/download`: initiate a confirmed one-off download or optional enrollment
- `/downloads`: operational queue, attempts, retries, repair, and progress
- `/library` / `/offline`: durable playable local assets and title policies
- Continue: action-ranked local/cached attention surface
- History: chronological playback facts and filters

## Zen And Power Saver

### Zen

Zen is presentation-only:

- calmer density
- fewer incidental badges and helper lines
- optional hiding of imagery or supplementary detail

Zen does not modify correctness, provider authority, reconciliation policy, or
download/storage behavior.

### Power Saver

Power Saver is explicit compute/network policy:

- no incidental artwork network fetch/generation unless requested
- no speculative online stream prefetch
- no recommendation warming
- reduced optional diagnostics sampling
- no passive low-priority reconciliation sweep
- offline runway evaluation only after local completion/progress boundary or
  explicit request
- already-local thumbnails/posters may still render unless imagery is disabled

Manual actions remain available. Cached release truth remains visible with
freshness status; Power Saver may delay optional refresh but may not falsify or
hide essential state.

## Release Reconciliation Extension

The existing release-progress cache remains derived catalog state and must stay
separate from history and asset storage.

Enhance the existing coalescing scheduler with priority promotion:

```text
priority 1: selected stale title or explicit refresh
priority 2: active offline-enrolled title near runway need/release window
priority 3: recently watched Continue title
priority 4: visible stale History/Calendar title
priority 5: dormant history idle maintenance
```

Required behavior:

- selected title may display cached state immediately plus refreshing status
- duplicate requests for a title merge across surfaces
- one in-flight catalog request per title
- source rate budgets and backoff remain enforced
- known next airing time schedules refresh near the airing boundary
- last-good projection survives transient catalog failure
- Power Saver allows explicit/necessary tiers and suppresses passive tiers
- this lane never resolves providers or schedules downloads itself

Open catalog limitation to preserve: TV cross-season `N new` and related
download actions remain deferred until TMDB TV-details-backed season rollover
can be represented without guessing.

## Playback And Provider Boundary

Do not duplicate or weaken the existing playback plan:

- Online next-episode prefetch is ephemeral, exact-match, and scoped to the
  immediate next playable episode.
- Durable offline runway jobs are separate work and must suppress/deprioritize
  redundant ephemeral preparation only when the exact same next local asset is
  already ready or being deliberately prepared.
- Manual `Next` means next episode; no offline policy changes navigation intent.
- `recover` remains fresh repair of current playback with resume semantics.
- `replay`/`restart` remains replay from the beginning without forcing a
  provider refresh.
- Fallback health evidence remains title/provider scoped and user-controlled.
- Offline state and local network absence do not count as provider-health
  failures.

## UI Surfaces And Actions

### Download Confirmation

Shows:

- episode scope
- inherited/editable audio/dub, subtitle, and quality profile
- artwork behavior
- storage destination
- known or unknown size status
- current reserve-space outcome
- optional `Keep watching offline` enrollment checkbox for anime/series

### Downloads Queue

Shows:

- queued/running/completed-recently jobs
- paused-low-space/profile-unavailable states
- attempts, progress, retry and abort
- sidecar maintenance/repair work separated from video replacement work

### Offline Library And Title Detail

Shows:

- ready and repairable assets by title/episode
- watch progress and resume actions
- size/duration/thumbnail/subtitle/timing facts
- enrollment and runway status
- cleanup policy and protection
- actions to play, manage profile, repair, download more, or review cleanup

### Continue And History

Shows the projection language and actions described above. Row selection and
detail preview remain local/cache reads only.

### Settings

Adds staged controls for:

- global offline download defaults
- free-space reserve and optional maximum budget
- default manual download profile
- per-title offline enrollment/profile management
- artwork behavior / imagery enablement
- Zen mode
- Power Saver mode
- cleanup defaults

The current immediate auto-download keyboard cycling in Library is removed or
converted into a shortcut that opens the staged policy flow.

## Diagnostics And Privacy

Record enough evidence to explain:

- what authorized a job or maintenance operation
- admission and execution-time storage decision
- job attempt progression and retry reason
- asset validation and adoption
- sidecar repair behavior
- runway state and blocked reason
- cleanup candidate or completed deletion decision
- reconciliation trigger, priority, source, count, next due time, and failure
- Power Saver suppression of optional work

Shareable/exported reports must redact or omit:

- raw playable URLs
- request headers, cookies, and tokens
- private local filesystem paths

## Efficiency And Anti-N+1 Requirements

- One indexed episode/profile admission query replaces list scans for dedupe.
- One bulk query composes Continue/History local facts for a visible window.
- One deduped maintenance operation per asset and operation type.
- One coalesced catalog reconciliation operation per title at a time.
- No row-render, focus-change, keypress, or per-frame network work.
- No browse-time filesystem sweep for offline badges.
- No all-history reconciliation on shell entry.
- No provider probing of a watchlist or all enrolled titles without explicit
  queued authority and budget.
- Work that becomes irrelevant after navigation is cancellable, while healthy
  completed metadata writes may be cached safely.

## Implementation Slices

### Slice 0: Correct Existing Authority And Cost Issues

- Move feature/eligibility checks before provider episode-listing in download
  initiation paths.
- Replace per-target list scans with repository-level indexed dedupe/admission.
- Remove ordinary browse-time bulk artifact validation.
- Remove immediate auto-download cycle behavior from Library.
- Add tests proving zero provider calls in gated/idle surfaces.

### Slice 1: Durable Offline Asset Foundation

- Add offline asset, track, artwork, title-policy, and maintenance storage
  repositories and migrations.
- Add lazy adoption of existing completed/repairable download jobs.
- Preserve current Library behavior through a compatibility read path during
  migration.
- Add idempotency and no-redownload migration tests.

### Slice 2: Download Profile, Repair, And Storage Budget

- Add compact manual download confirmation profile.
- Add per-title policy management and explicit enrollment.
- Implement storage admission/execution rechecks and stable low-space state.
- Move sidecar maintenance into the asset/maintenance model while preserving
  playable video semantics.

### Slice 3: Offline Runway And Cleanup

- Add offline-only runway planner/service.
- Trigger replenishment after local progress/completion and explicit manage
  actions.
- Add per-title cleanup policy and candidate/review actions.
- Protect current, unwatched, pinned, and repair-in-progress assets.

### Slice 4: Smart Continue And History

- Add `ContinuationProjectionService`.
- Upgrade Continue Watching ranking and row actions.
- Keep History chronological with filters and shared projection detail.
- Project offline-ready/runway/repair states into Browse idle and title detail
  only from local/cached facts.

### Slice 5: Priority Reconciliation And Release Actions

- Extend the existing reconciliation lane with title priority promotion.
- Add stale-on-demand title refresh from eligible detail/picker contexts.
- Add explicit `Download new episodes` and offline enrollment actions powered
  by catalog projection, without provider work until confirmed processing.
- Keep TV cross-season download-new deferred until catalog truth supports it.

### Slice 6: Zen And Power Saver

- Add presentation-only Zen controls.
- Add explicit workload suppression policy for Power Saver.
- Add imagery enable/disable behavior and already-local media rendering rules.
- Test suppression without hiding cached truth or manual actions.

### Separate Follow-Up: Proxy And Catalog Metadata Dossier

- Audit `https://db.videasy.net/3` metadata coverage, identity correctness,
  cache behavior, rate limits, failure modes, and safe catalog enrichment
  opportunities.
- Keep findings out of playable/provider claims unless direct-provider
  resolution separately proves playability.
- Decide whether any new metadata belongs in schedule/release projections only
  after the audit is documented.

## Verification Requirements

### Unit And Repository Tests

- storage migrations and indexed dedupe
- lazy manifest adoption and idempotency
- title-policy normalization and precedence
- storage-budget admission and execution-time blocking
- runway planning for ready, queued, unaired, insufficient-space, and profile
  unavailable states
- repair authority classification
- cleanup protection rules
- continuation ranking and action availability
- reconciliation priority/coalescing/backoff
- Zen and Power Saver policy decisions

### Integration Tests

- manual confirmation to completed asset manifest
- one-off download does not enroll title
- enrolled local playback queues only missing approved runway episodes
- streamed playback does not queue runway downloads
- low-space pauses work without retry storms
- subtitle/artwork repair leaves valid video playable
- legacy job adoption preserves local play/resume behavior
- Continue and History surfaces use one read model without provider calls
- multiple surface refresh requests coalesce to one catalog operation per title

### Manual Smoke

- one manual anime/series download with changed subtitle preference
- one enrolled offline title continuing from local episode to replenished next
  episode
- low-space warning and cleanup review flow
- local playback with thumbnail/artwork enabled and disabled
- Zen presentation and Power Saver workload suppression
- repaired subtitle/artwork state without video redownload
- Continue ranking for resume, offline-ready, `N new`, and upcoming release
- one bounded catalog metadata verification; live provider checks remain
  deliberate pre-release smoke only

### Repo Gates

When implementation slices land:

```sh
bun run fmt
bun run typecheck
bun run lint
bun run test
bun run build
```

## Completion Criteria

The platform is complete for this design when:

- all provider/download authority boundaries are enforced and tested
- offline library truth no longer depends on job rows alone
- enrolled local viewing maintains a capacity-safe local runway
- cleanup and repair are predictable, reversible where applicable, and
  diagnosable
- Continue Watching offers premium action ranking from one backend read model
- History remains honest and useful
- release freshness is smart without broad or repeated catalog work
- Zen and Power Saver make their differing promises explicit
- existing user downloads are adopted without loss or surprise network work
- manual and deterministic verification proves no hidden overfetch paths
