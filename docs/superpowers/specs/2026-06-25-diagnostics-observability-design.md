# Diagnostics And Observability Upgrade Design

## Status

Approved for planning. This spec covers a two-phase diagnostics upgrade:

1. A user-facing diagnostics cockpit that makes current failures understandable.
2. An observability/data upgrade that records richer, bounded evidence for complex runtime behavior.

## Goal

Kunai diagnostics should be useful to two audiences at the same time:

- Non-developers should understand what is wrong, why it probably happened, and what to try next.
- Developers and agents should get enough structured, correlated evidence to debug provider, playback, network, cache, subtitle, download, and shell issues without guessing from free-form logs.

The panel should feel like part of the terminal shell, not a raw log dump. Diagnostic collection should stay local, redacted, bounded, and non-blocking.

## Non-Goals

- Do not route video or sensitive data through diagnostics or support exports.
- Do not introduce a remote telemetry service.
- Do not turn the app shell into the diagnostics engine. The shell renders a prepared model.
- Do not keep unbounded event history in memory.
- Do not replace existing `--debug`, `--debug-json`, `/export-diagnostics`, or `kunai diagnostics recent`; improve how they are summarized and connected.

## Current Context

The current diagnostics stack already has strong foundations:

- `DiagnosticsService` records redacted runtime events and can write to a durable bounded sink.
- The cache DB stores recent `diagnostic_events`.
- `/diagnostics` is available as a root overlay.
- The root overlay already supports line scrolling.
- `buildDiagnosticsPanelLines` already surfaces health rows, provider timelines, memory, network, YouTube probes, release sync, support export actions, and recent events.
- Support bundles already include privacy metadata and redacted runtime evidence.

The gap is that the current panel is still mostly a flat list. It has useful facts, but it does not yet behave like a guided triage surface with clear audience layers, likely causes, action recommendations, and consistent deep evidence for multi-step flows.

## Phase 1: Diagnostics Cockpit

Phase 1 upgrades the panel and its view model without requiring broad instrumentation changes.

### User Experience

The diagnostics overlay is reorganized into these stable sections:

1. **Verdict**
   - One line that says `Healthy`, `Needs attention`, or `Broken`.
   - Includes the most likely cause and one recommended next action.
   - Avoids developer jargon unless the user opens the deeper evidence rows.

2. **Health**
   - Rows for Playback, Provider, Network, Cache, Subtitles, Downloads, Discord, Release sync, and Memory.
   - Each row uses the grammar `OK`, `Needs attention`, `Failed`, or `Unknown`.
   - Each row includes a short reason and one practical next step when degraded.

3. **Current Playback Evidence**
   - Current title, episode, mode, provider, playback state, source/cache state, subtitle outcome, recover/fallback status, and startup slowest stage.
   - This section answers "what is Kunai trying to do right now?"

4. **Developer Evidence**
   - Provider attempt timeline.
   - Correlation IDs: session, playback cycle, provider attempt, trace.
   - Playback startup phases.
   - Source inventory warnings.
   - mpv/network events.
   - Recent diagnostic events.

5. **Export And Report**
   - `/export-diagnostics`: write a redacted local bundle.
   - `/report-issue`: preview-first issue flow.
   - `kunai diagnostics recent`: agent/developer readout.

### Scrolling And Density

The panel should remain a fullscreen shell overlay using the existing root overlay path. It should:

- Keep section headers stable and compact.
- Preserve the current scroll behavior.
- Improve scroll cues so users know where they are in long diagnostics.
- Avoid relying on terminal scrollback.
- Keep narrow terminal output useful by prioritizing verdict, health, and current evidence before developer evidence.

### Design Boundary

`apps/cli/src/services/diagnostics` should own diagnostic interpretation and triage models. `apps/cli/src/app-shell` should render those models into shell rows. `panel-data.ts` may adapt the model into `ShellPanelLine[]`, but it should not become a second diagnostics engine.

## Phase 2: Observability And Data Backbone

Phase 2 improves the evidence captured by diagnostics and support exports.

### Diagnostic Insight Builder

Add a diagnostics insight builder that converts raw events and current session state into a stable summary model:

- `sessionVerdict`
- `likelyCause`
- `recommendedActions`
- `blockingIssues`
- `degradedSubsystems`
- `currentPlaybackEvidence`
- `developerEvidence`
- `exportSummary`

This builder should be pure and unit-tested with representative event sequences.

### Network Observation

Network-related behavior should be observable in enough detail to explain slow, stalled, broken, or recovered playback without exposing sensitive URLs.

Capture structured, redacted evidence for:

- Provider metadata fetch start, retry, redirect, timeout, HTTP failure, parse failure, and success.
- Stream preflight result and definitive failure.
- mpv network samples: speed, cache ahead, buffering, underrun, read idle, reconnect attempt, reconnect result, and stall recovery.
- Relay metadata fetch decisions when relay is configured.
- Download network progress, retry, validation, repairable sidecar state, and terminal failure.
- YouTube/Invidious/yt-dlp availability and failure class where applicable.

Do not store full stream URLs, subtitle URLs, auth headers, cookies, request bodies, local home paths, or provider secrets.

