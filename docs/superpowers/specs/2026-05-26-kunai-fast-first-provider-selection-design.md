# Kunai Fast-First Provider Selection And Enrichment Design

**Status:** Approved for implementation planning

**Date:** 2026-05-26

**Scope:** Playback startup latency, shared source-selection policy, AllManga regression repair, provider request economy, deferred richness, Cineby research gating, and series/anime identity safety.

## Purpose

Kunai should expose the breadth of provider sources without making every playback wait for the richest possible inventory. The user experience target is simple:

- show visible progress immediately;
- reach confirmed `mpv` playback quickly;
- prefer a credible `1080p` or better source when it is quickly available;
- recover from failing sources without slow repeated work;
- retain subtitles, source choices, quality options, provider timing and metadata without putting optional richness on the critical path.

This design establishes one selection model for movie, series and anime providers while repairing a confirmed AllManga regression introduced while adding `Ak` DASH coverage.

## Confirmed Context And Root Causes

### AllManga Regression Boundary

The user confirmed that AllManga playback was fast immediately before commit `d4413021` and became slower after that change.

Code comparison identifies the primary regression mechanism:

1. Before `d4413021`, `resolveEpisodeSources()` fetched the established AllManga source family and waited for that set.
2. `d4413021` added `Ak` as an additional supported source in the same blocking `Promise.allSettled(apiJobs)` barrier.
3. `Ak` can require an extra fetch, parsing of separate video/audio DASH representations, and later MPD materialization.
4. Therefore, an episode with an already playable established source can now wait for optional `Ak` work before returning any provider result.
5. Once `Ak` resolves, it can also be selected by quality sorting and send playback through a different startup path than the previously fast direct/HLS route.

`Ak` is valuable because it recovered an observed episode shape where `S-mp4` did not provide a usable link while `Ak` provided usable video, audio and subtitle data. It is not yet proven to be the fastest default route.

### Ani-CLI Compatibility Baseline

The local reference implementation at `/home/kitsunekode/Projects/osc/ani-cli/ani-cli` provides the compatibility baseline for AllManga-style behavior:

- resolve episode source data;
- extract available direct media choices;
- choose one playable result;
- hand it directly to `mpv`;
- do not make optional richness a prerequisite for beginning playback.

Kunai may extend that behavior with richer inventory, subtitles, diagnostics and recovery, but an extension must not cause known-playable episodes to wait on optional source expansion.

### Series Identity And History Risk

AllManga currently advertises `series` capability while its actual resolver accepts only anime identity. Ordinary TMDB series therefore can consider an impossible AllManga fallback, and a guessed identity bridge risks incorrect history or continuation records.

Until a deterministic mapping service proves a title correspondence between TMDB or IMDb identity and an anime catalog identity, AllManga must be treated as an anime-only playback provider.

## Goals

- Restore AllManga's fast known-playable foreground behavior while preserving `Ak` coverage.
- Define a provider-agnostic source-selection contract usable by VidKing, Rivestream, AllManga, Miruro and validated future Cineby/Videasy flavors.
- Make `Balanced` the default startup policy, strongly preferring discovered `1080p+` playback within a small bounded wait.
- Keep explicit user quality/source intent stronger than automatic latency preferences.
- Ensure optional source inventory, alternate subtitle tracks and metadata richness do not block first playable media.
- Measure provider request counts and startup-selection reasons deterministically.
- Keep provider-local source/server cycling distinct from global provider fallback.
- Remove unsafe ordinary-series fallback through AllManga until identity mapping is proven.
- Research Cineby breadth in experiments before exposing it in the production runtime.

## Non-Goals

- Declaring `Ak` the universal best AllManga source without comparative playback evidence.
- Automatically switching an already playing stream when a higher-quality candidate appears later.
- Adding speculative TMDB/IMDb-to-AniList identity mapping.
- Registering Cineby as a production global provider before its source/flavor behavior is validated.
- Putting live provider requests or real `mpv` playback in default tests or commit hooks.
- Gathering metadata via additional blocking upstream calls only to make UI look richer.

## User Experience Contract

### Startup Modes

