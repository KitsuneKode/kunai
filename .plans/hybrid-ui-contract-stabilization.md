# Hybrid UI Contract Stabilization

Status: in progress
Owner: CLI/runtime architecture pass

This plan locks the backend and shell contracts needed before the dedicated UI polish pass. The goal is not to redesign the app here. The goal is to make the next design pass safe: no hidden provider calls on render, no ambiguous language/source labels, no broken download recovery semantics, and no noisy loading warnings.

## Product Rules

- Compact facts are always visible; expanded controls appear only when there is a real alternative.
- Rendering a picker, panel, or status line must not perform provider network work.
- Source/server identity is not language. Languages must come from normalized audio, hard-sub, or subtitle fields.
- Anime playback may expose presentation first (`Sub`, `Dub`, `Hard Sub`, `Soft Sub`) and then source/server/quality.
- Series/movie playback may expose source/server first, with audio/subtitle/quality metadata beside it.
- Continue and history must show local state immediately, then enrich from cached reconciliation or explicit refresh.
- Download repair must repair sidecars without redownloading videos unless the user explicitly retries the video job.
- Subtitle attachment counts are informational; they are not loading failures.

## Data Boundaries

- Provider adapters emit normalized stream inventory through `providerResolveResult`.
- UI-facing helpers in `apps/cli/src/app/source-quality.ts` turn stream inventory into picker-ready summaries.
- Search filters live in `SearchIntent`; the browse UI is only a projection over that shared contract.
- Download status and repairability live in `DownloadService` and the download jobs repository.
- Loading issue copy is normalized in `loading-shell-runtime.ts`; panels consume the normalized result.

## Current Pass Checklist

- [x] Keep local UI prototype artifacts out of commits.
- [x] Add a documented playback-control summary helper for UI surfaces.
- [x] Harden repair-all so one bad sidecar does not abort the entire repair sweep.
- [x] Test sidecar repair does not redownload video artifacts.
- [x] Normalize audio/subtitle search filters consistently.
- [x] Preserve calendar/command surfaces without clutter or stale highlighted browse cards.
- [ ] Run focused tests and final repo verification.

## UI Agent Handoff

The UI agent can safely polish:

- command palette density and scroll affordances
- history/continue list layout and poster/detail column
- playback/post-playback source, quality, and track picker presentation
- download manager repair status copy
- calendar day and release cards

The UI agent should not change:

- provider resolve fallback policy
- download retry versus repair semantics
- stream inventory normalization
- cache invalidation policy
- history reconciliation ownership
