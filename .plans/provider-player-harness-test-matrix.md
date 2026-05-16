# Provider And Player Harness Test Matrix

Status: implemented baseline

## Goal

Battle-test playback recovery against real-world user and provider behavior without relying on live network tests in the default suite.

## Deterministic Unit And Service Tests

- Fail-fast blocker cases: missing mpv/runtime, incompatible provider/media kind, invalid episode, user cancel.
- Guided retry budget: one transient retry, no loops.
- Fallback-first slow fallback: visible grace, one auto-fallback, stop after budget.
- Manual recovery mode: no provider switching without action.
- Network unavailable: suggests offline, does not degrade providers.
- Provider health: down providers skipped automatically, explicit selection tries once, success heals state.
- Cache: fresh reuse, stale validation, forced refresh after suspected dead stream, health timeout proceeds with warning when usable.
- Playback: expired stream refresh, bounded in-process reconnect, final failure after budget.
- Offline: no remote artwork fetch while offline, local playback works, broken artifact offers repair/online choices.
- Diagnostics: redaction, bundle shape, provider timeline, issue preview.
- Long sessions: bounded diagnostics ring, bounded image cache, deduped in-flight resolve/artwork tasks.

## Fixture And Integration Tests

- Fixture-backed provider parse failures.
- Provider no-stream results.
- Subtitle API failure while video succeeds.
- Slow health probe and slow provider resolve with fake timers.
- Offline library read model with thumbnail/cached poster/remote fallback ordering.

## Live Smoke Tests

- Keep provider live smoke tests opt-in.
- Document when to run:
  - provider drift
  - suspected CDN changes
  - before release candidates
- Live smoke output should include provider id, cache status, stream/subtitle evidence, timing, and redacted diagnostics.

## Acceptance

- Default test path remains deterministic and fast.
- Live tests are useful for reality checks but not required for every commit.
- Every recovery policy branch has at least one deterministic test.

## Implemented Baseline

- `apps/cli/test/unit/harness/provider-fallback-harness.test.ts` locks fallback candidate behavior across compatible media kinds, known-down providers, manual mode, and explicit down-provider selection.
- `apps/cli/test/unit/harness/playback-recovery-harness.test.ts` locks slow-but-moving playback, network-read-dead refresh guidance, and long user pauses.
- `apps/cli/test/live/README.md` documents opt-in provider smoke checks and the evidence to capture without putting remote providers on the default CI path.
