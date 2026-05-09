# Runtime Maintainability, Product Guardrails, And Adaptive Downloads Design

Status: reviewed design

## Goal

Make Kunai's CLI/package boundaries, user-facing defaults, failure paths, and developer guardrails easier to reason about before the runtime grows into web, desktop, daemon, and batch download surfaces. This is not only a download plan. Downloads are the first obvious performance hotspot, but the pass must also cover setup/onboarding, subtitles, audio language, provider/source contracts, diagnostics, side-effect isolation, repeated code, naming, and tests that keep the shape from drifting.

## Current Findings

- The intended architecture is already clear: UI emits intent, app policy decides deterministic behavior, services coordinate work, providers return facts, infra performs local mechanics, and storage persists facts.
- The current package split is mostly healthy: `@kunai/types`, `@kunai/schemas`, `@kunai/core`, `@kunai/storage`, `@kunai/providers`, and `@kunai/design` exist and are used by `apps/cli`.
- The CLI still has several oversized files that mix concerns. The highest-risk examples are `apps/cli/src/services/download/DownloadService.ts`, `apps/cli/src/app/PlaybackPhase.ts`, `apps/cli/src/app-shell/ink-shell.tsx`, and `apps/cli/src/app-shell/workflows.ts`.
- Downloads currently have a sequential queue worker and a fixed yt-dlp fragment count. `processQueue()` processes one job at a time, while each job uses `--concurrent-fragments 16`.
- mpv is mostly isolated under `apps/cli/src/infra/player`, but the top-level `apps/cli/src/mpv.ts` is now infra code in practice and is imported by player infra. That file should move or split under `infra/player` before more player behavior lands.
- Existing architecture tests guard legacy imports and prevent app-shell from importing provider/player runtime internals, but they do not yet enforce package dependency direction or CLI layer direction.
- Runtime language defaults exist in both config and initial session state: anime uses original audio plus English subtitles, series uses original audio plus no subtitles, and movies use original audio plus English subtitles. Setup does not currently guide the user through these choices, even though language/subtitle defaults materially affect the first playback experience.
- The setup wizard currently explains dependencies, posters, and downloads. It should also configure important playback preferences and explain what missing dependencies disable without turning first run into a blocking modal wizard.
- Subtitle handling already distinguishes `none`, interactive picking, configured language selection, provider defaults, hard-sub satisfaction, and no-track cases. The maintainability pass should preserve those semantics while making them visible and testable.
- Provider docs already say providers should expose source, quality, audio, subtitle, trace, and structured failure evidence when possible. The CLI still has scattered policy code that should converge around those contracts rather than duplicating language/source decisions in local flows.

## Boundary Decisions

### Packages

`packages/types` owns serializable contracts only. It must not import runtime packages, UI, storage, providers, or app policy.

`packages/schemas` owns Zod validation for untrusted or persisted boundaries. It may depend on `@kunai/types`, but should not encode product policy.

`packages/core` owns provider contracts, provider manifests, resolver primitives, fallback orchestration, cache-key policy, and resolve traces. It must not depend on CLI services, mpv, Ink, local config, or SQLite repositories.

`packages/providers` owns provider-specific extraction and provider-local retry/evidence. It may depend on `@kunai/core` and `@kunai/types`, but should not depend on app settings, global fallback UI, history, mpv, or storage repositories.

`packages/storage` owns paths, migrations, SQLite connection setup, repositories, TTL helpers, and persisted row mapping. It must not own UI behavior, provider scraping, player IPC, or app fallback policy.

Future `@kunai/config` is justified when config validation/defaulting starts being shared outside the CLI. Do not extract it just for style.

Future `@kunai/ui-cli` is justified after the app-shell files are smaller and stable enough to export clean primitives. Do not extract unfinished shell behavior into a package.

### CLI Layers

`apps/cli/src/app-shell` renders and collects user intent. It should consume command contexts, session state, and service summaries, not raw provider/player/download mechanics.

`apps/cli/src/app` owns session phases and user-intent policy. It decides what "resume", "next", "retry", "download", "source change", and "offline playback" mean.

`apps/cli/src/services` coordinates app workflows such as playback resolution, source inventory, downloads, diagnostics, search/catalog, recommendations, and presence. Services can use infra ports and storage repositories, but should not render UI.