### Complex Multi-Step Behavior Observation

Any major runtime flow with branching or multi-step decision logic should emit step-level diagnostic events with stable operation names and correlation IDs.

Required coverage:

- Search routing and catalog/provider selection.
- Provider resolve: cache check, provider order, provider-local retries, source/server attempts, fallback, selected stream, and exhaustion.
- Source inventory: cache hit/miss/set/invalidate, selected source, language/subtitle inventory, and warnings.
- Playback startup: episode context, timing metadata, provider resolve, stream preparation, mpv launch/readiness, first progress, subtitle attach.
- Recovery: recover request, refresh request, cooldown, cached fallback, provider fallback, and same-stream reconnect.
- Subtitles: preference, inventory-satisfied, needs lookup, direct provider track, Wyzie/API lookup, attach success/failure, late attach.
- Downloads/offline: intent, reservation, queue, artifact validation, repairable state, local playback handoff, failed job.
- Presence: connect, update, clear, unavailable, and shutdown failures.
- Storage/cache maintenance: startup maintenance, prune counts, DB open failure, and non-blocking write failures.
- Shell/input: dropped input, render stalls, resize blockers, overlay open/close where useful for diagnosing broken terminal state.

Events should include the smallest useful context: category, operation, stage, status, failure class, duration, retry/fallback counts, provider id, media identity hash or safe title id when available, and correlation IDs.

### Memory Bounds And Flush Behavior

Diagnostics must not choke RAM or block app behavior.

The implementation should enforce:

- A small in-memory ring for active-session events.
- A bounded durable ring in the cache DB, preserving the current "newest 10,000 events or 14 days" policy unless the implementation finds a safer repo-defined constant.
- Best-effort asynchronous persistence through the durable sink.
- Flush on clean shutdown and container disposal.
- Non-blocking failure behavior: diagnostics write/read/flush failures log a warning and never block playback, search, shell input, provider resolution, or shutdown.
- Snapshot/export reads should prefer durable events when available and fall back to the in-memory ring.
- Long debug traces should stream to JSONL when `--debug-json` or `--debug-session` is enabled instead of growing app memory.
- Large nested diagnostic context should be summarized before storage; raw provider payloads and large arrays should be omitted or counted.

### Support Bundle Upgrade

Support bundles should add a readable summary before raw events:

- Verdict and likely cause.
- Affected subsystems.
- Recommended next actions.
- Correlation summary.
- Last relevant event per subsystem.
- Provider/playback/network/cache/subtitle/download evidence summaries.
- Privacy block confirming redaction and excluded data classes.

The raw event list remains available for agent/developer inspection.

## Data Flow

1. Runtime services record structured `DiagnosticEvent` entries through `DiagnosticsService`.
2. `DiagnosticsService` redacts and normalizes events.
3. Events enter the active in-memory store and best-effort durable sink.
4. The insight builder reads recent events plus current session state and derives a `DiagnosticsInsight`.
5. The app shell adapts the insight into sectioned panel rows.
6. Support export uses the same insight model plus the redacted event snapshot.

## Error Handling

- Missing diagnostics data renders as `Unknown`, not as healthy.
- Diagnostics persistence failure records/logs a warning and keeps the app usable.
- Export failure should show a user-facing error with the attempted path and a next step.
- Redaction should be applied before persistence, traces, exports, and panel display.
- If correlation IDs are missing, the panel should say which ID is unavailable rather than inventing one.

## Testing

Phase 1 tests:

- `buildDiagnosticsPanelLines` or successor model tests for verdict, health rows, and section order.
- Narrow/medium/wide capture only if layout changes are visible enough to need golden review.
- Regression test that panel scroll still shows long diagnostics without terminal scrollback.

Phase 2 tests:

- Pure unit tests for the diagnostics insight builder across healthy, degraded, and broken sessions.
- Event interpretation tests for provider fallback, network stall, cache fallback, subtitle failure, download repairable, and presence failure.
- Redaction tests for sensitive context in new event fields.
- Support bundle tests for readable summary, correlation summary, and privacy block.
- Durable sink/store tests for bounded retention and flush failure behavior.

## Rollout Plan

1. Implement Phase 1 as a UI/model slice with existing events.
2. Verify panel tests and targeted shell captures.
3. Implement Phase 2 as a diagnostics service/data slice.
4. Add structured events in the highest-value flows first: provider resolve, playback startup, mpv/network, recovery, subtitle attach, downloads/offline.
5. Upgrade support bundles to reuse the same insight model.
6. Update `.docs/diagnostics-guide.md` after implementation so docs match actual behavior.

## Acceptance Criteria

- `/diagnostics` opens a scrollable, sectioned panel with a clear verdict, health rows, current evidence, developer evidence, and export actions.
- Non-developers can identify the likely problem and next action without reading raw events.
- Developers and agents can follow provider/playback/network/cache/subtitle/download behavior through stable operation names and correlation IDs.
- Complex multi-step flows emit structured step-level events.
- Diagnostic memory use remains bounded and flushes best-effort to the durable sink.
- Support bundles contain a readable summary and redacted raw evidence.
- Diagnostics failures do not block primary app behavior.
