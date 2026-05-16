# Unified Trace/Event Correlation Sweep

Status: Implemented 2026-05-17

## Goal

Make runtime evidence easier to join across provider fallback, cache checks,
mpv playback events, presence/background failures, debug JSONL traces, and
exported diagnostics bundles.

## Implemented

- Added a shared diagnostics correlation model with optional `sessionId`,
  `playbackCycleId`, `providerAttemptId`, and `traceId` fields.
- Added a per-container session ID and per-playback-cycle provider/playback IDs.
- Threaded correlation through provider resolve diagnostics and provider attempt
  timelines.
- Reused `providerAttemptId` as the provider timeline trace ID when supplied.
- Threaded correlation into mpv launch/completion/runtime diagnostics.
- Threaded correlation into presence background task failures.
- Added a support-bundle `correlation` summary so exported reports show the IDs
  available for joining events.
- Documented the fields in the diagnostics guide and debugging map.

## Tests

- `DiagnosticsServiceImpl` support bundle correlation summary.
- `runBackgroundTask` promotion of correlation fields out of context.
- `PlaybackResolveCoordinator` propagation into provider timeline diagnostics.

## Follow-Ups

- Carry correlation IDs into provider package `ResolveTrace` payloads and the
  persisted `resolve_traces` repository.
- Add correlation display affordances in the diagnostics panel if support report
  triage shows it is useful.
- Use the same IDs in future PersistentMpvSession ready-work extraction tests.