`apps/cli/src/infra` owns local mechanics: mpv process/IPC, yt-dlp process execution, filesystem primitives, OS integration, terminal mechanics, timing sources, and work cancellation.

`apps/cli/src/domain` owns pure state and policies shared by app and shell, with no process or storage side effects.

## Product And Setup Design

The setup flow should become the place where users make first-run choices that meaningfully change playback results, while settings remains the place to revise them later.

Setup should cover:

- required dependency state: `mpv`
- optional capability state: `yt-dlp`, `ffprobe`, poster/image support, Discord presence readiness
- default startup mode: series or anime
- default providers for series/movie and anime
- anime language profile: audio and subtitles
- series language profile: audio and subtitles
- movie language profile: audio and subtitles
- download enablement and path
- key recovery preferences only when they are understandable during onboarding

The setup flow should not silently install system dependencies. It should show the issue, explain what feature is affected, and give platform-specific remediation. Missing optional dependencies should not block normal playback.

Default language choices should be intentional:

- `audio: "original"` is a good cross-provider default because it lets mpv prefer native/original tracks without pretending every provider exposes track metadata.
- `anime.subtitle: "en"` is a good default for most sub-first anime usage.
- `movie.subtitle: "en"` is a good default because soft subtitles are often useful and low-surprise.
- `series.subtitle: "none"` is defensible for English-first TV defaults, but it should not be hidden. Setup should explicitly ask whether users want English subtitles for series by default, no subtitles, or interactive picking.

User-facing copy should explain `none` as "do not attach subtitles by design", not as a missing-subtitle failure. Diagnostics should still distinguish disabled subtitles from provider missing data.

## Playback Preferences And Language Contracts

Playback preferences should be represented as structured profiles:

- `audio`: original, English, Japanese, dub, or future normalized language code
- `subtitle`: none, interactive, English, or future normalized language code

These profiles should flow through:

- search/provider-native mapping
- provider resolve input
- cache/source-inventory keys
- subtitle selection
- mpv argument construction
- diagnostics and panels
- download re-resolve intent

Do not read raw config in multiple deep places when a phase or service can pass a normalized playback preference object. Repeated branches like "if anime mode use anime profile else use series profile" should be extracted into a pure helper so search, playback, download, and panels cannot drift.

Subtitles must keep explicit reasons:

- disabled by user preference
- hard-sub satisfies preference
- provider default used
- configured language auto-selected
- interactive selection picked
- interactive selection cancelled
- provider had no usable tracks
- provider did not expose inventory

Audio must follow the same model as providers mature:

- requested preference
- selected or inferred audio language when known
- provider did not expose audio inventory
- mpv received only a preference hint

The UI should not imply certainty when the provider only accepted a hint.

## Reliability And Side-Effect Boundaries

Side effects should be behind narrow ports:

- config writes happen only through config service/store
- history writes happen only after app policy decides the result is persistable
- cache writes are best-effort and must not turn a successful playback into a user-facing failure
- provider modules do not write storage, config, history, or UI state
- player infra does not decide user-facing playback policy
- shell components do not spawn processes or mutate storage directly
- download process termination and temp-file cleanup are idempotent
- signal handling uses the same cleanup path as explicit quit

Errors should be typed or classified before crossing layers. A user-facing shell should receive a reason, severity, and next action, not raw exception text unless diagnostics/debug panels are explicitly showing raw detail.

Failure handling should be deterministic:

- provider-local retries are bounded inside provider/adapters
- app-level fallback chooses the next provider/source with trace evidence
- mpv IPC failures become playback failure classes with recovery actions
- downloads classify failure kind before retrying
- setup/capability failures show feature impact and remediation

## Maintainability And DRY Targets

Extract shared logic when two or more surfaces encode the same decision:

- playback preference resolution by mode/media kind
- subtitle/audio option definitions and labels
- setup/settings option metadata
- provider/source/quality display summaries
- download job status summaries
- capability issue display/remediation
- failure classification copy
- mpv language token normalization

Naming should reflect ownership:

- use `Policy` for pure decisions with no side effects
- use `Service` for coordination over ports/repositories
- use `Store` or `Repository` for persistence
- use `Engine` for process/runtime mechanics such as yt-dlp
- use `Phase` for app-level flow state
- use `Shell` or `Panel` for Ink UI