Quality preference and startup patience are separate settings:

```ts
type StartupPriority = "fast" | "balanced" | "quality-first";
type QualityPreference = "auto" | "best" | "1080p" | "720p" | string;
```

`QualityPreference` expresses what the user would like. `StartupPriority` expresses how long playback may wait while trying to satisfy it.

### Fast

- Start the first trustworthy playable candidate.
- Do not initiate or await optional source enrichment.
- Honor an explicitly selected source or stream even when it is slower.
- Use a required fallback route, including `Ak`, when no ordinary playable candidate exists.

### Balanced

Balanced is the default.

- Play an already discovered healthy `1080p+` candidate immediately.
- If the best ready candidate is lower than `1080p` and a credible `1080p+` candidate is already being resolved as required/known work, allow a short bounded wait.
- Initial target wait budget: up to `1000ms`, made configurable in policy code and tuned after live validation.
- Do not start optional broad inventory discovery solely to consume the Balanced wait window.
- If the bounded wait expires, start the best healthy ready candidate and enrich later.

This gives preference to `1080p+` without turning "better quality might exist" into an indefinite loading state.

### Quality First

- Permit fuller provider-local candidate discovery, including optional high-quality routes such as AllManga `Ak`, within a larger bounded budget.
- Select the highest credible playable candidate based on discovered quality facts and source health.
- Still fail over or begin playback when the budget is exhausted; quality-first is not an unbounded spinner.
- Initial policy budget should be separately configurable in the `3000ms` to `5000ms` range and validated before becoming user-facing default behavior.

### Explicit Selection

An explicit user source or stream selection overrides automatic startup policy:

- selecting `Ak` resolves and plays `Ak` if available;
- selecting a specific source/server does not silently replace it with a faster automatic choice;
- a failed explicit choice may surface recovery actions without damaging unrelated provider health.

### Late Better-Quality Discovery

When playback already started and optional enrichment later discovers a higher-quality candidate:

- do not automatically interrupt or reload current playback;
- show a truthful available alternative only after it is actually discovered;
- allow a manual switch/reload action where supported;
- prefer the confirmed better choice for an exact-intent next-episode prefetch when user preference and health evidence permit it.

## Architecture

### Shared Flow

```text
playback intent
  -> resolve-work/cache/source-inventory lookup
  -> provider-specific required candidate discovery
  -> normalized candidate inventory with evidence
  -> shared startup-selection policy
  -> mpv handoff for selected playable candidate
  -> optional late enrichment and source-health feedback
  -> exact-intent next-episode prefetch reuse
```

Provider modules own extraction quirks and provider-local source shapes. Application services own startup policy, user preference, reuse, global fallback, health interpretation and diagnostics. UI renders confirmed facts and available actions only.

### Required Versus Optional Candidate Work

Each provider may divide discovery into:

- **required foreground work:** the minimal provider action required to produce a playable candidate for the current intent;
- **optional foreground work:** work allowed only by Quality First or explicit source selection;
- **late enrichment work:** source/subtitle/metadata inventory gathered after playback begins or when a user opens a relevant control;
- **prefetch work:** exact next-intent work that is cancellable and deduplicated through the existing resolve-work boundary.

Candidate discovery must declare why its work ran. Optional richness should never be indistinguishable from required first-play work in diagnostics.

### Normalized Candidate Facts

The existing provider inventory contract remains the source of truth. Selection uses only facts providers genuinely expose:

- provider/source/server/variant IDs and native labels;
- quality label, numeric resolution and bitrate where known;
- protocol/container, required headers and safe provenance;
- audio/subtitle/hardsub evidence;
- observed failure classification and title/source-scoped local health;
- discovery lane and selection reason.

An unknown bitrate or quality must remain unknown; Kunai must not advertise superior quality from a guessed source label.

## AllManga Repair

### Source Lanes

AllManga should classify episode source resolution as follows:

- **baseline foreground:** established ani-cli-compatible/direct/HLS sources that formed the pre-regression fast path;
- **required fallback:** `Ak` when baseline foreground produces no playable media;
- **explicit/quality-first route:** `Ak` when a user selected it or Quality First authorizes fuller resolution;
- **future late enrichment:** optional `Ak` discovery after baseline playback has started, if it can be done through a cancellable background/service-owned path.