Large files should be reduced only along responsibility lines. Splitting a file without moving a responsibility to the right layer is churn, not maintainability.

## Download Design

### Adaptive Capacity

Downloads should have two separate capacity knobs:

- job capacity: how many yt-dlp jobs run at once
- fragment capacity: `--concurrent-fragments` per job

The default should be adaptive but conservative:

- low-memory or low-core device: 1 job, 4 fragments
- normal laptop: 1 job, 8 fragments
- stronger desktop: 2 jobs, 8 fragments each
- explicit config/env override may cap lower or higher, but must clamp to safe bounds

The first slice should not promise perfect hardware detection. It should use cheap deterministic signals such as CPU count and available memory when available, with a stable fallback. The service should log and expose the chosen capacity in diagnostics.

### Queue Semantics

Queue behavior must remain deterministic:

- queued jobs are selected by `created_at`, respecting `nextRetryAt`
- each job has one active worker at a time
- shutdown pauses running jobs and leaves them retryable
- abort deletes temporary artifacts and persists aborted state
- retries remain bounded and failure-kind aware
- completed state is only written after temp file rename and artifact validation

Parallel workers must not allow the same queued row to be claimed twice. The storage repository should expose an atomic claim operation before true multi-job workers land.

### Download Service Split

Split only along real responsibility lines:

- `DownloadQueueService`: public queue API, capacity loop, shutdown pause, retry/requeue/delete orchestration
- `DownloadJobRunner`: resolves fresh stream intent, invokes the engine, downloads subtitle sidecars, validates artifacts
- `YtDlpDownloadEngine`: builds yt-dlp args, spawns the process, parses progress, handles cancellation and bounded stderr
- `DownloadCapacityPolicy`: pure adaptive capacity calculation with tests
- `DownloadFailureClassifier`: pure error-message classification with tests
- existing `DownloadJobsRepository`: persisted facts and lifecycle transitions

The first implementation may keep these in `apps/cli/src/services/download` and `apps/cli/src/infra/download`. Do not create a package until another surface needs the code.

Downloads must use the same playback preference contract as normal playback. A queued job should persist enough intent to re-resolve the same provider/source/quality/language choice later, but should not treat stale playable URLs as durable truth.

## mpv / Player Design

Move `apps/cli/src/mpv.ts` under `apps/cli/src/infra/player` or split it into focused modules:

- mpv argument construction
- one-shot mpv launch
- subtitle attachment helpers
- socket cleanup helpers

Keep `PersistentMpvSession` in infra/player. App code should talk through `PlayerService` and `PlayerControlService`, not `launchMpv`, raw IPC sessions, or socket paths.

IPC guardrails should stay explicit:

- bounded command timeouts
- bootstrap timeout with transport-specific diagnostic hint
- socket cleanup on Unix
- command result events surfaced to diagnostics
- reconnect attempts capped per playback cycle

mpv language and subtitle argument construction should be tested as infra behavior, while the decision of which language/subtitle preference to pass belongs to app policy.

## Provider And Source Contract Design

Provider results should move toward one evidence-rich contract:

- selected stream candidate
- all discovered stream candidates when possible
- all usable subtitle candidates when possible
- source/mirror/quality/audio evidence when known
- structured failures and trace events
- cache policy and expiry hints
- runtime requirements and disabled reasons

Provider-local code owns provider quirks. App services own global fallback, ranking, cache reuse, source inventory, and user-facing recovery. UI owns display only.

When a provider cannot expose a capability, it should say that explicitly through capability metadata or diagnostics rather than forcing the UI to infer from missing fields.

## Diagnostics And DX Design

Diagnostics should answer "what happened, where, and what can I do next?" without requiring debug-log archaeology.

Diagnostics should expose:

- active mode and playback preference profile
- requested provider/source/quality/audio/subtitle
- selected provider/source/quality/audio/subtitle when known
- cache status: hit, miss, stale, prefetched, fresh
- provider attempts, retry counts, failure codes, and fallback path
- subtitle decision reason and track inventory count
- mpv IPC bootstrap, command failures, stalls, reconnect attempts, and socket cleanup
- download capacity choice, active job count, fragment count, retry state, and failure kind
- missing dependency impact and remediation

Developer guardrails should include:

- boundary import tests
- pure policy tests
- repository lifecycle tests
- process engine tests with fake subprocesses
- provider contract tests for trace/failure/cache-policy shape
- focused integration tests for playback preference propagation

## Boundary Guardrails

Add architecture tests that fail on drift:

- packages cannot import `apps/*`, `.plans/*`, `.docs/*`, `archive/*`, or `apps/experiments/*`
- `packages/types` has no workspace dependencies
- `packages/schemas` may import only `@kunai/types`
- `packages/core` may import only `@kunai/types`
- `packages/providers` may import only `@kunai/core` and `@kunai/types` among workspace packages
- `packages/storage` may import only `@kunai/schemas` and `@kunai/types` among workspace packages
- `apps/cli/src/app-shell` cannot import provider runtime, player runtime, or download process engines
- `apps/cli/src/app` cannot import raw mpv IPC or yt-dlp process engines
- `apps/cli/src/services` cannot import Ink components
- app phases should not import provider implementation modules directly
- provider definitions/adapters should not import app-shell modules
- download process engines should not import config, Ink, or session state

These tests should be small and deterministic. They should catch import drift, not try to become a full architecture linter.

## Testing Strategy

Whole-pass test coverage should include:

- playback preference policy tests for anime, series, movie, and CLI overrides
- setup wizard tests or shell workflow tests for language/default-provider/download decisions
- subtitle decision tests for every user-visible reason
- mpv language-token tests for `original`, `none`, `interactive`, language codes, and invalid/blank values
- provider resolve tests proving audio/subtitle preferences enter resolve/cache keys
- download re-resolve tests proving queued language/source/quality intent is reused
- pure capacity policy tests for low, normal, strong, and override cases
- yt-dlp argument tests that verify adaptive `--concurrent-fragments`
- queue tests proving capacity `1` preserves existing behavior
- queue tests proving capacity `2` starts two different jobs and never claims the same job twice
- shutdown tests proving all active jobs pause cleanly
- boundary import tests for package and CLI layer direction

Run before completion:

```sh
bun run test
bun run typecheck
bun run lint
bun run fmt:check
```

## Implementation Slices

### Slice 1: Guardrails And Preference Policy

1. Add or extract a pure playback preference policy helper that maps mode/media kind to the active audio/subtitle profile.
2. Reuse that helper in search routing, playback, downloads, panels, and setup/settings summaries.
3. Add tests for anime, series, movie, `none`, `interactive`, and legacy `fzf` migration behavior.
4. Extend boundary import tests for package direction and CLI layer direction.

### Slice 2: Setup And Capability UX

1. Add language/profile setup steps before download setup.
2. Keep dependency review non-installing and explicit about feature impact.
3. Explain `series.subtitle = none` and let users choose English, none, or interactive during setup.
4. Record setup choices in diagnostics without leaking private paths beyond local diagnostics.

### Slice 3: Adaptive Downloads

1. Add pure `DownloadCapacityPolicy`.
2. Add config/env override parsing only if it can be clamped and tested without broad config churn.
3. Extract yt-dlp arg construction so capacity is not hardcoded in `DownloadService`.
4. Add repository-level job claiming if multi-job workers are implemented in the same slice.
5. Teach `DownloadService.processQueue()` to run up to adaptive job capacity.
6. Record selected capacity in logs and diagnostics.

### Slice 4: Player Infra Cleanup

1. Move or split `apps/cli/src/mpv.ts` under `apps/cli/src/infra/player`.
2. Keep public imports stable through a temporary compatibility export only if needed.
3. Separate mpv args, one-shot launch, subtitle helpers, and socket cleanup.
4. Add tests around language tokens, IPC bootstrap timeout, socket cleanup, and subtitle attachment.

### Slice 5: Provider/Diagnostics Contract Tightening

1. Audit provider definitions and direct modules for duplicated source/subtitle/audio display or failure logic.
2. Ensure provider results emit explicit trace/failure/cache-policy evidence when data is known or unavailable.
3. Ensure diagnostics panels show disabled vs missing vs unknown subtitle/audio state clearly.

## Deferred

- Moving download logic into a package.
- Creating `@kunai/config`.
- Creating `@kunai/ui-cli`.
- Daemon download queue.
- Batch-download UX changes beyond the capacity engine.
- Full `PlaybackPhase`, `ink-shell`, and `workflows` decomposition beyond the slices above.
- Large provider rewrites without a dossier.