### Immediate Selection Rules

For normal Fast and Balanced playback:

1. Resolve baseline foreground sources.
2. If a playable baseline `1080p+` source exists, return it without waiting for optional `Ak`.
3. If baseline provides playable media below the preferred quality, Balanced starts it after its bounded policy decision; it does not automatically block on newly initiated `Ak` expansion.
4. If no baseline source is playable, resolve `Ak` as required fallback.
5. If `Ak` is explicitly selected or Quality First is active, allow it in the foreground candidate set.

### Rich Metadata

GraphQL facts already received in required playback work remain eligible for immediate preservation: title identity, episode count, available audio modes, external IDs and artwork already contained in the response.

Additional endpoints, optional manifests, alternate source expansion or late subtitle inventories may enrich cached/provider UI facts only in a non-blocking or explicitly requested lane.

## Provider-Specific Application

### VidKing

- Preserve the already-landed trimming of definitive `404` retries and duplicated year variants.
- Treat Videasy/server alternatives as provider-local candidates.
- Apply startup policy to discovered candidate qualities; do not probe optional extra tiers in Fast merely to populate inventory.
- Keep Cineby/Videasy flavor promotion separate until research evidence proves compatible source behavior.

### Rivestream

- Retain cached service discovery.
- Treat API-returned services as provider-local candidates.
- Stop on a healthy selected candidate according to startup policy; avoid repeated cold discovery for facts already cached.

### Miruro

- Retain data-driven provider keys and source ranking.
- Use provider-native intro/outro, subtitle and seek evidence at zero extra discovery cost.
- Apply health only from meaningful playable/startup outcomes, not merely from receiving a URL.
- Optional broader source discovery must not delay a healthy selected startup path under Fast/Balanced.

### Cineby

Cineby is a research and intake track before production exposure:

- enumerate observed flavor/server routes in `apps/experiments`;
- measure resolution latency, candidate quality facts, failure classifications and five-second `mpv` playability without storing raw URLs durably;
- identify whether each route is a Videasy-compatible local source flavor or a genuinely separate provider contract;
- expose only validated, useful routes, preferably as provider-local inventory when they share VidKing/Videasy semantics.

Cineby must not be registered as broad global fallback simply because the website exposes many choices.

## Identity And Persistence Safety

### AllManga Runtime Scope

Until a deterministic catalog bridge exists:

- AllManga playback capability is anime-only.
- It does not enter ordinary TMDB series global fallback.
- Anime flows using provider-native or AniList-backed AllManga identity continue to work.
- History, cache and continuation keys must not be written from guessed cross-catalog correspondence.

### Future Cross-Catalog Mapping

A later identity service may allow a TV/anime surface to deliberately map into an anime provider only when it records evidence such as stable AniList identity and validated provider-native mapping. That is separate work requiring its own design and history migration rules.

## Diagnostics And Measurement

Every playback selection decision should make the following inspectable through diagnostics/support evidence:

- startup mode and quality preference;
- foreground work versus optional enrichment lane;
- number of candidate/provider requests attributable to the playback intent;
- quality/source facts discovered before selection;
- selection reason:
  - `fast-start`;
  - `balanced-1080`;
  - `balanced-budget-expired`;
  - `quality-first`;
  - `explicit-source`;
  - `ak-required`;
  - `provider-fallback`;
- late enrichment duration and whether a better confirmed candidate became available;
- `mpv` startup/readiness/playback confirmation when observed.

Diagnostics must describe facts, not promise that an undiscovered better stream exists.

## Deterministic Test Contract

### AllManga Regression Tests

- A fixture with a fast baseline playable source and a delayed `Ak` route resolves the baseline stream without awaiting or fetching optional `Ak` under Fast/Balanced normal playback.
- An `Ak`-only fixture resolves through deferred DASH media and retains audio/video/subtitle facts.
- An explicitly selected `Ak` route is honored.
- A Quality First request may resolve `Ak` within its foreground budget.
- Request-count assertions prove optional `Ak` no longer taxes normal fast playback.

### Shared Policy Tests

- Fast returns a trustworthy ready candidate without optional wait.
- Balanced selects discovered `1080p+` immediately.
- Balanced permits only the bounded wait when a credible better candidate is already in permitted foreground work.
- Balanced starts a lower-quality ready candidate when the budget expires.
- Quality First may wait for fuller inventory but remains bounded.
- Explicit source/stream selection overrides automatic ranking.
- Late enrichment never automatically interrupts active playback.

### Provider Request-Economy Tests

- VidKing request counts remain bounded on definitive failure and cached/successful paths.
- Rivestream services inventory remains cached across eligible resolves.
- Miruro stops cycling on a selected healthy candidate and retains alternate evidence only when already obtained or policy-authorized.
- AllManga baseline and `Ak` paths expose separate request budgets.

### Routing And Persistence Tests

- Ordinary series fallback never includes AllManga while its identity is anime-only.
- Anime-mode AllManga selection remains available.
- No guessed identity produces history/cache continuation entries for ordinary series.

## Implementation Sequence

### Slice 1: Immediate Regression Repair And Identity Guard

- Add deterministic regression/request-count fixtures for baseline-plus-delayed-`Ak`, `Ak`-only and ordinary-series fallback.
- Restore baseline foreground behavior and make `Ak` required/explicit-only in the immediate normal path.
- Remove AllManga from ordinary series compatibility until identity mapping is explicitly designed.
- Update affected provider dossiers and truth documentation.

This slice restores speed and correctness before adding general policy behavior.

### Slice 2: Shared Startup Selection Policy

- Introduce `StartupPriority` with `fast`, `balanced` and `quality-first`.
- Keep `qualityPreference` independent.
- Add bounded policy decisions and selection-reason diagnostics.
- Make Balanced the default with initial `1080p+` preference and configurable bounded wait.

### Slice 3: Provider Request Budgets And Late Enrichment Boundary

- Define required and optional work accounting for each active provider.
- Route optional source richness through late/background or explicit-demand work where feasible.
- Ensure prefetch remains exact-intent, cancellable and deduplicated.
- Surface confirmed better alternatives without interrupting active playback.

### Slice 4: Cineby Breadth Research And Candidate Intake

- Use `apps/experiments` only for Cineby route/flavor harvesting and five-second playback evidence.
- Decide from evidence whether validated options extend VidKing/Videasy local inventory or justify a new runtime provider.
- Do not promote unvalidated routes into production selection.

### Slice 5: Final Live Validation And Budget Tuning

- Manually run real `mpv` playback for VidKing, Rivestream, AllManga and Miruro.
- Run approved Cineby comparisons after its experiment evidence is ready.
- Confirm startup speed, selected quality, subtitle late attachment, fallback, next-episode prefetch and support diagnostics.
- Tune Balanced and Quality First budgets from observed results.

## Verification Workflow

Implementation should proceed in coherent slices rather than interrupting each small edit with the full repository gate:

- add focused failing tests before each behavioral fix;
- use targeted tests while implementing that slice;
- after completing each coherent implementation slice, run its focused test set;
- after all approved implementation slices are integrated, run the full repository gate:
  - `bun run fmt`
  - `bun run lint`
  - `bun run typecheck`
  - `bun run test`
  - `bun run build`
- reserve live provider and real `mpv` validation for the final explicit manual phase.

## Success Criteria

- A normally playable AllManga episode no longer waits for optional `Ak` discovery.
- An `Ak`-only episode remains playable with synchronized video/audio handling.
- Ordinary series playback cannot waste fallback work on or pollute history through AllManga identity ambiguity.
- Balanced is the default policy and prefers confirmed `1080p+` within a bounded startup budget.
- All providers follow one selection-policy contract while keeping provider-local extraction behavior independent.
- Optional richness becomes visible after discovery without becoming an invisible startup tax.
- Cineby breadth is investigated and admitted only from redacted, playback-backed evidence.
- Diagnostics can explain latency, quality choice, fallback and enrichment decisions without raw media leakage.
